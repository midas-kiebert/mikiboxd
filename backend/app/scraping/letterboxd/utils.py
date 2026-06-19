import requests
from aiohttp import ClientSession
from bs4 import BeautifulSoup

from . import logger

HEADERS = {
    "referer": "https://letterboxd.com",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
}


def get_page(
    url: str, cookie_string: str | None = None, timeout: float = 15.0
) -> BeautifulSoup:
    cookies = (
        {
            item.split("=")[0].strip(): item.split("=")[1].strip()
            for item in cookie_string.strip().split("; ")
        }
        if cookie_string
        else {}
    )
    return BeautifulSoup(
        requests.get(url, headers=HEADERS, cookies=cookies, timeout=timeout).text,
        "lxml",
    )


async def fetch_page_with_diagnostics(
    session: ClientSession, url: str, *, context: str
) -> BeautifulSoup:
    """Fetch a Letterboxd page and log response diagnostics.

    Used to confirm whether Letterboxd is soft-blocking a given endpoint on
    this host (e.g. a Cloudflare edge response with no poster markup). Logs the
    status code, Cloudflare/server headers, body size and the number of poster
    ``img.image`` tags found, so the working watchlist endpoint and the failing
    watched endpoint can be compared side by side from the same host.
    """
    async with session.get(url, headers=HEADERS) as response:
        html = await response.text()
        soup = BeautifulSoup(html, "lxml")
        img_count = len(soup.find_all("img", class_="image"))
        logger.info(
            "Letterboxd %s diagnostics: url=%s status=%s cf_ray=%s server=%s "
            "content_type=%s html_len=%s img_image_tags=%s",
            context,
            url,
            response.status,
            response.headers.get("cf-ray"),
            response.headers.get("server"),
            response.headers.get("content-type"),
            len(html),
            img_count,
        )
        return soup


async def get_page_async(
    session: ClientSession, url: str, cookie_string: str | None = None
) -> BeautifulSoup:
    cookies = (
        {
            item.split("=")[0].strip(): item.split("=")[1].strip()
            for item in cookie_string.strip().split("; ")
        }
        if cookie_string
        else {}
    )
    try:
        async with session.get(url, headers=HEADERS, cookies=cookies) as response:
            html = await response.text()
            return BeautifulSoup(html, "lxml")
    except Exception as e:
        raise e
