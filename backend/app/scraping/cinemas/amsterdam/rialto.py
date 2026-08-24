import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import requests
from bs4 import BeautifulSoup, Tag

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.logger import logger
from app.scraping.seat_availability import normalize_room
from app.scraping.subtitles import parse_subtitle_label
from app.scraping.tmdb_lookup import find_tmdb_id, get_tmdb_lookup_cache_id
from app.scraping.tmdb_movie_details import get_tmdb_movie_details
from app.services import movies as movies_services
from app.services import scrape_sync as scrape_sync_service
from app.services import showtimes as showtimes_services

# Rialto De Pijp and Rialto VU used to share one CMS (rialtofilm.nl/feed/...),
# but each has since moved to its own, unrelated ticketing platform: De Pijp to
# an ActiveTickets shop, VU (branded "Griffioen") to an Itix-backed site. They
# no longer share a data source or markup, hence two independent scrapers below.

_NAME_SPLIT_RE = re.compile(r"[,&]")

_DUTCH_MONTHS_FULL = {
    "januari": 1,
    "februari": 2,
    "maart": 3,
    "april": 4,
    "mei": 5,
    "juni": 6,
    "juli": 7,
    "augustus": 8,
    "september": 9,
    "oktober": 10,
    "november": 11,
    "december": 12,
}
_DUTCH_FULL_DATE_RE = re.compile(r"^\w+\s+(\d{1,2})\s+(\w+)\s+(\d{4})$")

# Rialto suffixes some titles with screening-variant/strand metadata (e.g.
# "A Bigger Splash - Hot Town, Summer in the City", "Kokuho - Previously
# Unreleased"), which would otherwise pollute the TMDB title match.
_TITLE_SUFFIX_RE = re.compile(
    r"\s*-\s*(eng subs|cineville preview(?:dagen)?|previously unreleased|"
    r"hot town,\s*summer in the city)\s*$",
    re.IGNORECASE,
)


def clean_title(title: str) -> str:
    return _TITLE_SUFFIX_RE.sub("", title).strip()


def split_names(value: str | None) -> list[str]:
    if not value:
        return []
    return [name.strip() for name in _NAME_SPLIT_RE.split(value) if name.strip()]


def parse_minutes(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"\d+", value)
    return int(match.group()) if match else None


def parse_dutch_full_date(date_text: str, time_text: str) -> datetime | None:
    """Parse e.g. ``"zaterdag 25 juli 2026"`` + ``"19:30"``."""
    match = _DUTCH_FULL_DATE_RE.match(date_text.strip())
    if not match:
        return None
    day_str, month_str, year_str = match.groups()
    month = _DUTCH_MONTHS_FULL.get(month_str.lower())
    if month is None:
        return None
    try:
        hour_str, minute_str = time_text.strip().split(":")
        return datetime(
            int(year_str), month, int(day_str), int(hour_str), int(minute_str)
        )
    except ValueError:
        return None


def select_text(soup: BeautifulSoup, selector: str) -> str | None:
    tag = soup.select_one(selector)
    if not isinstance(tag, Tag):
        return None
    return tag.get_text(strip=True) or None


def select_course_value(soup: BeautifulSoup, label: str) -> str | None:
    """Read one `course-label` / `course-value` span pair off a Rialto VU page.

    The spec list is a flat run of sibling spans rather than a table, so the
    value is whichever `course-value` follows the label we want.
    """
    for label_tag in soup.select("span.course-label"):
        if label_tag.get_text(strip=True) != label:
            continue
        value_tag = label_tag.find_next_sibling("span", class_="course-value")
        if isinstance(value_tag, Tag):
            return value_tag.get_text(strip=True) or None
    return None


class RialtoDePijpScraper(BaseCinemaScraper):
    """Scrapes Rialto De Pijp's ActiveTickets shop.

    The shop's homepage lists every currently bookable show (one entry per
    performance, not per film); each show's own detail page carries all the
    film metadata we need, so every listed show is fetched independently.
    """

    cinema_key = "rialto-de-pijp"
    TICKETS_BASE_URL = "https://tickets-depijp.rialtofilm.nl"
    _SHOW_LINK_RE = re.compile(r"^/nl-NL/Show/Details/")

    def __init__(self) -> None:
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_key(
                session=session, key=self.cinema_key
            )
            if not self.cinema_id:
                logger.error(f"Cinema {self.cinema_key} not found in database")
                raise ValueError(f"Cinema {self.cinema_key} not found in database")

    def _process_show_path(
        self, path: str
    ) -> tuple[MovieCreate, ShowtimeCreate] | None:
        assert self.cinema_id is not None
        url = f"{self.TICKETS_BASE_URL}{path}"
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")

        raw_title = select_text(soup, "h2.at-show-title")
        date_text = select_text(soup, "span.at-show-displaydate")
        time_text = select_text(soup, "span.at-show-starttime")
        if not raw_title or not date_text or not time_text:
            logger.warning(f"Could not parse Rialto De Pijp show at {url}, skipping")
            return None
        title_query = clean_title(raw_title)

        showtime_dt = parse_dutch_full_date(date_text, time_text)
        if showtime_dt is None:
            logger.warning(
                f"Could not parse Rialto De Pijp date '{date_text} {time_text}' "
                f"for {title_query}, skipping"
            )
            return None

        directors = split_names(
            select_text(soup, "div.at-show-property.at-show-director")
        )
        spoken_languages = (
            split_names(
                select_text(soup, "div.at-show-property.at-show-spokenlanguage")
            )
            or None
        )
        subtitles = parse_subtitle_label(
            select_text(soup, "div.at-show-property.at-show-subtitlelanguage")
        )
        duration = parse_minutes(
            select_text(soup, "div.at-show-property.at-show-runtime")
        )

        tmdb_id = find_tmdb_id(
            title_query=title_query,
            director_names=directors,
            duration_minutes=duration,
            spoken_languages=spoken_languages,
        )
        if tmdb_id is None:
            logger.warning(
                f"No TMDB id found for {title_query} ({self.cinema_key}), skipping"
            )
            return None

        tmdb_details = get_tmdb_movie_details(tmdb_id)
        if tmdb_details is None:
            logger.warning(
                f"TMDB details not found for TMDB ID {tmdb_id}; using fallback metadata."
            )

        tmdb_cache_id = get_tmdb_lookup_cache_id(
            title_query=title_query,
            director_names=directors,
            duration_minutes=duration,
            spoken_languages=spoken_languages,
        )
        tmdb_directors = (
            tmdb_details.directors if tmdb_details is not None else directors
        )
        movie = MovieCreate(
            id=int(tmdb_id),
            tmdb_cache_id=tmdb_cache_id,
            title=tmdb_details.title if tmdb_details is not None else title_query,
            letterboxd_slug=None,
            directors=tmdb_directors if tmdb_directors else None,
            release_year=(
                tmdb_details.release_year if tmdb_details is not None else None
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
            description=(
                tmdb_details.description if tmdb_details is not None else None
            ),
            tmdb_last_enriched_at=(
                tmdb_details.enriched_at if tmdb_details is not None else None
            ),
        )
        showtime = ShowtimeCreate(
            movie_id=movie.id,
            tmdb_cache_id=movie.tmdb_cache_id,
            datetime=showtime_dt,
            cinema_id=self.cinema_id,
            ticket_link=url,
            room=normalize_room(
                select_text(soup, "div.at-show-property.at-show-location")
            ),
            subtitles=subtitles,
        )
        return movie, showtime

    def scrape(self) -> list[tuple[str, int]]:
        assert self.cinema_id is not None
        response = requests.get(f"{self.TICKETS_BASE_URL}/", timeout=15)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")
        paths = sorted(
            {str(a["href"]) for a in soup.find_all("a", href=self._SHOW_LINK_RE)}
        )
        if not paths:
            logger.debug(f"No shows found for {self.cinema_key}")
            return []

        max_workers = min(len(paths), self.item_concurrency()) or 1
        movies_by_id: dict[int, MovieCreate] = {}
        showtimes: list[ShowtimeCreate] = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_path = {
                executor.submit(self._process_show_path, path): path for path in paths
            }
            for future in as_completed(future_to_path):
                path = future_to_path[future]
                try:
                    result = future.result()
                except Exception:
                    logger.exception(f"Could not process Rialto De Pijp show {path}")
                    continue
                if result is None:
                    continue
                movie, showtime = result
                movies_by_id[movie.id] = movie
                showtimes.append(showtime)

        observed_presences: list[tuple[str, int]] = []
        with get_db_context() as session:
            for movie_create in movies_by_id.values():
                movies_services.upsert_movie(
                    session=session,
                    movie_create=movie_create,
                    commit=False,
                )
            for showtime_create in showtimes:
                upserted_showtime = showtimes_services.upsert_showtime(
                    session=session,
                    showtime_create=showtime_create,
                    commit=False,
                )
                if upserted_showtime is not None:
                    source_event_key = scrape_sync_service.showtime_identity_event_key(
                        movie_id=showtime_create.movie_id,
                        cinema_id=showtime_create.cinema_id,
                        dt=showtime_create.datetime,
                    )
                    observed_presences.append((source_event_key, upserted_showtime.id))
            session.commit()
        return observed_presences


class RialtoVUScraper(BaseCinemaScraper):
    """Scrapes griffioen.vu.nl, the "Rialto VU Griffioen" venue site.

    ``/shows.php?type=film`` lists one (soonest) performance per film; each
    film's own page then carries the full "Datum / Tijd" dropdown with every
    performance, so films are deduplicated before their detail pages are
    fetched.
    """

    cinema_key = "rialto-vu"
    BASE_URL = "https://griffioen.vu.nl"
    _SHOW_ITEM_RE = re.compile(
        r"data-showid=\"\d+\" onclick=\"document\.location='(/film/[^']+)'\""
    )
    _DATE_SUFFIX_RE = re.compile(r"/(\d{2})-(\d{2})-(\d{4})-(\d{2})-(\d{2})$")
    _REGIE_LABEL_RE = re.compile(r"^Regie\s*$")

    def __init__(self) -> None:
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_key(
                session=session, key=self.cinema_key
            )
            if not self.cinema_id:
                logger.error(f"Cinema {self.cinema_key} not found in database")
                raise ValueError(f"Cinema {self.cinema_key} not found in database")

    def _fetch_unique_film_paths(self) -> list[str]:
        paths: dict[str, str] = {}
        page = 1
        while True:
            params: dict[str, str | int] = {"type": "film", "page": page}
            response = requests.get(
                f"{self.BASE_URL}/shows.php",
                params=params,
                timeout=15,
            )
            response.raise_for_status()
            data = response.json()
            for path in self._SHOW_ITEM_RE.findall(data.get("html", "")):
                segments = path.split("/")
                slug = segments[2] if len(segments) > 2 else path
                paths.setdefault(slug, path)
            total_pages = data.get("pages") or 1
            if page >= total_pages:
                break
            page += 1
        return list(paths.values())

    @staticmethod
    def _extract_info_fields(
        soup: BeautifulSoup, label_re: re.Pattern[str]
    ) -> dict[str, str]:
        strong = next(
            (
                tag
                for tag in soup.find_all("strong")
                if isinstance(tag, Tag) and label_re.match(tag.get_text(strip=True))
            ),
            None,
        )
        if strong is None or not isinstance(strong.parent, Tag):
            return {}
        fields: dict[str, str] = {}
        current_label: str | None = None
        parts: list[str] = []
        for child in strong.parent.contents:
            if isinstance(child, Tag) and child.name == "strong":
                if current_label is not None:
                    fields[current_label] = "".join(parts).strip()
                current_label = child.get_text(strip=True)
                parts = []
            elif isinstance(child, Tag) and child.name == "br":
                continue
            elif current_label is not None:
                parts.append(child.get_text() if isinstance(child, Tag) else str(child))
        if current_label is not None:
            fields[current_label] = "".join(parts).strip()
        return fields

    def _process_film_path(
        self, path: str
    ) -> tuple[MovieCreate, list[ShowtimeCreate]] | None:
        assert self.cinema_id is not None
        url = f"{self.BASE_URL}{path}"
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, "html.parser")

        h1 = soup.find("h1")
        if not isinstance(h1, Tag):
            logger.warning(f"No title found for Rialto VU film {path}, skipping")
            return None
        title_query = clean_title(h1.get_text(strip=True))

        fields = self._extract_info_fields(soup, self._REGIE_LABEL_RE)
        directors = split_names(fields.get("Regie"))
        cast = split_names(fields.get("Cast"))
        actor = cast[0] if cast else None
        spoken_languages = split_names(fields.get("Taal")) or None
        subtitles = parse_subtitle_label(fields.get("Ondertiteling"))
        duration = parse_minutes(fields.get("Speelduur"))

        tmdb_id = find_tmdb_id(
            title_query=title_query,
            director_names=directors,
            actor_name=actor,
            duration_minutes=duration,
            spoken_languages=spoken_languages,
        )
        if tmdb_id is None:
            logger.warning(
                f"No TMDB id found for {title_query} ({self.cinema_key}), skipping"
            )
            return None

        tmdb_details = get_tmdb_movie_details(tmdb_id)
        if tmdb_details is None:
            logger.warning(
                f"TMDB details not found for TMDB ID {tmdb_id}; using fallback metadata."
            )

        tmdb_cache_id = get_tmdb_lookup_cache_id(
            title_query=title_query,
            director_names=directors,
            actor_name=actor,
            duration_minutes=duration,
            spoken_languages=spoken_languages,
        )
        tmdb_directors = (
            tmdb_details.directors if tmdb_details is not None else directors
        )
        movie = MovieCreate(
            id=int(tmdb_id),
            tmdb_cache_id=tmdb_cache_id,
            title=tmdb_details.title if tmdb_details is not None else title_query,
            letterboxd_slug=None,
            directors=tmdb_directors if tmdb_directors else None,
            release_year=(
                tmdb_details.release_year if tmdb_details is not None else None
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
            description=(
                tmdb_details.description if tmdb_details is not None else None
            ),
            tmdb_last_enriched_at=(
                tmdb_details.enriched_at if tmdb_details is not None else None
            ),
        )

        # A film with only one performance renders "Datum / Tijd" as a plain
        # value (no <select>); fall back to the date embedded in this page's
        # own URL in that case.
        option_values = [
            value
            for option in soup.select(
                "div.course-panel.film-panel select.course-value option"
            )
            if isinstance(value := option.get("value"), str)
        ] or [path]

        # The spec list describes the performance this page was opened for, so
        # the room may only be attached to that one — the other options in the
        # dropdown are different performances and can be in a different room.
        page_room = normalize_room(select_course_value(soup, "Ruimte"))

        showtimes: list[ShowtimeCreate] = []
        for value in option_values:
            match = self._DATE_SUFFIX_RE.search(value)
            if not match:
                continue
            day, month, year, hour, minute = (int(group) for group in match.groups())
            try:
                showtime_dt = datetime(year, month, day, hour, minute)
            except ValueError:
                logger.warning(
                    f"Could not parse Rialto VU showtime '{value}' for {title_query}, skipping"
                )
                continue
            showtimes.append(
                ShowtimeCreate(
                    movie_id=movie.id,
                    tmdb_cache_id=movie.tmdb_cache_id,
                    datetime=showtime_dt,
                    cinema_id=self.cinema_id,
                    ticket_link=f"{self.BASE_URL}{value}",
                    room=page_room if value == path else None,
                    subtitles=subtitles,
                )
            )
        return movie, showtimes

    def scrape(self) -> list[tuple[str, int]]:
        assert self.cinema_id is not None
        film_paths = self._fetch_unique_film_paths()
        if not film_paths:
            logger.debug(f"No films found for {self.cinema_key}")
            return []

        max_workers = min(len(film_paths), self.item_concurrency()) or 1
        movies_by_id: dict[int, MovieCreate] = {}
        showtimes: list[ShowtimeCreate] = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_path = {
                executor.submit(self._process_film_path, path): path
                for path in film_paths
            }
            for future in as_completed(future_to_path):
                path = future_to_path[future]
                try:
                    result = future.result()
                except Exception:
                    logger.exception(f"Could not process Rialto VU film {path}")
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
                if showtime is not None:
                    source_event_key = scrape_sync_service.showtime_identity_event_key(
                        movie_id=showtime_create.movie_id,
                        cinema_id=showtime_create.cinema_id,
                        dt=showtime_create.datetime,
                    )
                    observed_presences.append((source_event_key, showtime.id))
            session.commit()
        return observed_presences


if __name__ == "__main__":
    RialtoDePijpScraper().scrape()
    RialtoVUScraper().scrape()
