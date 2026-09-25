"""Leiden International Film Festival (LIFF), from liff.nl's WordPress API.

Cineville lists LIFF as a single venue with no halls, and only the screenings
the pass covers. liff.nl publishes the whole programme through the standard
WordPress REST API, as three custom post types:

- ``shows_cpt``: one screening — date and times, a location, a film, a ticket
  key or external ticket link, a cancelled flag.
- ``films_cpt``: the film — title, director, cast, year, runtime, section.
- ``locations_cpt``: the halls ("Trianon 2", "Kijkhuis 1") and other venues.
- ``sections_cpt``: programme sections; the Cineville pass covers the
  competitions only (liff.nl/bezoekersinformatie).

Every edition stays in the API, so only screenings from today on are read.
Each screening is placed at the real cinema or venue; a location this file
doesn't know is placed at the LIFF festival row with the location as its room,
so a new venue shows up rather than being dropped.
"""

import html
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

import requests

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate, is_sneak_preview_title, sneak_preview_movie
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import (
    PER_FILM_SCRAPER_INTERVAL,
    BaseCinemaScraper,
)
from app.scraping.logger import logger
from app.scraping.subtitles import parse_subtitle_label
from app.scraping.tmdb_lookup import find_tmdb_id, get_tmdb_lookup_cache_id
from app.scraping.tmdb_movie_details import get_tmdb_movie_details
from app.services import festivals as festivals_service
from app.services import movies as movies_service
from app.services import scrape_sync as scrape_sync_service
from app.services import showtimes as showtimes_service
from app.utils import clean_title, now_amsterdam_naive

CINEMA_KEY = "liff"
SITE = "https://www.liff.nl"
API = f"{SITE}/wp-json/wp/v2"
PAGE_SIZE = 100
REQUEST_TIMEOUT_SECONDS = 30
TEST_POST_PREFIX = "#TEST"

# LIFF's location name, lowercased, to our cinema key. Matched on the start of
# the name, so "Trianon 2" and "Kijkhuis 2 – old" land in the right cinema.
LOCATION_PREFIX_TO_CINEMA_KEY: list[tuple[str, str]] = [
    ("trianon", "trianon"),
    ("kijkhuis", "kijkhuis"),
    ("lido", "lido"),
    ("filmhuis den haag", "filmhuis-den-haag"),
    ("flora", "flora"),
    ("volkshuis", "volkshuis-leiden"),
    ("wibar", "wibar-leiden"),
    ("naturalis", "naturalis"),
    ("stadsgehoorzaal", "stadsgehoorzaal-leiden"),
    ("rijksmuseum van oudheden", "rijksmuseum-van-oudheden"),
]

# WPML suffixes the post title with its language ("Mouse nl").
_LANGUAGE_SUFFIX_RE = re.compile(r"\s+(nl|en)$", re.IGNORECASE)


@dataclass(frozen=True)
class LiffShow:
    film_id: int | None
    title: str
    start: datetime
    end: datetime | None
    location_name: str
    ticket_link: str
    subtitles: list[str] | None


def _rendered(value: Any) -> str:
    if isinstance(value, dict):
        value = value.get("rendered")
    return html.unescape(value) if isinstance(value, str) else ""


def _post_title(post: dict[str, Any]) -> str:
    acf = post.get("acf") or {}
    for candidate in (acf.get("customTitle"), acf.get("title")):
        if isinstance(candidate, str) and candidate.strip():
            return html.unescape(candidate.strip())
    return _LANGUAGE_SUFFIX_RE.sub("", _rendered(post.get("title")).strip())


def _int_or_none(value: Any) -> int | None:
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _film_acf(films: dict[int, dict[str, Any]], film_id: int | None) -> dict[str, Any]:
    if film_id is None:
        return {}
    return (films.get(film_id) or {}).get("acf") or {}


def _is_truthy_flag(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.lower() == "true")


class LIFFScraper(BaseCinemaScraper):
    # Around fifteen requests to one small site per run.
    min_run_interval = PER_FILM_SCRAPER_INTERVAL

    def __init__(self) -> None:
        self.cinema_key = CINEMA_KEY
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_key(
                session=session, key=CINEMA_KEY
            )
            if not self.cinema_id:
                raise ValueError(f"Cinema {CINEMA_KEY} not found in database")
            self.cinema_id_by_key = {
                cinema.key: cinema.id
                for cinema in cinema_crud.get_cinemas(session=session)
            }
        self.http = requests.Session()

    def _get_all(self, post_type: str, fields: str) -> list[dict[str, Any]]:
        posts: list[dict[str, Any]] = []
        page = 1
        while True:
            params: dict[str, str | int] = {
                "per_page": PAGE_SIZE,
                "page": page,
                "_fields": fields,
            }
            response = self.http.get(
                f"{API}/{post_type}",
                params=params,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            batch = response.json()
            posts.extend(post for post in batch if isinstance(post, dict))
            total_pages = int(response.headers.get("X-WP-TotalPages", "1"))
            if page >= total_pages or not batch:
                return posts
            page += 1

    def _cinema_for_location(self, location_name: str) -> tuple[int, str | None]:
        """Our cinema for a LIFF location, and the room to note there.

        A known location needs no room: a hall name from the festival ("Trianon
        2") would fight the seat poller's own name for it. An unknown location
        goes to the festival row, where the room is the only place it's named.
        """
        normalized = location_name.strip().lower()
        for prefix, cinema_key in LOCATION_PREFIX_TO_CINEMA_KEY:
            cinema_id = self.cinema_id_by_key.get(cinema_key)
            if normalized.startswith(prefix) and cinema_id is not None:
                return cinema_id, None
        assert self.cinema_id is not None
        return self.cinema_id, location_name.strip() or None

    def _parse_show(
        self,
        show: dict[str, Any],
        *,
        location_names: dict[int, str],
        films: dict[int, dict[str, Any]],
        today: datetime,
    ) -> LiffShow | None:
        acf = show.get("acf") or {}
        schedule = acf.get("schedule") or {}
        date = schedule.get("date")
        start_time = schedule.get("start_time")
        if not date or not start_time or _is_truthy_flag(acf.get("showCancelled")):
            return None
        start = datetime.strptime(f"{date}{start_time}", "%Y%m%d%H:%M")
        if start < today:
            return None
        end: datetime | None = None
        end_time = schedule.get("end_time")
        if end_time:
            end = datetime.strptime(f"{date}{end_time}", "%Y%m%d%H:%M")
            if end <= start:
                end += timedelta(days=1)

        film_id = _int_or_none(acf.get("film"))
        film_acf = _film_acf(films, film_id)
        if _is_truthy_flag(film_acf.get("movieCancelled")):
            return None

        external_link = acf.get("external_link_ticket_button")
        show_key = acf.get("showCustomKey")
        if isinstance(external_link, str) and external_link.startswith("http"):
            ticket_link = external_link
        elif show_key:
            ticket_link = f"{SITE}/tickets/?film={show_key}"
        else:
            ticket_link = str(show.get("link") or SITE)

        title = _post_title(show)
        # The festival's own placeholder posts ("#TEST Hamnet").
        if title.upper().startswith(TEST_POST_PREFIX):
            return None
        location_id = _int_or_none(acf.get("location"))
        return LiffShow(
            film_id=film_id if film_id in films else None,
            title=title,
            start=start,
            end=end,
            location_name=location_names.get(location_id or 0, ""),
            ticket_link=ticket_link,
            subtitles=parse_subtitle_label(
                acf.get("subTitleLanguage") or film_acf.get("subTitle")
            ),
        )

    def _resolve_movie(
        self, *, title: str, film_acf: dict[str, Any]
    ) -> MovieCreate | None:
        if is_sneak_preview_title(title):
            return sneak_preview_movie()
        title_query = clean_title(title)
        directors = [
            name.strip()
            for name in str(film_acf.get("director") or "").split(",")
            if name.strip()
        ]
        cast = [
            name.strip()
            for name in str(film_acf.get("cast") or "").split(",")
            if name.strip()
        ]
        actor = cast[0] if cast else None
        year = _int_or_none(film_acf.get("releaseYear"))
        duration = _int_or_none(film_acf.get("filmdurationinminutes"))

        tmdb_id = find_tmdb_id(
            title_query=title_query,
            director_names=directors,
            actor_name=actor,
            year=year,
            duration_minutes=duration,
        )
        if not tmdb_id:
            logger.warning(f"LIFF: no TMDB match for {title!r}, skipping")
            return None
        details = get_tmdb_movie_details(tmdb_id)
        return MovieCreate(
            id=int(tmdb_id),
            tmdb_cache_id=get_tmdb_lookup_cache_id(
                title_query=title_query,
                director_names=directors,
                actor_name=actor,
                year=year,
                duration_minutes=duration,
            ),
            title=details.title if details is not None else title,
            letterboxd_slug=None,
            directors=(details.directors if details is not None else directors)
            or None,
            cast=(details.cast_names if details is not None else cast) or None,
            release_year=details.release_year if details is not None else year,
            duration=(details.runtime_minutes if details is not None else None)
            or duration,
            languages=details.spoken_languages if details is not None else None,
            original_language=(
                details.original_language if details is not None else None
            ),
            original_title=details.original_title if details is not None else None,
            description=details.description if details is not None else None,
            tmdb_last_enriched_at=(
                details.enriched_at if details is not None else None
            ),
        )

    def scrape(self) -> list[tuple[str, int]]:
        today = now_amsterdam_naive().replace(hour=0, minute=0, second=0)
        sections = self._get_all("sections_cpt", "id,title")
        competition_section_ids = {
            section["id"]
            for section in sections
            if "competition" in _rendered(section.get("title")).lower()
        }
        location_names = {
            location["id"]: _rendered(location.get("title"))
            for location in self._get_all("locations_cpt", "id,title")
        }
        films = {
            film["id"]: film for film in self._get_all("films_cpt", "id,title,acf")
        }
        shows = [
            parsed
            for show in self._get_all("shows_cpt", "id,link,title,acf")
            if (
                parsed := self._parse_show(
                    show, location_names=location_names, films=films, today=today
                )
            )
            is not None
        ]
        logger.info(f"LIFF: {len(shows)} upcoming screening(s) listed.")

        # One TMDB lookup per film, keyed by the festival's film id (or, for a
        # screening with no film post, by its own title).
        film_keys = {show.film_id or show.title for show in shows}

        def resolve(key: int | str) -> tuple[int | str, MovieCreate | None]:
            if isinstance(key, int):
                film = films[key]
                return key, self._resolve_movie(
                    title=_post_title(film), film_acf=film.get("acf") or {}
                )
            return key, self._resolve_movie(title=key, film_acf={})

        movies: dict[int | str, MovieCreate] = {}
        with ThreadPoolExecutor(max_workers=self.item_concurrency()) as executor:
            futures = [executor.submit(resolve, key) for key in film_keys]
            for future in as_completed(futures):
                try:
                    key, movie = future.result()
                except Exception:
                    logger.exception("LIFF: failed to resolve a film")
                    continue
                if movie is not None:
                    movies[key] = movie

        unresolved = [
            show for show in shows if (show.film_id or show.title) not in movies
        ]
        if unresolved:
            logger.warning(
                f"LIFF: {len(unresolved)} screening(s) skipped for want of a TMDB "
                f"match: {sorted({show.title for show in unresolved})}"
            )

        observed: list[tuple[str, int]] = []
        with get_db_context() as session:
            for movie in {movie.id: movie for movie in movies.values()}.values():
                movies_service.upsert_movie(
                    session=session, movie_create=movie, commit=False
                )
            for show in shows:
                movie = movies.get(show.film_id or show.title)
                if movie is None:
                    continue
                film_acf = _film_acf(films, show.film_id)
                cinema_id, room = self._cinema_for_location(show.location_name)
                showtime_create = ShowtimeCreate(
                    movie_id=movie.id,
                    tmdb_cache_id=movie.tmdb_cache_id,
                    cinema_id=cinema_id,
                    datetime=show.start,
                    end_datetime=show.end,
                    ticket_link=show.ticket_link,
                    room=room,
                    subtitles=show.subtitles,
                    festival_id=self.cinema_id,
                    cineville_pass=(
                        _int_or_none(film_acf.get("section"))
                        in competition_section_ids
                    ),
                )
                festivals_service.adopt_placeholder_showtime(
                    session=session, showtime_create=showtime_create
                )
                showtime = showtimes_service.upsert_showtime(
                    session=session, showtime_create=showtime_create, commit=False
                )
                if showtime is None:
                    continue
                observed.append(
                    (
                        scrape_sync_service.showtime_identity_event_key(
                            movie_id=showtime.movie_id,
                            cinema_id=showtime.cinema_id,
                            dt=showtime.datetime,
                        ),
                        showtime.id,
                    )
                )
            session.commit()
        return observed
