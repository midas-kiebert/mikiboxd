import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from typing import Any

import requests
from bs4 import BeautifulSoup, Tag

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.logger import logger
from app.scraping.subtitles import parse_subtitle_label
from app.scraping.tmdb_lookup import find_tmdb_id
from app.scraping.tmdb_movie_details import get_tmdb_movie_details
from app.services import movies as movies_services
from app.services import scrape_sync as scrape_sync_service
from app.services import showtimes as showtimes_services

FEED_DAYS = 28
FEED_URL_TEMPLATE = "https://rialtofilm.nl/feed/nl/program/{building_id}/{days}"

_NAME_SPLIT_RE = re.compile(r"[,&]")

# Rialto suffixes its program title with screening-variant/strand metadata
# (e.g. "Divine Comedy - eng subs", "Yellow Letters - Cineville Preview"),
# which would otherwise pollute the TMDB title match. The actual subtitle
# language is read from the film page's "Ondertiteling" field instead, so
# this is only needed to recover a clean title for lookup/display.
_TITLE_SUFFIX_RE = re.compile(
    r"\s*-\s*(eng subs|cineville preview|hot town,\s*summer in the city)\s*$",
    re.IGNORECASE,
)


def clean_title(title: str) -> str:
    return _TITLE_SUFFIX_RE.sub("", title).strip()


def split_names(value: str | None) -> list[str]:
    if not value:
        return []
    return [name.strip() for name in _NAME_SPLIT_RE.split(value) if name.strip()]


def extract_detail_value(soup: BeautifulSoup, label: str) -> str | None:
    """Return the text of the ``<dd>`` following a ``<dt>label</dt>`` spec row."""
    for dt in soup.find_all("dt", class_="detail__label"):
        if not (isinstance(dt, Tag) and dt.get_text(strip=True) == label):
            continue
        dd = dt.find_next_sibling("dd", class_="detail__info")
        if not isinstance(dd, Tag):
            return None
        return re.sub(r"\s+", " ", dd.get_text(strip=True)).strip() or None
    return None


def parse_minutes(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"\d+", value)
    return int(match.group()) if match else None


def parse_year(value: str | None) -> int | None:
    if value and value.strip().isdigit():
        return int(value.strip())
    return None


class RialtoScraper(BaseCinemaScraper):
    def __init__(self, cinema: str, building_id: int) -> None:
        self.cinema = cinema
        self.building_id = building_id
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_name(
                session=session, name=cinema
            )
            if not self.cinema_id:
                logger.error(f"Cinema {cinema} not found in database")
                raise ValueError(f"Cinema {cinema} not found in database")

    def _process_film_group(
        self, film_id: int, programs: list[dict[str, Any]]
    ) -> tuple[MovieCreate, list[ShowtimeCreate]] | None:
        assert self.cinema_id is not None
        title_query = clean_title(programs[0]["title"])
        film_url = programs[0]["film_url"]

        response = requests.get(film_url, timeout=15)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")

        directors = split_names(extract_detail_value(soup, "Regisseur"))
        spoken_languages = split_names(extract_detail_value(soup, "Taal")) or None
        fallback_subtitles = parse_subtitle_label(
            extract_detail_value(soup, "Ondertiteling")
        )
        duration = parse_minutes(extract_detail_value(soup, "Duur"))
        year = parse_year(extract_detail_value(soup, "Jaartal"))

        tmdb_id = find_tmdb_id(
            title_query=title_query,
            director_names=directors,
            year=year,
            duration_minutes=duration,
            spoken_languages=spoken_languages,
        )
        if tmdb_id is None:
            logger.warning(
                f"No TMDB id found for {title_query} ({self.cinema}), skipping"
            )
            return None

        tmdb_details = get_tmdb_movie_details(tmdb_id)
        if tmdb_details is None:
            logger.warning(
                f"TMDB details not found for TMDB ID {tmdb_id}; using fallback metadata."
            )

        tmdb_directors = (
            tmdb_details.directors if tmdb_details is not None else directors
        )
        movie = MovieCreate(
            id=int(tmdb_id),
            title=tmdb_details.title if tmdb_details is not None else title_query,
            letterboxd_slug=None,
            directors=tmdb_directors if tmdb_directors else None,
            release_year=(
                tmdb_details.release_year if tmdb_details is not None else year
            ),
            duration=(
                tmdb_details.runtime_minutes if tmdb_details is not None else duration
            ),
            languages=(
                tmdb_details.spoken_languages
                if tmdb_details is not None
                else spoken_languages
            ),
            original_title=(
                tmdb_details.original_title if tmdb_details is not None else None
            ),
            tmdb_last_enriched_at=(
                tmdb_details.enriched_at if tmdb_details is not None else None
            ),
        )

        showtimes: list[ShowtimeCreate] = []
        for program in programs:
            date = program.get("date")
            starts_at = program.get("starts_at")
            try:
                showtime_dt = datetime.strptime(
                    f"{date} {starts_at}", "%Y-%m-%d %H:%M"
                )
            except (TypeError, ValueError):
                logger.warning(
                    f"Could not parse Rialto showtime '{date} {starts_at}' "
                    f"for {title_query}, skipping"
                )
                continue

            showtimes.append(
                ShowtimeCreate(
                    movie_id=movie.id,
                    datetime=showtime_dt,
                    cinema_id=self.cinema_id,
                    ticket_link=program.get("url"),
                    subtitles=fallback_subtitles,
                )
            )
        return movie, showtimes

    def scrape(self) -> list[tuple[str, int]]:
        assert self.cinema_id is not None
        response = requests.get(
            FEED_URL_TEMPLATE.format(building_id=self.building_id, days=FEED_DAYS),
            timeout=15,
        )
        response.raise_for_status()
        days: list[dict[str, Any]] = response.json()

        programs_by_film: dict[int, list[dict[str, Any]]] = {}
        for day in days:
            for program in day.get("programs", []):
                film_id = program.get("film_id")
                if film_id is None:
                    continue
                programs_by_film.setdefault(film_id, []).append(program)

        if not programs_by_film:
            logger.debug(f"No films found for {self.cinema}")
            return []

        max_workers = min(len(programs_by_film), self.item_concurrency()) or 1
        movies_by_id: dict[int, MovieCreate] = {}
        showtimes: list[ShowtimeCreate] = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_film_id = {
                executor.submit(self._process_film_group, film_id, programs): film_id
                for film_id, programs in programs_by_film.items()
            }
            for future in as_completed(future_to_film_id):
                film_id = future_to_film_id[future]
                try:
                    result = future.result()
                except Exception:
                    logger.exception(
                        f"Could not process Rialto film {film_id} for {self.cinema}"
                    )
                    continue
                if result is None:
                    continue
                movie, movie_showtimes = result
                movies_by_id[movie.id] = movie
                showtimes.extend(movie_showtimes)

        observed_presences: list[tuple[str, int]] = []
        with get_db_context() as session:
            for movie_create in movies_by_id.values():
                movies_services.upsert_movie(
                    session=session,
                    movie_create=movie_create,
                    commit=False,
                )
            for showtime_create in showtimes:
                showtime = showtimes_services.upsert_showtime(
                    session=session,
                    showtime_create=showtime_create,
                    commit=False,
                )
                source_event_key = scrape_sync_service.fallback_source_event_key(
                    movie_id=showtime_create.movie_id,
                    cinema_id=showtime_create.cinema_id,
                    dt=showtime_create.datetime,
                    ticket_link=showtime_create.ticket_link,
                )
                observed_presences.append((source_event_key, showtime.id))
            session.commit()
        return observed_presences


class RialtoDePijpScraper(RialtoScraper):
    def __init__(self) -> None:
        super().__init__(cinema="Rialto De Pijp", building_id=1)


class RialtoVUScraper(RialtoScraper):
    def __init__(self) -> None:
        super().__init__(cinema="Rialto VU", building_id=7)


if __name__ == "__main__":
    RialtoDePijpScraper().scrape()
    RialtoVUScraper().scrape()
