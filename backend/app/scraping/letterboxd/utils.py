import requests
from bs4 import BeautifulSoup


def get_page(url: str, cookie_string: str | None = None, timeout: float = 15.0) -> BeautifulSoup:
    # logger.trace(f"Fetching page: {url}")
    cookies = (
        {
            item.split("=")[0].strip(): item.split("=")[1].strip()
            for item in cookie_string.strip().split("; ")
        }
        if cookie_string
        else {}
    )
    headers = {
        "referer": "https://letterboxd.com",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    }
    return BeautifulSoup(
        requests.get(url, headers=headers, cookies=cookies, timeout=timeout).text, "lxml"
    )
