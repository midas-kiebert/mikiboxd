from unittest.mock import MagicMock

import pytest
from bs4 import BeautifulSoup
from pytest_mock import MockerFixture

from app.exceptions import scraper_exceptions
from app.scraping.letterboxd.load_letterboxd_data import (
    CurlResponse,
    SyncPageFetchResult,
)
from app.scraping.letterboxd.watched import extract_total_pages, get_watched

PAGINATION_HTML = """
<div class="paginate-pages">
  <ul>
    <li class="paginate-page"><a href="/u/films/page/1/">1</a></li>
    <li class="paginate-page"><a href="/u/films/page/2/">2</a></li>
    <li class="paginate-page"><a href="/u/films/page/3/">3</a></li>
    <li class="paginate-page paginate-ellipsis"><span>…</span></li>
    <li class="paginate-page"><a href="/u/films/page/10/">10</a></li>
  </ul>
</div>
"""


def _poster_grid(slugs: list[str]) -> str:
    items = "".join(
        f'<li><div data-item-slug="{slug}"><div class="poster">'
        f'<img class="image" /></div></div></li>'
        for slug in slugs
    )
    return f'<ul class="poster-list">{items}</ul>'


def _ok(html: str) -> SyncPageFetchResult:
    return SyncPageFetchResult(
        response=CurlResponse(url="", text=html, status_code=200, headers={}),
        status_code=200,
    )


def _blocked() -> SyncPageFetchResult:
    """What `_fetch_page` returns while its challenge cooldown is active."""
    return SyncPageFetchResult(response=None, status_code=None, blocked=True)


def test_extract_total_pages_reads_last_pagination_number():
    page = BeautifulSoup(PAGINATION_HTML, "lxml")
    assert extract_total_pages(page) == 10


def test_extract_total_pages_defaults_to_one_without_pagination():
    page = BeautifulSoup(_poster_grid(["a", "b"]), "lxml")
    assert extract_total_pages(page) == 1


def test_get_watched_fetches_all_pages(mocker: MockerFixture):
    # Page 1 carries the pagination control (3 pages total); every page returns
    # a distinct set of poster slugs.
    page_1 = PAGINATION_HTML.replace("10", "3") + _poster_grid(["a", "b"])
    page_2 = _poster_grid(["c", "d"])
    page_3 = _poster_grid(["e"])

    mock_fetch = MagicMock(side_effect=[_ok(page_1), _ok(page_2), _ok(page_3)])
    mocker.patch("app.scraping.letterboxd.watched._fetch_page", mock_fetch)

    result = get_watched("sample username")

    assert sorted(result.slugs) == ["a", "b", "c", "d", "e"]
    assert result.is_complete


def test_get_watched_does_not_truncate_on_empty_middle_page(mocker: MockerFixture):
    # A single empty/blocked page in the middle must not stop the scrape: the
    # remaining pages are still fetched (regression test for the truncation bug).
    page_1 = PAGINATION_HTML.replace("10", "3") + _poster_grid(["a"])
    empty_page = "<html></html>"
    page_3 = _poster_grid(["c"])

    # The empty page is retried WATCHED_PAGE_MAX_ATTEMPTS times before moving on.
    mock_fetch = MagicMock(
        side_effect=[
            _ok(page_1),
            _ok(empty_page),
            _ok(empty_page),
            _ok(empty_page),
            _ok(page_3),
        ]
    )
    mocker.patch("app.scraping.letterboxd.watched._fetch_page", mock_fetch)

    result = get_watched("sample username")

    assert sorted(result.slugs) == ["a", "c"]
    # Page 2 never produced slugs, so the result must not be treated as the
    # user's full watched list.
    assert not result.is_complete


def test_get_watched_retries_empty_page_then_succeeds(mocker: MockerFixture):
    # A transient empty (rate-limited) response is retried and recovers.
    page_1 = PAGINATION_HTML.replace("10", "3") + _poster_grid(["a"])
    empty_page = "<html></html>"
    page_2 = _poster_grid(["b"])
    page_3 = _poster_grid(["c"])

    # Page 2 comes back empty once, is retried, then succeeds.
    mock_fetch = MagicMock(
        side_effect=[_ok(page_1), _ok(empty_page), _ok(page_2), _ok(page_3)]
    )
    mocker.patch("app.scraping.letterboxd.watched._fetch_page", mock_fetch)

    result = get_watched("sample username")

    assert sorted(result.slugs) == ["a", "b", "c"]
    assert result.is_complete


def test_get_watched_raises_when_first_page_is_blocked(mocker: MockerFixture):
    # The fetcher's challenge cooldown short-circuits without a network call, so
    # a blocked first page must surface as "try again later" rather than as a
    # scraper/structure failure, and must not burn the per-page retries.
    mock_fetch = MagicMock(side_effect=[_blocked()])
    mocker.patch("app.scraping.letterboxd.watched._fetch_page", mock_fetch)

    with pytest.raises(scraper_exceptions.LetterboxdTemporarilyUnavailable):
        get_watched("sample username")

    assert mock_fetch.call_count == 1


def test_get_watched_marks_result_incomplete_when_blocked_mid_scrape(
    mocker: MockerFixture,
):
    # Page 1 succeeds, then the cooldown kicks in: the partial result must be
    # flagged so the caller does not overwrite the stored watched list with it.
    page_1 = PAGINATION_HTML.replace("10", "3") + _poster_grid(["a"])

    mock_fetch = MagicMock(side_effect=[_ok(page_1), _blocked()])
    mocker.patch("app.scraping.letterboxd.watched._fetch_page", mock_fetch)

    result = get_watched("sample username")

    assert result.slugs == ["a"]
    assert not result.is_complete
    # Page 3 is not attempted: it would hit the same cooldown.
    assert mock_fetch.call_count == 2


def test_get_watched_marks_throttled_first_page_incomplete(mocker: MockerFixture):
    # A first page that returns 200 with no posters after every retry is a soft
    # throttle. Reporting it as an empty-but-complete watched list would wipe
    # every stored film for that user.
    empty_page = "<html></html>"
    mock_fetch = MagicMock(side_effect=[_ok(empty_page)] * 3)
    mocker.patch("app.scraping.letterboxd.watched._fetch_page", mock_fetch)

    result = get_watched("sample username")

    assert result.slugs == []
    assert not result.is_complete
