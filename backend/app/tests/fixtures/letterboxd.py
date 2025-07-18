import os

import pytest
from bs4 import BeautifulSoup

HTML_DIR = os.path.join(os.path.dirname(__file__), "html")


def open_html_file(filename: str) -> BeautifulSoup:
    """Utility function to read an HTML file."""
    with open(os.path.join(HTML_DIR, filename), encoding="utf-8") as file:
        return BeautifulSoup(file.read(), "html.parser")


@pytest.fixture
def sample_watchlist_html():
    """Fixture to provide a sample watchlist HTML page."""
    html_filename = "letterboxd_watchlist_page_1.html"
    return open_html_file(html_filename)
