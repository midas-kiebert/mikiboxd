from concurrent.futures import ThreadPoolExecutor, as_completed

from bs4 import BeautifulSoup

from . import logger
from .utils import get_page

MAX_WORKERS = 5


def get_watchlist_page(username: str, page_num: int = 1) -> BeautifulSoup | None:
    """
    Fetches a specific watchlist page for a user.
    Returns a BeautifulSoup object if successful, None otherwise.
    """
    url = f"https://letterboxd.com/{username}/watchlist/page/{page_num}/"
    logger.debug(f"Fetching watchlist page {page_num} for user {username}")
    try:
        page = get_page(url=url)
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
        if item.parent and "data-film-slug" in item.parent.attrs:
            slugs.append(str(item.parent["data-film-slug"]))
    return slugs

def fetch_slugs(username: str, page_num: int) -> list[str]:
    """
    Fetches slugs from a specific watchlist page for a user.
    Returns a list of slugs.
    """
    page = get_watchlist_page(username=username, page_num=page_num)
    if not page:
        return []
    return extract_slugs_from_page(page=page)


def get_watchlist(username: str) -> list[str]:
    logger.info(f"Fetching watchlist for user: {username}...")
    all_slugs = []
    seen_slugs = set()

    page_1 = get_watchlist_page(username=username, page_num=1)
    assert page_1

    count_span = page_1.find("span", class_="js-watchlist-count")
    assert count_span
    count_str: str = count_span.text
    count = int(count_str.split()[0])

    slugs_1 = extract_slugs_from_page(page=page_1)
    if not slugs_1:
        logger.warning(f"No watchlist found for user {username}.")
        return []
    perpage = len(slugs_1)
    pages = (count // perpage) + 1

    all_slugs.extend(slugs_1)
    seen_slugs.update(slugs_1)

    # Use ThreadPoolExecutor to fetch multiple pages concurrently
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
        futures = {
            executor.submit(fetch_slugs, username, page_num) : page_num
            for page_num in range(2, pages + 1)
        }

        for future in as_completed(futures):
            slugs = future.result()
            for slug in slugs:
                if slug not in seen_slugs:
                    all_slugs.append(slug)
                    seen_slugs.add(slug)

    return all_slugs
