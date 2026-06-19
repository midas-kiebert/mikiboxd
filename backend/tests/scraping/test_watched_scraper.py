from unittest.mock import AsyncMock

from bs4 import BeautifulSoup
from pytest_mock import MockerFixture

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


def test_extract_total_pages_reads_last_pagination_number():
    page = BeautifulSoup(PAGINATION_HTML, "lxml")
    assert extract_total_pages(page) == 10


def test_extract_total_pages_defaults_to_one_without_pagination():
    page = BeautifulSoup(_poster_grid(["a", "b"]), "lxml")
    assert extract_total_pages(page) == 1


def test_get_watched_fetches_all_pages(mocker: MockerFixture):
    # Page 1 carries the pagination control (3 pages total); every page returns
    # a distinct set of poster slugs.
    page_1 = BeautifulSoup(
        PAGINATION_HTML.replace("10", "3") + _poster_grid(["a", "b"]), "lxml"
    )
    page_2 = BeautifulSoup(_poster_grid(["c", "d"]), "lxml")
    page_3 = BeautifulSoup(_poster_grid(["e"]), "lxml")

    mock_get_page = AsyncMock(side_effect=[page_1, page_2, page_3])
    mocker.patch(
        "app.scraping.letterboxd.watched.get_page_async",
        mock_get_page,
    )

    watched = get_watched("sample username")

    assert sorted(watched) == ["a", "b", "c", "d", "e"]


def test_get_watched_does_not_truncate_on_empty_middle_page(mocker: MockerFixture):
    # A single empty/blocked page in the middle must not stop the scrape: the
    # remaining pages are still fetched (regression test for the truncation bug).
    page_1 = BeautifulSoup(
        PAGINATION_HTML.replace("10", "3") + _poster_grid(["a"]), "lxml"
    )
    empty_page = BeautifulSoup("<html></html>", "lxml")
    page_3 = BeautifulSoup(_poster_grid(["c"]), "lxml")

    mock_get_page = AsyncMock(side_effect=[page_1, empty_page, page_3])
    mocker.patch(
        "app.scraping.letterboxd.watched.get_page_async",
        mock_get_page,
    )

    watched = get_watched("sample username")

    assert sorted(watched) == ["a", "c"]
