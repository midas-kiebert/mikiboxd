import asyncio
from time import perf_counter

from aiohttp import ClientSession

from . import logger
from .utils import get_page_async
from .watchlist import extract_slugs_from_page


async def get_watched_page_async(session: ClientSession, username: str, page_num: int = 1):
    """
    Asynchronously fetches a specific "films watched" page for a user.
    Returns a BeautifulSoup object if successful, None otherwise.
    """
    url = f"https://letterboxd.com/{username}/films/page/{page_num}/"
    try:
        page = await get_page_async(session=session, url=url)
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
        all_slugs: set[str] = set()
        page_num = 1
        while True:
            page = await get_watched_page_async(
                session=session, username=username, page_num=page_num
            )
            if not page:
                break
            slugs = extract_slugs_from_page(page=page)
            if not slugs:
                break
            all_slugs.update(slugs)
            page_num += 1

        return list(all_slugs)
