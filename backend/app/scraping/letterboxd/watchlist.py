from . import logger
from .utils import get_page


def get_watchlist(username: str) -> list[str]:
    logger.info(f"Fetching watchlist for user: {username}...")
    page_num = 1
    watchlist: list[str] = []
    while True:
        # logger.trace(f"Fetching watchlist page {page_num} for user {username}")
        url = f"https://letterboxd.com/{username}/watchlist/page/{page_num}/"
        page = get_page(url=url)

        # logger.trace(f"Getting posters from watchlist page {page_num} for user {username}")
        img = page.find_all(
            "img",
            {
                "class": ["image"],
            },
        )

        watchlist_count = len(watchlist)
        if not img:
            break

        for item in img:
            if not item.parent or "data-film-slug" not in item.parent.attrs:
                logger.warning(
                    f"Item without data-film-slug found on page {page_num}, skipping..."
                )
                continue
            slug = str(item.parent["data-film-slug"])
            watchlist.append(slug)
        if len(watchlist) == watchlist_count:
            break
        page_num += 1
    return watchlist
