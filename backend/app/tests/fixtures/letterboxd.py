import os
from collections.abc import Generator

import pytest
from bs4 import BeautifulSoup

__all__ = [
    "sample_watchlist_page_1",
    "sample_watchlist_empty_page",
]

HTML_DIR = os.path.join(os.path.dirname(__file__), "html")


def open_html_file(filename: str) -> BeautifulSoup:
    """Utility function to read an HTML file."""
    with open(os.path.join(HTML_DIR, filename), encoding="utf-8") as file:
        return BeautifulSoup(file.read(), "html.parser")


@pytest.fixture
def sample_watchlist_page_1() -> Generator[BeautifulSoup, None, None]:
    """Fixture to provide a sample watchlist HTML page."""
    html_filename = "letterboxd_watchlist_page_1.html"
    yield open_html_file(html_filename)


@pytest.fixture
def sample_watchlist_empty_page() -> Generator[BeautifulSoup, None, None]:
    """Fixture to provide an empty watchlist HTML page."""
    html_filename = "letterboxd_watchlist_empty_page.html"
    yield open_html_file(html_filename)
