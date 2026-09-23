import asyncio
from time import perf_counter
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

from aiohttp import ClientSession
from bs4 import BeautifulSoup

from app.exceptions import scraper_exceptions

from . import logger
from .utils import SlugScrapeResult, get_page_async

# Gravatar's own resizing (the fallback when no picture is uploaded) is a
# documented, stable feature of their API — unlike Letterboxd's, below.
_GRAVATAR_SIZE_PX = 200


async def get_watchlist_page_async(
    session: ClientSession, username: str, page_num: int = 1
) -> BeautifulSoup | None:
    """
    Asynchronously fetches a specific watchlist page for a user.
    Returns a BeautifulSoup object if successful, None otherwise.
    """
    url = f"https://letterboxd.com/{username}/watchlist/page/{page_num}/"
    try:
        page = await get_page_async(
            session=session,
            url=url,
            diagnostics_context="watchlist" if page_num == 1 else None,
        )
        if not page:
            logger.error(f"Failed to fetch page {page_num} for user {username}")
            return None
        return page
    except Exception as e:
        logger.error(f"Error fetching page {page_num} for user {username}: {e}")
        return None


def _upsize_avatar_url(url: str) -> str:
    """Ask Gravatar for a bigger render than the ~80px default; leave an
    uploaded Letterboxd avatar exactly as scraped.

    An uploaded avatar's URL carries its crop size in the path (e.g.
    ``avtr-0-48-0-48-crop.jpg``), and asking for a size other than the one the
    page itself used looked, at first, like a documented trick — swap the
    number for a bigger one. It is not reliable: probing which sizes
    Letterboxd's CDN actually serves found an unpredictable mix of 200s and
    403s (`48`, `80`, `150`, `300` OK; `40`, `64`, `100`, `200`, `500` a 403)
    with no pattern by parity, roundness or magnitude, and no reason to think
    it is stable over time. The one size guaranteed to work is the one
    already in the URL: it is the literal address of an image that was just
    serving on the page this was scraped from. So this only touches Gravatar,
    whose ``size`` query param is documented and does not 403.
    """
    parts = urlsplit(url)
    if not parts.netloc.endswith("gravatar.com"):
        return url
    query = parse_qs(parts.query)
    if "size" not in query:
        return url
    query["size"] = [str(_GRAVATAR_SIZE_PX)]
    return urlunsplit(parts._replace(query=urlencode(query, doseq=True)))


def is_placeholder_avatar_url(url: str) -> bool:
    """Letterboxd's generic grey silhouette, served from a fixed
    ``s.ltrbxd.com/static/`` path for accounts with no picture of their own."""
    return urlsplit(url).netloc == "s.ltrbxd.com"


def extract_avatar_url_from_page(page: BeautifulSoup) -> str | None:
    """The scraped account's own profile picture, from the page's own header.

    Scoped to ``section.profile-header``, the block Letterboxd renders for the
    page's subject (``data-person="<username>"``) — not the signed-in-viewer
    avatar a logged-in session's nav bar would also carry, which this scraper
    never has anyway since it fetches without a session.

    An account with neither an uploaded picture nor a Gravatar match gets
    Letterboxd's own generic grey silhouette, served from a fixed
    ``s.ltrbxd.com/static/`` path rather than the per-account
    ``a.ltrbxd.com/resized/avatar/...`` one real pictures come from. That is
    treated as "no picture" — our own coloured-initial fallback reads better
    than someone else's placeholder — so this returns `None` for it, same as
    for an account with no picture at all.
    """
    header = page.find("section", class_="profile-header")
    if header is None:
        return None
    avatar_link = header.find("a", class_="avatar")
    if avatar_link is None:
        return None
    img = avatar_link.find("img")
    if img is None or not img.get("src"):
        return None
    src = str(img["src"])
    if is_placeholder_avatar_url(src):
        return None
    return _upsize_avatar_url(src)


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


def get_watchlist(username: str) -> SlugScrapeResult:
    start = perf_counter()
    result = asyncio.run(get_watchlist_async(username=username))
    end = perf_counter()
    logger.info(
        f"Fetched {len(result.slugs)} watchlist slugs for user {username} in "
        f"{end - start:.2f} seconds (complete={result.is_complete})."
    )
    return result


async def get_watchlist_async(username: str) -> SlugScrapeResult:
    async with ClientSession() as session:
        first_page = await get_watchlist_page_async(
            session=session, username=username, page_num=1
        )
        if not first_page:
            logger.error(
                f"Failed to fetch the first page of watchlist for user {username}"
            )
            raise scraper_exceptions.ScraperStructureError()

        # Read once here rather than passed down: every page after the first is
        # the same account's, so there is nothing more to learn from them, and
        # a page fetched for its slugs might fail its own structure check below
        # while still having carried a perfectly good avatar.
        avatar_url = extract_avatar_url_from_page(first_page)

        count_span = first_page.find("span", class_="js-watchlist-count")
        if not count_span:
            logger.error("Count span not found in the first page of watchlist.")
            raise scraper_exceptions.ScraperStructureError()
        count_str: str = count_span.text
        count = int(count_str.split()[0].replace(",", ""))
        slugs_1 = extract_slugs_from_page(page=first_page)
        if count > 0 and not slugs_1:
            logger.error("No slugs found on the first page of watchlist.")
            raise scraper_exceptions.ScraperStructureError()
        if not slugs_1:
            return SlugScrapeResult(slugs=[], is_complete=True, avatar_url=avatar_url)
        perpage = len(slugs_1)
        total_pages = (count + perpage - 1) // perpage

        all_slugs = set(slugs_1)
        is_complete = True

        tasks = [
            get_watchlist_page_async(session, username, page_num)
            for page_num in range(2, total_pages + 1)
        ]
        pages = await asyncio.gather(*tasks)
        for page_num, page in enumerate(pages, start=2):
            if page is None:
                logger.warning(
                    "Watchlist scrape for %s: page %s/%s failed to fetch.",
                    username,
                    page_num,
                    total_pages,
                )
                is_complete = False
                continue
            slugs = extract_slugs_from_page(page=page)
            if not slugs:
                logger.warning(
                    "Watchlist scrape for %s: page %s/%s returned 0 poster slugs.",
                    username,
                    page_num,
                    total_pages,
                )
                is_complete = False
                continue
            all_slugs.update(slugs)

        return SlugScrapeResult(
            slugs=list(all_slugs), is_complete=is_complete, avatar_url=avatar_url
        )


def get_avatar_url(username: str) -> str | None:
    """Just the profile picture: one page, not the whole watchlist.

    For the moment someone switches "use my profile picture" on, so what they
    just agreed to show appears right away instead of after the next sync. The
    watchlist's first page is used because `extract_avatar_url_from_page`
    already knows its header. `None` for no picture and for any failure alike;
    the caller keeps whatever it had.
    """

    async def fetch() -> str | None:
        async with ClientSession() as session:
            page = await get_watchlist_page_async(
                session=session, username=username, page_num=1
            )
            return extract_avatar_url_from_page(page) if page else None

    try:
        return asyncio.run(fetch())
    except Exception as e:
        logger.warning(f"Could not fetch the avatar for {username}: {e}")
        return None
