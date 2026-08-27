"""Tests for email rendering helpers.

These cover the shaping the watchlist digest relies on to stay out of a mail
client's promotions bucket: a real text/plain alternative, and a subject that
names the films instead of repeating a brand prefix.
"""

from types import SimpleNamespace

import pytest

from app.core.enums import DigestFrequency
from app.mailer import (
    _html_to_plain_text,
    _watchlist_digest_intro,
    _watchlist_digest_subject,
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
