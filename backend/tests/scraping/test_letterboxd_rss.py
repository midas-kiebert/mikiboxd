"""Parsing of the Letterboxd member RSS feed used by the incremental sync."""

from app.scraping.letterboxd import rss
from app.scraping.letterboxd.load_letterboxd_data import (
    CurlResponse,
    SyncPageFetchResult,
)

# Shapes taken from a real member feed (checked 2026-07-28): diary entries, a
# repeat viewing with its "/1/" suffix, and a list item whose description embeds
# one canonical film link per film in the list.
SAMPLE_FEED = """<?xml version='1.0' encoding='utf-8'?>
<rss version="2.0" xmlns:letterboxd="https://letterboxd.com">
  <channel>
    <title>Letterboxd - Someone</title>
    <link>https://letterboxd.com/someone/</link>
    <item>
      <title>Touki Bouki, 1973 - ★★★★</title>
      <link>https://letterboxd.com/someone/film/touki-bouki/</link>
      <letterboxd:watchedDate>2026-07-26</letterboxd:watchedDate>
    </item>
    <item>
      <title>Fargo, 1996 - ★★★★</title>
      <link>https://letterboxd.com/someone/film/fargo/1/</link>
      <letterboxd:watchedDate>2026-07-25</letterboxd:watchedDate>
    </item>
    <item>
      <title>Best film of each year</title>
      <link>https://letterboxd.com/someone/list/best-film-of-each-year/</link>
      <description><![CDATA[ <ul>
        <li> <a href="https://letterboxd.com/film/nope/">Nope</a> </li>
        <li> <a href="https://letterboxd.com/film/asteroid-city/">Asteroid City</a> </li>
      </ul> ]]></description>
    </item>
    <item>
      <title>Touki Bouki, 1973 - ★★★★★</title>
      <link>https://letterboxd.com/someone/film/touki-bouki/</link>
    </item>
  </channel>
</rss>
"""


def test_extract_slugs_keeps_feed_order_and_drops_duplicates():
    assert rss.extract_slugs_from_feed(SAMPLE_FEED) == ["touki-bouki", "fargo"]


def test_extract_slugs_ignores_films_listed_inside_a_list_item():
    # The single most important property of this parser. A list's description
    # links every film in it, so treating those as watched would mark hundreds
    # of unseen films as watched. They are excluded because canonical links
    # carry no /<member>/ segment.
    slugs = rss.extract_slugs_from_feed(SAMPLE_FEED)

    assert "nope" not in slugs
    assert "asteroid-city" not in slugs
    assert "best-film-of-each-year" not in slugs


def test_extract_slugs_strips_the_repeat_viewing_suffix():
    # .../film/fargo/1/ is a second logged viewing, not a film called "1".
    assert "fargo" in rss.extract_slugs_from_feed(SAMPLE_FEED)


def test_extract_slugs_ignores_member_links_inside_a_review_body():
    # A review comparing two films can link to another member's entry. That is
    # not a film this member watched, so only <item><link> is considered.
    feed = """<?xml version='1.0' encoding='utf-8'?>
<rss version="2.0">
  <channel>
    <item>
      <link>https://letterboxd.com/someone/film/heat/</link>
      <description><![CDATA[ <p>Better than
        <a href="https://letterboxd.com/dave/film/the-town/">this</a>.</p> ]]></description>
    </item>
  </channel>
</rss>
"""

    assert rss.extract_slugs_from_feed(feed) == ["heat"]


def test_extract_slugs_falls_back_to_a_text_scan_on_malformed_xml():
    # A truncated feed is still worth something; the fallback is the old
    # whole-document scan.
    malformed = (
        "<rss><channel><item>"
        "<link>https://letterboxd.com/someone/film/heat/</link>"
        "</item><channel>"
    )

    assert rss.extract_slugs_from_feed(malformed) == ["heat"]


def test_extract_slugs_handles_an_empty_feed():
    assert rss.extract_slugs_from_feed("<rss><channel></channel></rss>") == []


def test_get_recent_watched_slugs_returns_none_when_feed_unavailable(mocker):
    # None means "could not tell". Returning [] instead would read as "this
    # member has watched nothing", which the caller would act on.
    mocker.patch(
        "app.scraping.letterboxd.rss._fetch_page",
        return_value=SyncPageFetchResult(
            response=None, status_code=403, blocked=True
        ),
    )

    assert rss.get_recent_watched_slugs("someone") is None


def test_get_recent_watched_slugs_bypasses_the_cooldown(mocker):
    mock_fetch = mocker.patch(
        "app.scraping.letterboxd.rss._fetch_page",
        return_value=SyncPageFetchResult(
            response=CurlResponse(
                url="", text=SAMPLE_FEED, status_code=200, headers={}
            ),
            status_code=200,
        ),
    )

    slugs = rss.get_recent_watched_slugs("someone")

    assert slugs == ["touki-bouki", "the-return"]
    assert mock_fetch.call_args.kwargs["ignore_challenge_block"] is True
