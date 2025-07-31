from unittest.mock import AsyncMock

from bs4 import BeautifulSoup
from pytest_mock import MockerFixture

from app.scraping.letterboxd.watchlist import get_watchlist


def test_watchlist_parsing(
    mocker: MockerFixture,
    sample_watchlist_page_1: BeautifulSoup,
    sample_watchlist_empty_page: BeautifulSoup,
):
    # Mock the BeautifulSoup object to return the sample HTML
    mock_get_page = AsyncMock(
        side_effect=[sample_watchlist_page_1, sample_watchlist_empty_page]
    )
    mocker.patch(
        "app.scraping.letterboxd.watchlist.get_page_async",
        mock_get_page,
    )

    watchlist = get_watchlist("sample username")

    assert isinstance(watchlist, list), "Expected watchlist to be a list"
    assert len(watchlist) == 100, "Expected watchlist to contain 100 items"
    sorted_watchlist = sorted(watchlist)
    assert sorted_watchlist[0] == "4-months-3-weeks-and-2-days"
    assert sorted_watchlist[50] == "rebels-of-the-neon-god"
    assert sorted_watchlist[99] == "yi-yi"
