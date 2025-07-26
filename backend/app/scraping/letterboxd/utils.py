import requests
from aiohttp import ClientSession
from bs4 import BeautifulSoup

HEADERS = {
    "referer": "https://letterboxd.com",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
}

def get_page(url: str, cookie_string: str | None = None, timeout: float = 15.0) -> BeautifulSoup:
    cookies = (
        {
            item.split("=")[0].strip(): item.split("=")[1].strip()
            for item in cookie_string.strip().split("; ")
        }
        if cookie_string
        else {}
    )
    return BeautifulSoup(
        requests.get(url, headers=HEADERS, cookies=cookies, timeout=timeout).text, "lxml"
    )


async def get_page_async(session: ClientSession, url: str, cookie_string: str | None = None) -> BeautifulSoup:
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
