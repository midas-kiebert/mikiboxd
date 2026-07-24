"""Scrape arbitrary Letterboxd lists (shared, cacheable).

A Letterboxd list lives at ``letterboxd.com/<owner>/list/<list-slug>/`` and is
not tied to the requesting user, so the scraped contents are cached and shared
across users (see :mod:`app.services.letterboxd_lists`). This module only knows
how to resolve a list reference (full URL or ``boxd.it`` shortlink) and scrape
its films + metadata.

Film slugs and pagination use the exact same markup as the watchlist/watched
pages, so we reuse :func:`extract_slugs_from_page` and
:func:`extract_total_pages`.
"""

import asyncio
import re
from dataclasses import dataclass
from datetime import datetime
from time import perf_counter
from urllib.parse import urlparse

import requests
from aiohttp import ClientSession
from bs4 import BeautifulSoup, Tag

from app.exceptions import scraper_exceptions
from app.utils import to_amsterdam_time

from . import logger
from .utils import HEADERS, get_page_async
from .watched import extract_total_pages
from .watchlist import extract_slugs_from_page

LETTERBOXD_HOST = "letterboxd.com"
BOXD_SHORTLINK_HOST = "boxd.it"
ALLOWED_SCHEMES = ("http", "https")
# Letterboxd usernames and list slugs are restricted to these characters. We
# validate the path segments before interpolating them into a fetch URL so a
# crafted URL can't smuggle in path traversal, query strings or other hosts.
SAFE_SEGMENT = re.compile(r"^[A-Za-z0-9_-]+$")
REDIRECT_RESOLVE_TIMEOUT = 15.0


def _is_letterboxd_host(host: str) -> bool:
    """True only for ``letterboxd.com`` itself or a real subdomain of it.

    A plain ``endswith`` check would also accept lookalike domains such as
    ``evilletterboxd.com``, so we require an exact match or a ``.`` delimiter.
    """
    return host == LETTERBOXD_HOST or host.endswith(f".{LETTERBOXD_HOST}")


@dataclass(frozen=True)
class ListRef:
    """A canonical reference to a Letterboxd list."""

    owner: str
    list_slug: str
    boxd_shortcode: str | None = None


@dataclass(frozen=True)
class ScrapedList:
    owner: str
    list_slug: str
    title: str | None
    last_updated: datetime | None
    slugs: list[str]


class InvalidListUrl(ValueError):
    """Raised when a string is not a recognisable Letterboxd list URL."""


def _ref_from_letterboxd_path(path: str, *, shortcode: str | None = None) -> ListRef:
    parts = [part for part in path.split("/") if part]
    # Expected: <owner>/list/<list-slug>[/page/N][/...]
    if len(parts) < 3 or parts[1] != "list":
        raise InvalidListUrl(f"Not a Letterboxd list path: /{path}")
    owner, list_slug = parts[0], parts[2]
    if not SAFE_SEGMENT.match(owner) or not SAFE_SEGMENT.match(list_slug):
        raise InvalidListUrl(f"Unsafe owner/list slug in path: /{path}")
    return ListRef(owner=owner, list_slug=list_slug, boxd_shortcode=shortcode)


def resolve_list_url(raw_url: str) -> ListRef:
    """Resolve a list URL or ``boxd.it`` shortlink to a canonical :class:`ListRef`.

    Accepts full list URLs (with or without a trailing ``/page/N/``) and
    ``boxd.it/<code>`` shortlinks, which are followed to their canonical
    Letterboxd URL.
    """
    candidate = raw_url.strip()
    if not candidate:
        raise InvalidListUrl("Empty list URL")
    if "://" not in candidate:
        candidate = f"https://{candidate}"

    parsed = urlparse(candidate)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise InvalidListUrl(f"Unsupported URL scheme: {parsed.scheme}")
    # ``hostname`` strips any ``user:pass@`` userinfo and ``:port``, so a URL
    # like ``https://letterboxd.com@evil.com/...`` is judged on its real host.
    host = (parsed.hostname or "").lower().removeprefix("www.")

    if host == BOXD_SHORTLINK_HOST:
        shortcode = parsed.path.strip("/").split("/")[0] or None
        resolved = _resolve_shortlink(candidate)
        resolved_host = (urlparse(resolved).hostname or "").lower().removeprefix("www.")
        if not _is_letterboxd_host(resolved_host):
            raise InvalidListUrl(
                f"Shortlink {raw_url} did not resolve to a Letterboxd list "
                f"(got {resolved})"
            )
        return _ref_from_letterboxd_path(urlparse(resolved).path, shortcode=shortcode)

    if _is_letterboxd_host(host):
        return _ref_from_letterboxd_path(parsed.path)

    raise InvalidListUrl(f"Unsupported list host: {host}")


def _resolve_shortlink(url: str) -> str:
    """Follow a ``boxd.it`` shortlink and return its final canonical URL."""
    try:
        response = requests.head(
            url,
            headers=HEADERS,
            allow_redirects=True,
            timeout=REDIRECT_RESOLVE_TIMEOUT,
        )
    except requests.RequestException as e:
        logger.error(f"Failed to resolve Letterboxd shortlink {url}: {e}")
        raise InvalidListUrl(f"Could not resolve shortlink {url}") from e
    return str(response.url)


def list_url(owner: str, list_slug: str, page_num: int = 1) -> str:
    base = f"https://letterboxd.com/{owner}/list/{list_slug}/"
    if page_num > 1:
        return f"{base}page/{page_num}/"
    return base


def extract_list_title(page: BeautifulSoup) -> str | None:
    meta = page.find("meta", attrs={"property": "og:title"})
    if isinstance(meta, Tag):
        content = meta.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
    heading = page.find("h1", class_="title-1")
    if isinstance(heading, Tag):
        text = heading.get_text(strip=True)
        if text:
            return text
    return None


def extract_last_updated(page: BeautifulSoup) -> datetime | None:
    """Return the list's last-updated time, falling back to its published time."""
    for css_class in ("updated", "published"):
        span = page.find("span", class_=css_class)
        if not isinstance(span, Tag):
            continue
        time_tag = span.find("time")
        if not isinstance(time_tag, Tag):
            continue
        raw = time_tag.get("datetime")
        if not isinstance(raw, str) or not raw:
            continue
        try:
            return to_amsterdam_time(raw)
        except ValueError:
            logger.warning("Could not parse Letterboxd list timestamp: %s", raw)
    return None


async def _get_list_page(
    session: ClientSession, owner: str, list_slug: str, page_num: int = 1
) -> BeautifulSoup | None:
    url = list_url(owner, list_slug, page_num)
    try:
        page = await get_page_async(session=session, url=url)
        if not page:
            logger.error(
                f"Failed to fetch list page {page_num} for {owner}/{list_slug}"
            )
            return None
        return page
    except Exception as e:
        logger.error(
            f"Error fetching list page {page_num} for {owner}/{list_slug}: {e}"
        )
        return None


def scrape_list(owner: str, list_slug: str) -> ScrapedList:
    start = perf_counter()
    result = asyncio.run(_scrape_list_async(owner=owner, list_slug=list_slug))
    end = perf_counter()
    logger.info(
        f"Scraped {len(result.slugs)} films from list {owner}/{list_slug} in "
        f"{end - start:.2f} seconds."
    )
    return result


def scrape_list_metadata(owner: str, list_slug: str) -> datetime | None:
    """Fetch only the first page and return the list's last-updated time.

    Used as a cheap freshness probe before committing to a full multi-page
    scrape.
    """
    return asyncio.run(_scrape_list_metadata_async(owner=owner, list_slug=list_slug))


async def _scrape_list_metadata_async(owner: str, list_slug: str) -> datetime | None:
    async with ClientSession() as session:
        first_page = await _get_list_page(session, owner, list_slug, page_num=1)
        if first_page is None:
            raise scraper_exceptions.ScraperStructureError()
        return extract_last_updated(first_page)


async def _scrape_list_async(owner: str, list_slug: str) -> ScrapedList:
    async with ClientSession() as session:
        first_page = await _get_list_page(session, owner, list_slug, page_num=1)
        if first_page is None:
            logger.error(f"Failed to fetch the first page of list {owner}/{list_slug}")
            raise scraper_exceptions.ScraperStructureError()

        title = extract_list_title(first_page)
        last_updated = extract_last_updated(first_page)
        total_pages = extract_total_pages(first_page)

        all_slugs = set(extract_slugs_from_page(page=first_page))

        tasks = [
            _get_list_page(session, owner, list_slug, page_num)
            for page_num in range(2, total_pages + 1)
        ]
        pages = await asyncio.gather(*tasks)
        for page in pages:
            if page:
                all_slugs.update(extract_slugs_from_page(page=page))

        return ScrapedList(
            owner=owner,
            list_slug=list_slug,
            title=title,
            last_updated=last_updated,
            slugs=list(all_slugs),
        )
