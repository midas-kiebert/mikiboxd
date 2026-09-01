"""Tests for email rendering helpers.

These cover the shaping the watchlist digest relies on to stay out of a mail
client's promotions bucket: a real text/plain alternative, and a subject that
names the films instead of repeating a brand prefix.
"""

from datetime import datetime, timedelta
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
    generate_watchlist_digest_email,
)


def _entry(
    title: str, cinema_name: str, *, showtime_datetime: datetime | None = None
) -> tuple[SimpleNamespace, SimpleNamespace]:
    return (
        SimpleNamespace(
            title=title, poster_link=None, letterboxd_slug=None, id=abs(hash(title)) % 100000
        ),
        SimpleNamespace(
            cinema=SimpleNamespace(name=cinema_name),
            datetime=showtime_datetime or datetime(2026, 1, 1),
        ),
    )


_ONE = [_entry("Aftersun", "Kriterion")]
_TWO = _ONE + [_entry("Perfect Days", "LAB111")]
_FOUR = _TWO + [_entry("Petite Maman", "Eye"), _entry("Drive My Car", "Cavia")]


# ---------------------------------------------------------------------------
# _watchlist_digest_subject — within the week
# ---------------------------------------------------------------------------


def test_weekly_single_film_subject_names_the_film_and_cinema():
    subject = _watchlist_digest_subject(_ONE, within_week=True)

    assert subject == "Aftersun is showing at Kriterion this week"


def test_weekly_two_film_subject_names_both():
    subject = _watchlist_digest_subject(_TWO, within_week=True)

    assert subject == "Aftersun and Perfect Days are showing this week"


def test_weekly_more_than_two_films_fold_into_a_remainder_count():
    subject = _watchlist_digest_subject(_FOUR, within_week=True)

    assert subject == "Aftersun, Perfect Days and 2 more are showing this week"


# ---------------------------------------------------------------------------
# _watchlist_digest_subject — beyond the week
# ---------------------------------------------------------------------------


def test_daily_subject_does_not_claim_a_timeframe():
    """Eager can announce a film screening five months out, so "this week" and
    "soon" would both be lies; it only says the film is coming."""
    single = _watchlist_digest_subject(_ONE, within_week=False)
    several = _watchlist_digest_subject(_FOUR, within_week=False)

    assert single == "Aftersun is coming to Kriterion"
    assert several == "Aftersun, Perfect Days and 2 more are coming up"
    for subject in (single, several):
        assert "this week" not in subject
        assert "soon" not in subject


def test_daily_two_film_subject_names_both():
    subject = _watchlist_digest_subject(_TWO, within_week=False)

    assert subject == "Aftersun and Perfect Days are coming up"


# ---------------------------------------------------------------------------
# Shared subject rules
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("within_week", [True, False])
def test_subject_never_carries_a_brand_prefix(within_week: bool):
    """The constant "MiKiNO - " prefix is what made every digest look alike."""
    assert not _watchlist_digest_subject(_ONE, within_week=within_week).startswith(
        "MiKiNO"
    )


@pytest.mark.parametrize("within_week", [True, False])
def test_subject_describes_the_screening_not_the_database_change(within_week: bool):
    """The digest fires when a showtime is added, but it tells the reader the
    film is coming up — not that a row changed."""
    subject = _watchlist_digest_subject(_TWO, within_week=within_week)

    assert "new showtime" not in subject


# ---------------------------------------------------------------------------
# _watchlist_digest_intro
# ---------------------------------------------------------------------------


def test_intro_matches_the_frequency_horizon():
    assert "coming week" in _watchlist_digest_intro(True)
    assert "coming week" not in _watchlist_digest_intro(False)


@pytest.mark.parametrize("within_week", [True, False])
def test_intro_never_claims_the_films_came_from_a_watchlist(within_week: bool):
    """The source can be any Letterboxd list, so only the footer names it."""
    assert "watchlist" not in _watchlist_digest_intro(within_week)


# ---------------------------------------------------------------------------
# Footer: which mode, which list
# ---------------------------------------------------------------------------

_WATCHLIST = DigestSource(
    label="your Letterboxd watchlist",
    url="https://letterboxd.com/midas/watchlist/",
    frequency=DigestFrequency.DAILY,
)
_WATCHLIST_WEEKLY = DigestSource(
    label="your Letterboxd watchlist",
    url="https://letterboxd.com/midas/watchlist/",
    frequency=DigestFrequency.WEEKLY_OR_URGENT,
)
_LIST = DigestSource(
    label="the Letterboxd list \u201cBest of 2026\u201d",
    url="https://letterboxd.com/midas/list/best-of-2026/",
    frequency=DigestFrequency.WEEKLY_OR_URGENT,
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


def _text(within_week: bool, sources: list[DigestSource]) -> str:
    return _watchlist_digest_text(
        intro=_watchlist_digest_intro(within_week),
        movies=_MOVIES,
        sources=sources,
        unsubscribe_link="https://api.mikino.nl/unsub?token=x",
    )


def test_footer_names_the_mode_the_reader_chose():
    assert "Eager digest" in _text(False, [_WATCHLIST])
    assert "Weekly digest" in _text(True, [_WATCHLIST_WEEKLY])


def test_footer_names_and_links_the_watchlist_source():
    text = _text(False, [_WATCHLIST])

    assert "following your Letterboxd watchlist" in text
    assert "https://letterboxd.com/midas/watchlist/" in text


def test_footer_names_and_links_a_chosen_list_instead():
    text = _text(True, [_LIST])

    assert "Best of 2026" in text
    assert "https://letterboxd.com/midas/list/best-of-2026/" in text
    assert "your Letterboxd watchlist" not in text


def test_footer_survives_a_source_that_cannot_be_linked():
    """A chosen list whose row was deleted is still named, just not linked."""
    text = _text(
        False,
        [
            DigestSource(
                label="the Letterboxd list you chose",
                url=None,
                frequency=DigestFrequency.DAILY,
            )
        ],
    )

    assert "the Letterboxd list you chose." in text
    assert "http" in text  # the unsubscribe link is still there


def test_footer_explains_what_the_mode_does():
    assert _watchlist_digest_explainer(DigestFrequency.DAILY) in _text(
        False, [_WATCHLIST]
    )
    assert "each Thursday" in _watchlist_digest_explainer(
        DigestFrequency.WEEKLY_OR_URGENT
    )


def test_footer_renders_every_contributing_source_with_its_own_frequency():
    """A combined email mixing a DAILY-labeled source and a WEEKLY-labeled one
    must show both lines, each with its own explainer \u2014 the footer no longer
    assumes a single shared frequency for the whole email."""
    text = _text(False, [_WATCHLIST, _LIST])

    assert "Eager digest" in text
    assert "Weekly digest" in text
    assert "following your Letterboxd watchlist" in text
    assert "following the Letterboxd list \u201cBest of 2026\u201d" in text
    assert _watchlist_digest_explainer(DigestFrequency.DAILY) in text
    assert _watchlist_digest_explainer(DigestFrequency.WEEKLY_OR_URGENT) in text
    # Only one unsubscribe line at the very end, not one per source.
    assert text.count("To stop these emails:") == 1


# ---------------------------------------------------------------------------
# generate_watchlist_digest_email \u2014 within_week derived from the films, not
# from a passed-in frequency
# ---------------------------------------------------------------------------


def test_within_week_is_computed_from_showtimes_not_from_source_frequency():
    """A DAILY-labeled source whose only pending film happens to screen within
    seven days must still get "this week" wording \u2014 a deliberate change from
    the old behavior where a single passed-in frequency drove the wording."""
    now = datetime(2026, 1, 1)
    entries = [_entry("Aftersun", "Kriterion", showtime_datetime=now + timedelta(days=2))]

    email = generate_watchlist_digest_email(
        email_to="user@example.com",
        movie_entries=entries,
        sources=[_WATCHLIST],  # labeled DAILY
        now=now,
    )

    assert "this week" in email.subject
    assert "coming week" in email.text_content


def test_within_week_is_false_when_any_entry_is_beyond_the_horizon():
    now = datetime(2026, 1, 1)
    entries = [
        _entry("Aftersun", "Kriterion", showtime_datetime=now + timedelta(days=2)),
        _entry("Perfect Days", "LAB111", showtime_datetime=now + timedelta(days=30)),
    ]

    email = generate_watchlist_digest_email(
        email_to="user@example.com",
        movie_entries=entries,
        sources=[_WATCHLIST_WEEKLY],  # labeled WEEKLY
        now=now,
    )

    assert "this week" not in email.subject
    assert "coming to your cinemas" in email.text_content


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
