import asyncio
import json
import os
import random
import time
from dataclasses import dataclass
from threading import BoundedSemaphore, Event, Lock
from typing import Any
from urllib.parse import urlparse

import aiohttp
import requests
from bs4 import BeautifulSoup, Tag
from pydantic import BaseModel
from requests import Response

from app.exceptions import scraper_exceptions
from app.scraping.logger import logger

HEADERS = {
    "referer": "https://letterboxd.com",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "user-agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/133.0.0.0 Safari/537.36"
    ),
}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(0.0, float(raw))
    except ValueError:
        return default


LETTERBOXD_HTTP_CONCURRENCY = _env_int("LETTERBOXD_HTTP_CONCURRENCY", 4)
LETTERBOXD_HTTP_RETRIES = _env_int("LETTERBOXD_HTTP_RETRIES", 2)
LETTERBOXD_HTTP_BACKOFF_SECONDS = _env_float("LETTERBOXD_HTTP_BACKOFF_SECONDS", 0.4)
LETTERBOXD_REQUEST_TIMEOUT_SECONDS = _env_float(
    "LETTERBOXD_REQUEST_TIMEOUT_SECONDS",
    20.0,
)
LETTERBOXD_CF_BLOCK_SECONDS = _env_float("LETTERBOXD_CF_BLOCK_SECONDS", 900.0)
_letterboxd_http_sync_semaphore = BoundedSemaphore(LETTERBOXD_HTTP_CONCURRENCY)
_letterboxd_http_async_semaphore = asyncio.Semaphore(LETTERBOXD_HTTP_CONCURRENCY)
_letterboxd_challenge_block_lock = Lock()
_letterboxd_challenge_block_until: float = 0.0
_letterboxd_challenge_logged_until: float = 0.0

_letterboxd_cache_lock = Lock()
_letterboxd_cache: dict[int, "LetterboxdMovieData | None"] = {}
_letterboxd_inflight_lock = Lock()
_letterboxd_inflight: dict[int, Event] = {}


@dataclass(frozen=True)
class AsyncPageResponse:
    url: str
    text: str


class LetterboxdMovieData(BaseModel):
    slug: str
    poster_url: str | None
    title: str
    original_title: str | None
    release_year: int | None
    directors: list[str]
    rating: float | None = None
    top250: int | None = None


def _cache_get(tmdb_id: int) -> tuple[bool, LetterboxdMovieData | None]:
    with _letterboxd_cache_lock:
        if tmdb_id not in _letterboxd_cache:
            return False, None
        return True, _letterboxd_cache[tmdb_id]


def _cache_set(tmdb_id: int, value: LetterboxdMovieData | None) -> None:
    with _letterboxd_cache_lock:
        _letterboxd_cache[tmdb_id] = value


def _begin_inflight(tmdb_id: int) -> tuple[bool, Event]:
    with _letterboxd_inflight_lock:
        existing = _letterboxd_inflight.get(tmdb_id)
        if existing is not None:
            return False, existing
        event = Event()
        _letterboxd_inflight[tmdb_id] = event
        return True, event


def _finish_inflight(tmdb_id: int, event: Event) -> None:
    with _letterboxd_inflight_lock:
        current = _letterboxd_inflight.get(tmdb_id)
        if current is event:
            del _letterboxd_inflight[tmdb_id]
    event.set()


def _is_retryable_status(status: int) -> bool:
    return status in {403, 408, 425, 429, 500, 502, 503, 504}


def _retry_delay(attempt: int) -> float:
    jitter = random.uniform(0.0, 0.25)
    return LETTERBOXD_HTTP_BACKOFF_SECONDS * (2**attempt) + jitter


def _set_challenge_block() -> None:
    global _letterboxd_challenge_block_until, _letterboxd_challenge_logged_until
    now = time.monotonic()
    block_until = now + LETTERBOXD_CF_BLOCK_SECONDS
    with _letterboxd_challenge_block_lock:
        if block_until > _letterboxd_challenge_block_until:
            _letterboxd_challenge_block_until = block_until
        if now >= _letterboxd_challenge_logged_until:
            _letterboxd_challenge_logged_until = block_until
            logger.warning(
                "Letterboxd returned Cloudflare challenge; suppressing Letterboxd HTTP "
                f"calls for {LETTERBOXD_CF_BLOCK_SECONDS:.0f}s."
            )


def _challenge_block_active() -> bool:
    with _letterboxd_challenge_block_lock:
        return time.monotonic() < _letterboxd_challenge_block_until


def is_letterboxd_temporarily_blocked() -> bool:
    return _challenge_block_active()


def _is_cloudflare_challenge(headers: Any) -> bool:
    raw_value = None
    if hasattr(headers, "get"):
        raw_value = headers.get("cf-mitigated")
    value = str(raw_value) if raw_value is not None else ""
    return value.lower() == "challenge"


def get_page(url: str) -> Response | None:
    if _challenge_block_active():
        logger.debug(f"Skipping Letterboxd call during challenge cooldown: {url}")
        return None

    attempts = LETTERBOXD_HTTP_RETRIES + 1
    for attempt in range(attempts):
        try:
            with _letterboxd_http_sync_semaphore:
                response = requests.get(
                    url,
                    headers=HEADERS,
                    allow_redirects=True,
                    timeout=LETTERBOXD_REQUEST_TIMEOUT_SECONDS,
                )
        except requests.RequestException as e:
            if attempt < attempts - 1:
                delay = _retry_delay(attempt)
                logger.debug(
                    f"Retrying Letterboxd page {url} after request error ({type(e).__name__}): {delay:.2f}s"
                )
                time.sleep(delay)
                continue
            logger.warning(f"Failed to load page {url}. Error: {e}")
            return None

        if response.status_code == 200:
            return response

        if response.status_code == 404:
            return None

        if response.status_code == 403 and _is_cloudflare_challenge(response.headers):
            _set_challenge_block()
            return None

        if _is_retryable_status(response.status_code) and attempt < attempts - 1:
            delay = _retry_delay(attempt)
            logger.debug(
                f"Retrying Letterboxd page {url} after status {response.status_code}: {delay:.2f}s"
            )
            time.sleep(delay)
            continue

        logger.warning(
            f"Failed to load page {url}. Status code: {response.status_code}"
        )
        return None

    return None


async def get_page_async(
    *,
    session: aiohttp.ClientSession,
    url: str,
) -> AsyncPageResponse | None:
    if _challenge_block_active():
        logger.debug(f"Skipping Letterboxd call during challenge cooldown: {url}")
        return None

    attempts = LETTERBOXD_HTTP_RETRIES + 1
    for attempt in range(attempts):
        try:
            async with _letterboxd_http_async_semaphore:
                async with session.get(
                    url,
                    headers=HEADERS,
                    allow_redirects=True,
                ) as response:
                    text = await response.text()
                    if response.status == 200:
                        return AsyncPageResponse(url=str(response.url), text=text)
                    if response.status == 404:
                        return None
                    if response.status == 403 and _is_cloudflare_challenge(
                        dict(response.headers)
                    ):
                        _set_challenge_block()
                        return None
                    if _is_retryable_status(response.status) and attempt < attempts - 1:
                        delay = _retry_delay(attempt)
                        logger.debug(
                            f"Retrying Letterboxd page {url} after status {response.status}: {delay:.2f}s"
                        )
                        await asyncio.sleep(delay)
                        continue
                    logger.warning(
                        f"Failed to fetch page {url}. Status code: {response.status}"
                    )
                    return None
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            if attempt < attempts - 1:
                delay = _retry_delay(attempt)
                logger.debug(
                    f"Retrying Letterboxd page {url} after request error ({type(e).__name__}): {delay:.2f}s"
                )
                await asyncio.sleep(delay)
                continue
            logger.warning(f"Failed to load page {url}. Error: {e}")
            return None

    return None


def get_letterboxd_page(tmdb_id: int) -> Response | None:
    url = f"https://letterboxd.com/tmdb/{tmdb_id}/"
    return get_page(url)


async def get_letterboxd_page_async(
    *,
    session: aiohttp.ClientSession,
    tmdb_id: int,
) -> AsyncPageResponse | None:
    url = f"https://letterboxd.com/tmdb/{tmdb_id}/"
    return await get_page_async(session=session, url=url)


def parse_page(response: Response) -> BeautifulSoup:
    return BeautifulSoup(response.text, "lxml")


def parse_page_text(text: str) -> BeautifulSoup:
    return BeautifulSoup(text, "lxml")


def get_slug(response: Response) -> str:
    final_url = response.url
    slug = final_url.split("/")[-2]
    return slug


def get_slug_from_url(url: str) -> str | None:
    url_parts = [part for part in urlparse(url).path.split("/") if part]
    if not url_parts:
        return None
    return url_parts[-1]


def get_poster_url(slug: str) -> str | None:
    url = f"https://letterboxd.com/film/{slug}/poster/std/230/"
    response = get_page(url)
    if response is None:
        return None
    json = response.json()
    if not isinstance(json, dict):
        raise scraper_exceptions.ScraperStructureError()
    return json.get("url")


async def get_poster_url_async(
    *,
    session: aiohttp.ClientSession,
    slug: str,
) -> str | None:
    url = f"https://letterboxd.com/film/{slug}/poster/std/230/"
    response = await get_page_async(session=session, url=url)
    if response is None:
        return None

    try:
        payload = json.loads(response.text)
    except json.JSONDecodeError as e:
        logger.warning(f"Invalid poster payload for {url}. Error: {e}")
        return None

    if not isinstance(payload, dict):
        raise scraper_exceptions.ScraperStructureError()
    poster_url = payload.get("url")
    return poster_url if isinstance(poster_url, str) else None


def get_english_title(page: BeautifulSoup) -> str:
    title_tag = page.find("h1", class_="primaryname")
    if not isinstance(title_tag, Tag):
        raise scraper_exceptions.ScraperStructureError()
    span = title_tag.find("span", class_="name")
    if not isinstance(span, Tag):
        raise scraper_exceptions.ScraperStructureError()
    title_text = span.text
    if not isinstance(title_text, str):
        raise scraper_exceptions.ScraperStructureError()
    return title_text.strip()


def get_original_title(page: BeautifulSoup) -> str | None:
    original_title_tag = page.find("h2", class_="originalname")
    if not original_title_tag:
        return None
    if not isinstance(original_title_tag, Tag):
        raise scraper_exceptions.ScraperStructureError()
    em = original_title_tag.find("em")
    if not isinstance(em, Tag):
        raise scraper_exceptions.ScraperStructureError()
    original_title_text = em.text
    if not isinstance(original_title_text, str):
        raise scraper_exceptions.ScraperStructureError()
    return original_title_text.strip()


def get_year(page: BeautifulSoup) -> int | None:
    year_tag = page.find("span", class_="releasedate")
    if year_tag is None:
        return None
    if not isinstance(year_tag, Tag):
        raise scraper_exceptions.ScraperStructureError()
    a = year_tag.find("a")
    if not isinstance(a, Tag):
        raise scraper_exceptions.ScraperStructureError()
    year_text = a.text
    if not isinstance(year_text, str):
        raise scraper_exceptions.ScraperStructureError()
    year = int(year_text.strip())
    return year


def get_directors(page: BeautifulSoup) -> list[str]:
    creator_list = page.find("span", class_="creatorlist")
    if not creator_list:
        return []
    if not isinstance(creator_list, Tag):
        raise scraper_exceptions.ScraperStructureError()
    contributors = creator_list.find_all("a", class_="contributor")
    directors = []
    for contributor in contributors:
        if not isinstance(contributor, Tag):
            raise scraper_exceptions.ScraperStructureError()
        span = contributor.find("span")
        if not isinstance(span, Tag):
            raise scraper_exceptions.ScraperStructureError()
        name = span.text
        if not isinstance(name, str):
            raise scraper_exceptions.ScraperStructureError()
        directors.append(name.strip())
    return directors


def get_rating(slug: str) -> float | None:
    url = f"https://letterboxd.com/csi/film/{slug}/ratings-summary/"
    response = get_page(url)
    if response is None:
        return None
    page = BeautifulSoup(response.text, "lxml")
    rating_tag = page.find("a", class_="display-rating")
    if not isinstance(rating_tag, Tag):
        return None
    rating_text = rating_tag.text
    if not isinstance(rating_text, str):
        raise scraper_exceptions.ScraperStructureError()
    rating = float(rating_text.strip())
    return rating


async def get_rating_async(
    *,
    session: aiohttp.ClientSession,
    slug: str,
) -> float | None:
    url = f"https://letterboxd.com/csi/film/{slug}/ratings-summary/"
    response = await get_page_async(session=session, url=url)
    if response is None:
        return None
    page = BeautifulSoup(response.text, "lxml")
    rating_tag = page.find("a", class_="display-rating")
    if not isinstance(rating_tag, Tag):
        return None
    rating_text = rating_tag.text
    if not isinstance(rating_text, str):
        raise scraper_exceptions.ScraperStructureError()
    return float(rating_text.strip())


def get_top250_position(slug: str) -> int | None:
    url = f"https://letterboxd.com/csi/film/{slug}/stats/"
    response = get_page(url)
    if response is None:
        return None
    page = BeautifulSoup(response.text, "lxml")
    position_tag = page.find("div", class_="-top250")
    if not isinstance(position_tag, Tag):
        return None
    a = position_tag.find("a")
    if not isinstance(a, Tag):
        raise scraper_exceptions.ScraperStructureError()
    span = a.find("span")
    if not isinstance(span, Tag):
        raise scraper_exceptions.ScraperStructureError()
    position_text = span.text
    if not isinstance(position_text, str):
        raise scraper_exceptions.ScraperStructureError()
    position = int(position_text.strip())
    return position


async def get_top250_position_async(
    *,
    session: aiohttp.ClientSession,
    slug: str,
) -> int | None:
    url = f"https://letterboxd.com/csi/film/{slug}/stats/"
    response = await get_page_async(session=session, url=url)
    if response is None:
        return None
    page = BeautifulSoup(response.text, "lxml")
    position_tag = page.find("div", class_="-top250")
    if not isinstance(position_tag, Tag):
        return None
    a = position_tag.find("a")
    if not isinstance(a, Tag):
        raise scraper_exceptions.ScraperStructureError()
    span = a.find("span")
    if not isinstance(span, Tag):
        raise scraper_exceptions.ScraperStructureError()
    position_text = span.text
    if not isinstance(position_text, str):
        raise scraper_exceptions.ScraperStructureError()
    return int(position_text.strip())


def film_not_found(response: Response) -> bool:
    page = BeautifulSoup(response.text, "lxml")
    not_found_tag = page.find("h1", class_="title")
    if not isinstance(not_found_tag, Tag):
        return False
    return not_found_tag.text == "Film not found"


def film_not_found_text(text: str) -> bool:
    page = BeautifulSoup(text, "lxml")
    not_found_tag = page.find("h1", class_="title")
    if not isinstance(not_found_tag, Tag):
        return False
    return not_found_tag.text == "Film not found"


def scrape_letterboxd(tmdb_id: int) -> LetterboxdMovieData | None:
    inflight_event: Event
    while True:
        cache_hit, cached = _cache_get(tmdb_id)
        if cache_hit:
            logger.debug(f"Letterboxd cache hit for TMDB ID {tmdb_id}")
            return cached
        is_owner, inflight_event = _begin_inflight(tmdb_id)
        if is_owner:
            break
        logger.debug(f"Letterboxd single-flight wait for TMDB ID {tmdb_id}")
        inflight_event.wait()

    try:
        response = get_letterboxd_page(tmdb_id)
        if response is None:
            result = None
        else:
            slug = get_slug(response)
            if slug is None:
                result = None
            else:
                parsed_page = parse_page(response)
                if film_not_found(response):
                    logger.warning(f"Letterboxd page not found for TMDB ID {tmdb_id}")
                    result = None
                else:
                    poster_url = get_poster_url(slug)
                    title = get_english_title(parsed_page)
                    original_title = get_original_title(parsed_page)
                    release_year = get_year(parsed_page)
                    directors = get_directors(parsed_page)
                    rating = get_rating(slug)
                    top250 = get_top250_position(slug)
                    result = LetterboxdMovieData(
                        slug=slug,
                        poster_url=poster_url,
                        title=title,
                        original_title=original_title,
                        release_year=release_year,
                        directors=directors,
                        rating=rating,
                        top250=top250,
                    )
        _cache_set(tmdb_id, result)
        return result
    finally:
        _finish_inflight(tmdb_id, inflight_event)


async def scrape_letterboxd_async(
    *,
    tmdb_id: int,
    session: aiohttp.ClientSession | None = None,
) -> LetterboxdMovieData | None:
    inflight_event: Event
    while True:
        cache_hit, cached = _cache_get(tmdb_id)
        if cache_hit:
            logger.debug(f"Letterboxd cache hit for TMDB ID {tmdb_id}")
            return cached
        is_owner, inflight_event = _begin_inflight(tmdb_id)
        if is_owner:
            break
        logger.debug(f"Letterboxd single-flight wait for TMDB ID {tmdb_id}")
        await asyncio.to_thread(inflight_event.wait)

    local_session = session
    close_session = local_session is None
    try:
        if close_session:
            local_session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=LETTERBOXD_REQUEST_TIMEOUT_SECONDS)
            )
        assert local_session is not None

        response = await get_letterboxd_page_async(
            session=local_session, tmdb_id=tmdb_id
        )
        if response is None:
            result = None
            _cache_set(tmdb_id, result)
            return result

        slug = get_slug_from_url(response.url)
        if slug is None:
            result = None
            _cache_set(tmdb_id, result)
            return result

        parsed_page = parse_page_text(response.text)
        if film_not_found_text(response.text):
            logger.warning(f"Letterboxd page not found for TMDB ID {tmdb_id}")
            result = None
            _cache_set(tmdb_id, result)
            return result

        poster_url, rating, top250 = await asyncio.gather(
            get_poster_url_async(session=local_session, slug=slug),
            get_rating_async(session=local_session, slug=slug),
            get_top250_position_async(session=local_session, slug=slug),
        )

        title = get_english_title(parsed_page)
        original_title = get_original_title(parsed_page)
        release_year = get_year(parsed_page)
        directors = get_directors(parsed_page)

        result = LetterboxdMovieData(
            slug=slug,
            poster_url=poster_url,
            title=title,
            original_title=original_title,
            release_year=release_year,
            directors=directors,
            rating=rating,
            top250=top250,
        )
        _cache_set(tmdb_id, result)
        return result
    finally:
        if close_session and local_session is not None:
            await local_session.close()
        _finish_inflight(tmdb_id, inflight_event)


if __name__ == "__main__":
    tmdb_id = 570685
    logger.info(f"Scraping Letterboxd data for TMDB ID {tmdb_id}")
    data = scrape_letterboxd(tmdb_id)
    logger.info(f"Data: {data}")
