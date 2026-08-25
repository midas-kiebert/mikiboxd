import json
import re
import struct
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from bs4.element import Tag
from pydantic import BaseModel

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.logger import logger
from app.scraping.subtitles import parse_subtitle_freetext
from app.scraping.title_hints import (
    parse_subtitle_hint_from_title,
    parse_year_hint_from_title,
)
from app.scraping.tmdb_lookup import find_tmdb_id, get_tmdb_lookup_cache_id
from app.scraping.tmdb_movie_details import get_tmdb_movie_details
from app.services import movies as movies_service
from app.services import scrape_sync as scrape_sync_service
from app.services import showtimes as showtimes_service

CINEMA_KEY = "fc-hyena"

FILMS_URL = "https://fchyena.nl/films"

# fchyena.nl migrated to Framer, which renders the film list client-side from
# a CMS collection instead of server-rendered HTML, so there is no
# <li class="film"> markup to scrape anymore. This is the id Framer assigns
# to the "Films" collection's compiled code component; it comes from the
# component's node id in the Framer document and stays fixed across ordinary
# republishes (only the hash suffix in its chunk filename rotates), so it's
# used to find the right chunk without fetching every script on the page.
FILMS_COMPONENT_ID = "Fs7yzW3IK"

_MODULE_PRELOAD_RE = re.compile(
    r'<link rel="modulepreload"[^>]*href="(https://framerusercontent\.com/sites/[^"]+\.mjs)"'
)
_DATA_MODULE_URL_RE = re.compile(r"https://framerusercontent\.com/modules/[^\"'`]+\.js")
_CMS_CHUNK_RE = re.compile(r'chunks:\[new URL\("(\./[^"]+\.framercms)"')
_PROPERTY_CONTROL_RE = re.compile(r"([A-Za-z0-9_]+):\{([^{}]*)\}")
_TITLE_RE = re.compile(r"title:`([^`]*)`")

_CMS_FIELD_TITLES = (
    "Production ID",
    "Slug",
    "Ticket link",
    "Title",
    "Director",
    "Cast",
    "Language, Subtitles",
    "Year",
)


class FramerCmsError(Exception):
    """Raised when fchyena.nl's Framer CMS film data can't be located or parsed."""


class CmsFilm(BaseModel):
    production_id: str
    title: str
    director: str | None = None
    cast: str | None = None
    language: str | None = None
    year: str | None = None


class _FramerBinaryReader:
    """Reads Framer's undocumented binary CMS export format.

    Reverse-engineered from fchyena.nl's compiled JS after its migration off
    server-rendered HTML: a type-tagged, name/value record stream. Each
    record carries its own field count because fields left empty are omitted
    entirely rather than written out as a null value.
    """

    __slots__ = ("data", "offset")

    def __init__(self, data: bytes) -> None:
        self.data = data
        self.offset = 0

    def u8(self) -> int:
        value = self.data[self.offset]
        self.offset += 1
        return value

    def u16(self) -> int:
        value = int.from_bytes(self.data[self.offset : self.offset + 2], "big")
        self.offset += 2
        return value

    def u32(self) -> int:
        value = int.from_bytes(self.data[self.offset : self.offset + 4], "big")
        self.offset += 4
        return value

    def i64(self) -> int:
        value = int.from_bytes(
            self.data[self.offset : self.offset + 8], "big", signed=True
        )
        self.offset += 8
        return value

    def f64(self) -> float:
        (value,) = struct.unpack_from(">d", self.data, self.offset)
        self.offset += 8
        return value

    def string(self) -> str:
        length = self.u32()
        value = self.data[self.offset : self.offset + length].decode("utf-8")
        self.offset += length
        return value


def _read_framer_value(reader: _FramerBinaryReader) -> object:
    tag = reader.u8()
    if tag == 0:  # null
        return None
    if tag == 1:  # Array
        return [_read_framer_value(reader) for _ in range(reader.u16())]
    if tag == 2:  # Boolean
        return reader.u8() != 0
    if tag in (3, 5, 6, 12):  # Color, Enum, File, String
        return reader.string()
    if tag == 4:  # Date (epoch millis)
        return reader.i64()
    if tag in (7, 10):  # Link, ResponsiveImage (JSON payloads)
        return json.loads(reader.string())
    if tag == 8:  # Number
        return reader.f64()
    if tag == 9:  # Object
        return {
            reader.string(): _read_framer_value(reader) for _ in range(reader.u16())
        }
    if tag == 11:  # RichText
        flag = reader.u8()
        return reader.u32() if flag == 0 else reader.string()
    if tag == 13:  # VectorSetItem
        return reader.u32()
    raise FramerCmsError(f"Unknown Framer CMS field type tag {tag}")


def _parse_framer_cms_records(data: bytes) -> list[dict[str, object]]:
    reader = _FramerBinaryReader(data)
    record_count = reader.u32()
    records = []
    for _ in range(record_count):
        field_count = reader.u16()
        record: dict[str, object] = {}
        for _ in range(field_count):
            name = reader.string()
            record[name] = _read_framer_value(reader)
        records.append(record)
    return records


def _property_titles(component_js: str) -> dict[str, str]:
    """Map a CMS collection's human-readable field titles to their obfuscated keys.

    Framer assigns each field a random-looking id (e.g. `kQ0YfWdY0`) that's
    only guaranteed stable until the field itself is deleted and recreated.
    Resolving keys by title instead of hardcoding those ids keeps this
    working across ordinary republishes.
    """
    titles: dict[str, str] = {}
    for match in _PROPERTY_CONTROL_RE.finditer(component_js):
        key, body = match.group(1), match.group(2)
        title_match = _TITLE_RE.search(body)
        if title_match:
            titles[title_match.group(1)] = key
    return titles


def _find_films_component_url(html: str) -> str | None:
    for url in _MODULE_PRELOAD_RE.findall(html):
        if f"/{FILMS_COMPONENT_ID}." in url:
            return url
    for url in _MODULE_PRELOAD_RE.findall(html):
        if url.endswith(".mjs") and "framer.WHr7ivHY" not in url:
            try:
                response = requests.get(url, timeout=30)
                response.raise_for_status()
            except requests.RequestException:
                continue
            if "displayName:`Films`" in response.text:
                return url
    return None


def fetch_cms_films() -> list[CmsFilm]:
    """Read fchyena.nl's film catalogue out of its Framer CMS collection.

    The site is now fully client-rendered (no server-rendered `<li>` list),
    so the catalogue is read straight from the compiled binary CMS export the
    page's JS fetches at runtime instead.
    """
    response = requests.get(FILMS_URL, timeout=30)
    response.raise_for_status()

    component_url = _find_films_component_url(response.text)
    if component_url is None:
        raise FramerCmsError("Could not find the Films CMS collection component")

    component_response = requests.get(component_url, timeout=30)
    component_response.raise_for_status()
    component_js = component_response.text

    data_module_match = _DATA_MODULE_URL_RE.search(component_js)
    if data_module_match is None:
        raise FramerCmsError("Could not find the Films CMS data module URL")
    data_module_url = data_module_match.group()

    data_module_response = requests.get(data_module_url, timeout=30)
    data_module_response.raise_for_status()
    data_module_js = data_module_response.text

    chunk_urls = [
        urljoin(data_module_url, relative_url).replace("/modules/", "/cms/")
        for relative_url in _CMS_CHUNK_RE.findall(data_module_js)
    ]
    if not chunk_urls:
        raise FramerCmsError("Could not find any Films CMS data chunks")

    titles = _property_titles(component_js)
    missing_titles = [title for title in _CMS_FIELD_TITLES if title not in titles]
    if missing_titles:
        raise FramerCmsError(
            f"Films CMS collection is missing fields: {missing_titles}"
        )

    films: list[CmsFilm] = []
    for chunk_url in chunk_urls:
        chunk_response = requests.get(chunk_url, timeout=30)
        chunk_response.raise_for_status()
        for record in _parse_framer_cms_records(chunk_response.content):
            production_id = record.get(titles["Production ID"])
            title = record.get(titles["Title"])
            if not isinstance(production_id, str) or not isinstance(title, str):
                continue
            director = record.get(titles["Director"])
            cast = record.get(titles["Cast"])
            language = record.get(titles["Language, Subtitles"])
            year = record.get(titles["Year"])
            films.append(
                CmsFilm(
                    production_id=production_id,
                    title=title,
                    director=director if isinstance(director, str) else None,
                    cast=cast if isinstance(cast, str) else None,
                    language=language if isinstance(language, str) else None,
                    year=year if isinstance(year, str) and year else None,
                )
            )
    return films


def clean_title(title: str) -> str:
    title = title.lower()
    title = re.sub(r"\(.*\)", "", title)  # Remove everything in parentheses
    # Only trim trailing subtitle-like suffixes when dash acts as a separator.
    title = re.sub(r"\s+[-–—]\s+.*$", "", title)
    title = re.sub(r"\s+", " ", title).strip()  # Normalize whitespace
    return title


class FCHyenaScraper(BaseCinemaScraper):
    def __init__(self) -> None:
        self.cinema_key = CINEMA_KEY
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_key(
                session=session, key=CINEMA_KEY
            )

    def _process_film(
        self,
        film: CmsFilm,
    ) -> tuple[MovieCreate, list[ShowtimeCreate]] | None:
        assert self.cinema_id is not None
        title_query = clean_title(film.title)
        directors = (
            [name.strip() for name in film.director.split(",")] if film.director else []
        )
        actor = film.cast.strip().split(",")[0].strip() if film.cast else None
        subtitles = parse_subtitle_freetext(film.language)
        if subtitles is None:
            subtitles = parse_subtitle_hint_from_title(film.title)
        year = int(film.year) if film.year and film.year.isdigit() else None
        if year is None:
            year = parse_year_hint_from_title(film.title)

        tmdb_id = find_tmdb_id(
            title_query=title_query,
            director_names=directors,
            actor_name=actor,
            year=year,
        )
        if tmdb_id is None:
            logger.warning(f"No TMDB id found for {title_query}, skipping")
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
            year=year,
        )
        tmdb_directors = (
            tmdb_details.directors if tmdb_details is not None else list(directors)
        )
        movie = MovieCreate(
            id=int(tmdb_id),
            tmdb_cache_id=tmdb_cache_id,
            title=tmdb_details.title if tmdb_details is not None else film.title,
            letterboxd_slug=None,
            directors=tmdb_directors if tmdb_directors else None,
            release_year=(
                tmdb_details.release_year if tmdb_details is not None else year
            ),
            duration=(
                tmdb_details.runtime_minutes if tmdb_details is not None else None
            ),
            languages=(
                tmdb_details.spoken_languages if tmdb_details is not None else None
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

        showtimes_url = (
            "https://tickets.fchyena.nl/fchyena/nl/flow_configs/1/z_events_list"
            f"?production_id={film.production_id}"
        )
        showtimes_response = requests.get(showtimes_url, timeout=30)
        showtimes_response.raise_for_status()
        showtimes_soup = BeautifulSoup(showtimes_response.text, "html.parser")
        rows = showtimes_soup.find_all("tr")
        showtimes: list[ShowtimeCreate] = []
        for row in rows:
            if not isinstance(row, Tag):
                continue
            dt, ticket_link = parse_showtime(row)
            showtimes.append(
                ShowtimeCreate(
                    movie_id=movie.id,
                    tmdb_cache_id=movie.tmdb_cache_id,
                    datetime=dt,
                    cinema_id=self.cinema_id,
                    ticket_link=ticket_link,
                    subtitles=subtitles,
                )
            )
        return movie, showtimes

    def scrape(self) -> list[tuple[str, int]]:
        assert self.cinema_id is not None
        films = fetch_cms_films()

        if not films:
            logger.debug("No films found in FC Hyena")

        max_workers = min(len(films), self.item_concurrency()) or 1
        movies_by_id: dict[int, MovieCreate] = {}
        showtimes: list[ShowtimeCreate] = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(self._process_film, film) for film in films]
            for future in as_completed(futures):
                try:
                    result = future.result()
                except Exception:
                    logger.exception("Error processing FC Hyena film entry")
                    continue
                if result is None:
                    continue
                movie, movie_showtimes = result
                movies_by_id[movie.id] = movie
                showtimes.extend(movie_showtimes)

        observed_presences: list[tuple[str, int]] = []
        with get_db_context() as session:
            for movie_create in movies_by_id.values():
                movies_service.upsert_movie(
                    session=session,
                    movie_create=movie_create,
                    commit=False,
                )
            for showtime_create in showtimes:
                showtime = showtimes_service.upsert_showtime(
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


def parse_showtime(row: Tag) -> tuple[datetime, str]:
    date_element, button = row.find_all("p")
    date_str = date_element.text
    dt = get_datetime(date_str)
    link_element = button.find_next("a")
    assert isinstance(link_element, Tag)
    ticket_link = f"https://tickets.fchyena.nl{link_element.get('href')}"
    return dt, ticket_link


months: dict[str, int] = {
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


def get_datetime(date_str: str) -> datetime:
    parts = date_str.split()
    day = int(parts[1])
    month = months[parts[2].lower()]
    year = int(parts[3].rstrip(","))
    time_str = parts[4]

    dt_str = f"{day}-{month}-{year} {time_str}"

    dt = datetime.strptime(dt_str, "%d-%m-%Y %H:%M")
    # logger.trace(f"{dt = }")
    return dt
