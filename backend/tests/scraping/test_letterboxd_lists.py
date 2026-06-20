from datetime import datetime

import pytest
from bs4 import BeautifulSoup
from pytest_mock import MockerFixture

from app.scraping.letterboxd import lists as lists_scraper
from app.scraping.letterboxd.lists import (
    InvalidListUrl,
    extract_last_updated,
    extract_list_title,
    resolve_list_url,
    scrape_list,
)

LIST_HEADER_HTML = """
  <meta property="og:title" content="Letterboxd's Top 500 Films" />
  <span class="published is-updated">Published
    <time datetime="2013-11-08T10:38:22.466Z"></time></span>
  <span class="updated">Updated
    <time datetime="2026-06-19T00:55:17.665Z"></time></span>
"""


def _poster_grid(slugs: list[str]) -> str:
    items = "".join(
        f'<li><div data-item-slug="{slug}"><div class="poster">'
        f'<img class="image" /></div></div></li>'
        for slug in slugs
    )
    return f'<ul class="poster-list">{items}</ul>'


def test_resolve_full_list_url():
    ref = resolve_list_url(
        "https://letterboxd.com/official/list/letterboxds-top-500-films/"
    )
    assert ref.owner == "official"
    assert ref.list_slug == "letterboxds-top-500-films"
    assert ref.boxd_shortcode is None


def test_resolve_list_url_strips_page_suffix():
    ref = resolve_list_url(
        "https://letterboxd.com/midaskiebert/list/best-of/page/3/"
    )
    assert ref.owner == "midaskiebert"
    assert ref.list_slug == "best-of"


def test_resolve_list_url_without_scheme():
    ref = resolve_list_url("letterboxd.com/u/list/my-list/")
    assert ref.owner == "u"
    assert ref.list_slug == "my-list"


def test_resolve_shortlink_follows_redirect(mocker: MockerFixture):
    mocker.patch.object(
        lists_scraper,
        "_resolve_shortlink",
        return_value="https://letterboxd.com/midaskiebert/list/best-of/",
    )
    ref = resolve_list_url("https://boxd.it/FO39U")
    assert ref.owner == "midaskiebert"
    assert ref.list_slug == "best-of"
    assert ref.boxd_shortcode == "FO39U"


def test_resolve_rejects_non_list_url():
    with pytest.raises(InvalidListUrl):
        resolve_list_url("https://letterboxd.com/official/films/")


def test_resolve_rejects_unknown_host():
    with pytest.raises(InvalidListUrl):
        resolve_list_url("https://example.com/foo/list/bar/")


def test_resolve_rejects_lookalike_host():
    # A loose endswith("letterboxd.com") check would wrongly accept this.
    with pytest.raises(InvalidListUrl):
        resolve_list_url("https://evilletterboxd.com/owner/list/slug/")


def test_resolve_ignores_userinfo_host_spoof():
    # The real host is evil.com; the userinfo must not be mistaken for the host.
    with pytest.raises(InvalidListUrl):
        resolve_list_url("https://letterboxd.com@evil.com/owner/list/slug/")


def test_resolve_rejects_non_http_scheme():
    with pytest.raises(InvalidListUrl):
        resolve_list_url("file:///etc/passwd")


def test_resolve_rejects_unsafe_path_segments():
    with pytest.raises(InvalidListUrl):
        resolve_list_url("https://letterboxd.com/..%2f..%2fadmin/list/slug/")


def test_resolve_shortlink_must_resolve_to_letterboxd(mocker: MockerFixture):
    mocker.patch.object(
        lists_scraper,
        "_resolve_shortlink",
        return_value="https://evilletterboxd.com/owner/list/slug/",
    )
    with pytest.raises(InvalidListUrl):
        resolve_list_url("https://boxd.it/FO39U")


def test_extract_list_title():
    page = BeautifulSoup(LIST_HEADER_HTML, "lxml")
    assert extract_list_title(page) == "Letterboxd's Top 500 Films"


def test_extract_last_updated_prefers_updated_over_published():
    page = BeautifulSoup(LIST_HEADER_HTML, "lxml")
    # 2026-06-19T00:55:17.665Z UTC -> Amsterdam (+2 DST) naive
    assert extract_last_updated(page) == datetime(2026, 6, 19, 2, 55, 17, 665000)


def test_extract_last_updated_falls_back_to_published():
    html = '<span class="published">Published <time datetime="2020-01-01T00:00:00.000Z"></time></span>'
    page = BeautifulSoup(html, "lxml")
    assert extract_last_updated(page) == datetime(2020, 1, 1, 1, 0, 0, 0)


def test_scrape_list_collects_all_pages(mocker: MockerFixture):
    page_1 = BeautifulSoup(
        LIST_HEADER_HTML
        + '<div class="paginate-pages"><ul>'
        '<li class="paginate-page"><a>1</a></li>'
        '<li class="paginate-page"><a>2</a></li></ul></div>'
        + _poster_grid(["a", "b"]),
        "lxml",
    )
    page_2 = BeautifulSoup(_poster_grid(["c"]), "lxml")

    async def fake_get_page(*_args, **kwargs):
        url = kwargs["url"]
        return page_1 if url.rstrip("/").endswith("best-of") else page_2

    mocker.patch.object(lists_scraper, "get_page_async", side_effect=fake_get_page)

    result = scrape_list("midaskiebert", "best-of")

    assert sorted(result.slugs) == ["a", "b", "c"]
    assert result.title == "Letterboxd's Top 500 Films"
    assert result.last_updated == datetime(2026, 6, 19, 2, 55, 17, 665000)
