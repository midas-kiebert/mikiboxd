import asyncio
from time import perf_counter

from aiohttp import ClientSession
from bs4 import BeautifulSoup

from app.exceptions import scraper_exceptions

from . import logger
from .utils import get_page_async


async def get_watchlist_page_async(
    session: ClientSession, username: str, page_num: int = 1
) -> BeautifulSoup | None:
    """
    Asynchronously fetches a specific watchlist page for a user.
    Returns a BeautifulSoup object if successful, None otherwise.
    """
    url = f"https://letterboxd.com/{username}/watchlist/page/{page_num}/"
    try:
        page = await get_page_async(session=session, url=url)
        if not page:
            logger.error(f"Failed to fetch page {page_num} for user {username}")
            return None
        return page
    except Exception as e:
        logger.error(f"Error fetching page {page_num} for user {username}: {e}")
        return None


def extract_slugs_from_page(page: BeautifulSoup) -> list[str]:
    img_tags = page.find_all("img", class_="image")

    slugs: list[str] = []
    for item in img_tags:
        if not item.parent:
            logger.error("Image tag without parent found.")
            raise scraper_exceptions.ScraperStructureError()
        if not item.parent.parent:
            logger.error("Image tag parent without grandparent found.")
            raise scraper_exceptions.ScraperStructureError()
        if "data-item-slug" not in item.parent.parent.attrs:
            logger.error("Image tag parent grandparent without slug found.")
            raise scraper_exceptions.ScraperStructureError()
        slugs.append(str(item.parent.parent["data-item-slug"]))
    return slugs


def get_watchlist(username: str) -> list[str]:
    start = perf_counter()
    slugs = asyncio.run(get_watchlist_async(username=username))
    end = perf_counter()
    logger.info(
        f"Fetched {len(slugs)} watchlist slugs for user {username} in {end - start:.2f} seconds."
    )
    return slugs


async def get_watchlist_async(username: str) -> list[str]:
    async with ClientSession() as session:
        first_page = await get_watchlist_page_async(
            session=session, username=username, page_num=1
        )
        if not first_page:
            logger.error(
                f"Failed to fetch the first page of watchlist for user {username}"
            )
            raise scraper_exceptions.ScraperStructureError()

        count_span = first_page.find("span", class_="js-watchlist-count")
        if not count_span:
            logger.error("Count span not found in the first page of watchlist.")
            raise scraper_exceptions.ScraperStructureError()
        count_str: str = count_span.text
        count = int(count_str.split()[0])
        slugs_1 = extract_slugs_from_page(page=first_page)
        if count > 0 and not slugs_1:
            logger.error("No slugs found on the first page of watchlist.")
            raise scraper_exceptions.ScraperStructureError()
        perpage = len(slugs_1)
        total_pages = (count + perpage - 1) // perpage

        all_slugs = set(extract_slugs_from_page(page=first_page))

        tasks = [
            get_watchlist_page_async(session, username, page_num)
            for page_num in range(2, total_pages + 1)
        ]
        pages = await asyncio.gather(*tasks)
        for page in pages:
            if page:
                slugs = extract_slugs_from_page(page=page)
                all_slugs.update(slugs)

        return list(all_slugs)
