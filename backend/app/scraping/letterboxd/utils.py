from bs4 import BeautifulSoup
import requests
from . import logger

def get_page(url: str, cookie_string: str = None):
    logger.trace(f"Fetching page: {url}")
    cookies = {item.split('=')[0].strip(): item.split('=')[1].strip() for item in cookie_string.strip().split('; ')} if cookie_string else {}
    headers = {
            "referer": "https://letterboxd.com",
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }
    return BeautifulSoup(requests.get(url, headers=headers, cookies=cookies).text, "lxml")
