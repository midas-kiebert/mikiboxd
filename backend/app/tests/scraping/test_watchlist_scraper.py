from bs4 import BeautifulSoup
from pytest_mock import MockerFixture

from app.scraping.letterboxd.watchlist import get_watchlist


def test_watchlist_parsing(
    mocker: MockerFixture,
    sample_watchlist_page_1: BeautifulSoup,
    sample_watchlist_empty_page: BeautifulSoup,
):
    # Mock the BeautifulSoup object to return the sample HTML
    mocker.patch(
        "app.scraping.letterboxd.watchlist.get_page",
        side_effect=[sample_watchlist_page_1, sample_watchlist_empty_page],
    )

    watchlist = get_watchlist("sample username")

    assert isinstance(watchlist, list), "Expected watchlist to be a list"
    assert len(watchlist) == 100, "Expected watchlist to contain 100 items"
    assert watchlist[0] == "fail-safe"
    assert watchlist[99] == "brief-encounter"
