import asyncio
from time import perf_counter

from aiohttp import ClientSession
from bs4 import BeautifulSoup

from app.exceptions import scraper_exceptions

from . import logger
from .utils import get_page_async
from .watchlist import extract_slugs_from_page


def extract_total_pages(page: BeautifulSoup) -> int:
    """Return the number of "films watched" pages from the pagination control.

    The films page renders a ``div.paginate-pages`` list whose last numeric
    link is the total page count (e.g. "1 2 3 … 10"). Returns 1 when there is
    no pagination (a single page of films).
    """
    paginate = page.find(class_="paginate-pages")
    if paginate is None:
        return 1
    page_numbers = [
        int(text)
        for link in paginate.find_all("a")
        if (text := link.get_text(strip=True)).isdigit()
    ]
    return max(page_numbers) if page_numbers else 1


async def get_watched_page_async(
    session: ClientSession, username: str, page_num: int = 1
):
    """
    Asynchronously fetches a specific "films watched" page for a user.
    Returns a BeautifulSoup object if successful, None otherwise.
    """
    url = f"https://letterboxd.com/{username}/films/page/{page_num}/"
    try:
        page = await get_page_async(
            session=session,
            url=url,
            diagnostics_context="watched" if page_num == 1 else None,
        )
        if not page:
            logger.error(f"Failed to fetch watched page {page_num} for user {username}")
            return None
        return page
    except Exception as e:
        logger.error(f"Error fetching watched page {page_num} for user {username}: {e}")
        return None


def get_watched(username: str) -> list[str]:
    start = perf_counter()
    slugs = asyncio.run(get_watched_async(username=username))
    end = perf_counter()
    logger.info(
        f"Fetched {len(slugs)} watched slugs for user {username} in {end - start:.2f} seconds."
    )
    return slugs


async def get_watched_async(username: str) -> list[str]:
    async with ClientSession() as session:
        first_page = await get_watched_page_async(
            session=session, username=username, page_num=1
        )
        if not first_page:
            logger.error(
                f"Failed to fetch the first page of watched films for user {username}"
            )
            raise scraper_exceptions.ScraperStructureError()

        total_pages = extract_total_pages(first_page)
        all_slugs = set(extract_slugs_from_page(page=first_page))

        # Fetch the remaining pages in parallel rather than stopping at the first
        # page that happens to come back empty: a single transient empty/blocked
        # response must not silently truncate the result (mirrors the watchlist
        # scraper, which reads the page count up front).
        tasks = [
            get_watched_page_async(session=session, username=username, page_num=page_num)
            for page_num in range(2, total_pages + 1)
        ]
        pages = await asyncio.gather(*tasks)
        for page_num, page in enumerate(pages, start=2):
            if not page:
                logger.warning(
                    "Watched scrape for %s: page %s/%s failed to fetch.",
                    username,
                    page_num,
                    total_pages,
                )
                continue
            slugs = extract_slugs_from_page(page=page)
            if not slugs:
                logger.warning(
                    "Watched scrape for %s: page %s/%s returned 0 poster slugs.",
                    username,
                    page_num,
                    total_pages,
                )
                continue
            all_slugs.update(slugs)

        return list(all_slugs)
