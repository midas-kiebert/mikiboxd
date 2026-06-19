from time import perf_counter

from bs4 import BeautifulSoup

from app.exceptions import scraper_exceptions

from . import logger
from .load_letterboxd_data import CurlResponse, _fetch_page
from .watchlist import extract_slugs_from_page

# Letterboxd rate-limits the films/diary endpoint hard from datacenter IPs, so
# a 200 response with no poster markup is treated as a transient throttle and
# retried (with the fetcher's built-in request pacing between attempts).
WATCHED_PAGE_MAX_ATTEMPTS = 3


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


def _log_watched_diagnostics(
    *, page_num: int, url: str, response: CurlResponse, soup: BeautifulSoup
) -> None:
    logger.info(
        "Letterboxd watched p%s diagnostics: url=%s status=%s cf_ray=%s server=%s "
        "content_type=%s html_len=%s img_image_tags=%s",
        page_num,
        url,
        response.status_code,
        response.headers.get("cf-ray"),
        response.headers.get("server"),
        response.headers.get("content-type"),
        len(response.text),
        len(soup.find_all("img", class_="image")),
    )


def get_watched_page(username: str, page_num: int) -> BeautifulSoup | None:
    """Fetch a single "films watched" page via the Cloudflare-aware fetcher.

    Uses the shared curl fetcher (persistent cookie jar, request pacing, 403 /
    challenge handling). A 200 response that comes back without any poster
    markup is retried, since on rate-limited hosts that signals a soft throttle
    rather than a genuinely empty page.
    """
    url = f"https://letterboxd.com/{username}/films/page/{page_num}/"
    soup: BeautifulSoup | None = None
    for attempt in range(1, WATCHED_PAGE_MAX_ATTEMPTS + 1):
        result = _fetch_page(url)
        if result.response is None:
            if result.not_found:
                return None
            logger.warning(
                "Watched page %s for %s unavailable on attempt %s/%s "
                "(status=%s blocked=%s).",
                page_num,
                username,
                attempt,
                WATCHED_PAGE_MAX_ATTEMPTS,
                result.status_code,
                result.blocked,
            )
            continue
        soup = BeautifulSoup(result.response.text, "lxml")
        _log_watched_diagnostics(
            page_num=page_num, url=url, response=result.response, soup=soup
        )
        if soup.find("img", class_="image") is not None:
            return soup
        logger.warning(
            "Watched page %s for %s returned 0 posters on attempt %s/%s; retrying.",
            page_num,
            username,
            attempt,
            WATCHED_PAGE_MAX_ATTEMPTS,
        )
    return soup


def get_watched(username: str) -> list[str]:
    start = perf_counter()
    slugs = _scrape_watched_films(username=username)
    end = perf_counter()
    logger.info(
        f"Fetched {len(slugs)} watched slugs for user {username} in "
        f"{end - start:.2f} seconds."
    )
    return slugs


def _scrape_watched_films(username: str) -> list[str]:
    first_page = get_watched_page(username=username, page_num=1)
    if first_page is None:
        logger.error(
            f"Failed to fetch the first page of watched films for user {username}"
        )
        raise scraper_exceptions.ScraperStructureError()

    total_pages = extract_total_pages(first_page)
    all_slugs = set(extract_slugs_from_page(page=first_page))

    # Fetch pages sequentially: the fetcher paces requests and reuses the
    # Cloudflare clearance cookie, and the known page count means a single empty
    # page no longer truncates the whole result.
    for page_num in range(2, total_pages + 1):
        page = get_watched_page(username=username, page_num=page_num)
        if page is None:
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
