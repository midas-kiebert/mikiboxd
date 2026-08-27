"""Tests for email rendering helpers.

These cover the shaping the watchlist digest relies on to stay out of a mail
client's promotions bucket: a real text/plain alternative, and a subject that
names the films instead of repeating a brand prefix.
"""

from types import SimpleNamespace

import pytest

from app.core.enums import DigestFrequency
from app.mailer import (
    DigestSource,
    _html_to_plain_text,
    _watchlist_digest_explainer,
    _watchlist_digest_intro,
    _watchlist_digest_subject,
    _watchlist_digest_text,
)


def _entry(title: str, cinema_name: str) -> tuple[SimpleNamespace, SimpleNamespace]:
    return (
        SimpleNamespace(title=title),
        SimpleNamespace(cinema=SimpleNamespace(name=cinema_name)),
    )


_ONE = [_entry("Aftersun", "Kriterion")]
_TWO = _ONE + [_entry("Perfect Days", "LAB111")]
_FOUR = _TWO + [_entry("Petite Maman", "Eye"), _entry("Drive My Car", "Cavia")]


# ---------------------------------------------------------------------------
# _watchlist_digest_subject — WEEKLY
# ---------------------------------------------------------------------------


def test_weekly_single_film_subject_names_the_film_and_cinema():
    subject = _watchlist_digest_subject(_ONE, frequency=DigestFrequency.WEEKLY_OR_URGENT)

    assert subject == "Aftersun is showing at Kriterion this week"


def test_weekly_two_film_subject_names_both():
    subject = _watchlist_digest_subject(_TWO, frequency=DigestFrequency.WEEKLY_OR_URGENT)

    assert subject == "Aftersun and Perfect Days are showing this week"


def test_weekly_more_than_two_films_fold_into_a_remainder_count():
    subject = _watchlist_digest_subject(_FOUR, frequency=DigestFrequency.WEEKLY_OR_URGENT)

    assert subject == "Aftersun, Perfect Days and 2 more are showing this week"


# ---------------------------------------------------------------------------
# _watchlist_digest_subject — DAILY
# ---------------------------------------------------------------------------


def test_daily_subject_does_not_claim_a_timeframe():
    """Eager can announce a film screening five months out, so "this week" and
    "soon" would both be lies; it only says the film is coming."""
    single = _watchlist_digest_subject(_ONE, frequency=DigestFrequency.DAILY)
    several = _watchlist_digest_subject(_FOUR, frequency=DigestFrequency.DAILY)

    assert single == "Aftersun is coming to Kriterion"
    assert several == "Aftersun, Perfect Days and 2 more are coming up"
    for subject in (single, several):
        assert "this week" not in subject
        assert "soon" not in subject


def test_daily_two_film_subject_names_both():
    subject = _watchlist_digest_subject(_TWO, frequency=DigestFrequency.DAILY)

    assert subject == "Aftersun and Perfect Days are coming up"


# ---------------------------------------------------------------------------
# Shared subject rules
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "frequency", [DigestFrequency.DAILY, DigestFrequency.WEEKLY_OR_URGENT]
)
def test_subject_never_carries_a_brand_prefix(frequency: DigestFrequency):
    """The constant "MiKiNO - " prefix is what made every digest look alike."""
    assert not _watchlist_digest_subject(_ONE, frequency=frequency).startswith("MiKiNO")


@pytest.mark.parametrize(
    "frequency", [DigestFrequency.DAILY, DigestFrequency.WEEKLY_OR_URGENT]
)
def test_subject_describes_the_screening_not_the_database_change(
    frequency: DigestFrequency,
):
    """The digest fires when a showtime is added, but it tells the reader the
    film is coming up — not that a row changed."""
    subject = _watchlist_digest_subject(_TWO, frequency=frequency)

    assert "new showtime" not in subject


# ---------------------------------------------------------------------------
# _watchlist_digest_intro
# ---------------------------------------------------------------------------


def test_intro_matches_the_frequency_horizon():
    assert "coming week" in _watchlist_digest_intro(DigestFrequency.WEEKLY_OR_URGENT)
    assert "coming week" not in _watchlist_digest_intro(DigestFrequency.DAILY)


@pytest.mark.parametrize(
    "frequency", [DigestFrequency.DAILY, DigestFrequency.WEEKLY_OR_URGENT]
)
def test_intro_never_claims_the_films_came_from_a_watchlist(
    frequency: DigestFrequency,
):
    """The source can be any Letterboxd list, so only the footer names it."""
    assert "watchlist" not in _watchlist_digest_intro(frequency)


# ---------------------------------------------------------------------------
# Footer: which mode, which list
# ---------------------------------------------------------------------------

_WATCHLIST = DigestSource(
    label="your Letterboxd watchlist", url="https://letterboxd.com/midas/watchlist/"
)
_LIST = DigestSource(
    label="the Letterboxd list \u201cBest of 2026\u201d",
    url="https://letterboxd.com/midas/list/best-of-2026/",
)
_MOVIES = [
    {
        "title": "Aftersun",
        "cinema_name": "Kriterion",
        "datetime_label": "Fri, Aug 28 at 20:15",
        "mikino_link": "https://mikino.nl/movie/1",
        "letterboxd_link": None,
        "poster_link": None,
    }
]


def _text(frequency: DigestFrequency, source: DigestSource) -> str:
    return _watchlist_digest_text(
        intro=_watchlist_digest_intro(frequency),
        movies=_MOVIES,
        frequency=frequency,
        source=source,
        unsubscribe_link="https://api.mikino.nl/unsub?token=x",
    )


def test_footer_names_the_mode_the_reader_chose():
    assert "Eager digest" in _text(DigestFrequency.DAILY, _WATCHLIST)
    assert "Weekly digest" in _text(DigestFrequency.WEEKLY_OR_URGENT, _WATCHLIST)


def test_footer_names_and_links_the_watchlist_source():
    text = _text(DigestFrequency.DAILY, _WATCHLIST)

    assert "following your Letterboxd watchlist" in text
    assert "https://letterboxd.com/midas/watchlist/" in text


def test_footer_names_and_links_a_chosen_list_instead():
    text = _text(DigestFrequency.WEEKLY_OR_URGENT, _LIST)

    assert "Best of 2026" in text
    assert "https://letterboxd.com/midas/list/best-of-2026/" in text
    assert "your Letterboxd watchlist" not in text


def test_footer_survives_a_source_that_cannot_be_linked():
    """A chosen list whose row was deleted is still named, just not linked."""
    text = _text(
        DigestFrequency.DAILY,
        DigestSource(label="the Letterboxd list you chose", url=None),
    )

    assert "the Letterboxd list you chose." in text
    assert "http" in text  # the unsubscribe link is still there


def test_footer_explains_what_the_mode_does():
    assert _watchlist_digest_explainer(DigestFrequency.DAILY) in _text(
        DigestFrequency.DAILY, _WATCHLIST
    )
    assert "each Thursday" in _watchlist_digest_explainer(
        DigestFrequency.WEEKLY_OR_URGENT
    )


# ---------------------------------------------------------------------------
# _html_to_plain_text
# ---------------------------------------------------------------------------


def test_links_keep_their_url_alongside_the_label():
    text = _html_to_plain_text('<p>See <a href="https://mikino.nl/x">the film</a></p>')

    assert text == "See the film (https://mikino.nl/x)"


def test_head_style_and_comments_are_dropped():
    """MJML's <style> block and its <o:PixelsPerInch>96</...> comment would
    otherwise leak into the text part as stray characters."""
    html = (
        "<html><head><title>MiKiNO</title>"
        "<style>.a{color:red}</style></head>"
        "<!--[if mso]><xml><o:PixelsPerInch>96</o:PixelsPerInch></xml><![endif]-->"
        "<body><p>Real content</p></body></html>"
    )

    assert _html_to_plain_text(html) == "Real content"


def test_block_boundaries_become_line_breaks_and_entities_are_decoded():
    text = _html_to_plain_text("<p>Kriterion &middot; Fri</p><p>LAB111</p>")

    assert text == "Kriterion · Fri\nLAB111"


def test_runs_of_blank_lines_collapse_to_one():
    text = _html_to_plain_text("<p>A</p><div></div><div></div><p>B</p>")

    assert text == "A\n\nB"
