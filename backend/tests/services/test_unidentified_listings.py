"""A screening a cinema scraper lists but can't identify must not cost Cineville's copy.

LAB111's scraper could not match "Fahrenheit 9/11" to TMDB and skipped it. LAB111
is trusted over Cineville, so every Cineville showtime missing from its results
was treated as a Cineville false positive — and Cineville's two correct
Fahrenheit 9/11 showtimes were deleted and re-created on every run.
"""

from datetime import datetime, timedelta

from sqlmodel import Session, select

from app.models.showtime import Showtime
from app.models.showtime_source_presence import ShowtimeSourcePresence
from app.scraping import runner
from app.services import scrape_sync as scrape_sync_service
from app.services import unidentified_listings
from app.services.unidentified_listings import (
    UnidentifiedListing,
    UnidentifiedListingMatch,
)
from app.utils import now_amsterdam_naive


def _screening_time(days: int) -> datetime:
    return now_amsterdam_naive().replace(
        hour=20, minute=45, second=0, microsecond=0
    ) + timedelta(days=days)


def _add_presence(
    *,
    session: Session,
    source_stream: str,
    showtime: Showtime,
    active: bool = True,
) -> ShowtimeSourcePresence:
    presence = ShowtimeSourcePresence(
        source_stream=source_stream,
        source_event_key=scrape_sync_service.showtime_identity_event_key(
            movie_id=showtime.movie_id,
            cinema_id=showtime.cinema_id,
            dt=showtime.datetime,
        ),
        showtime_id=showtime.id,
        last_seen_at=now_amsterdam_naive(),
        missing_streak=0,
        active=active,
    )
    session.add(presence)
    session.flush()
    return presence


def test_cineville_showtime_at_the_same_minute_is_matched(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    cinema = cinema_factory(cineville=True)
    movie = movie_factory(title="Fahrenheit 9/11")
    listed_at = _screening_time(days=2)
    showtime = showtime_factory(cinema=cinema, movie=movie, datetime=listed_at)
    _add_presence(
        session=db_transaction,
        source_stream=f"cineville:{cinema.id}",
        showtime=showtime,
    )

    matches = unidentified_listings.find_cineville_matches(
        session=db_transaction,
        cinema_id=cinema.id,
        listings=[
            UnidentifiedListing(
                cinema_id=cinema.id, title="fahrenheit 9/11", datetime=listed_at
            )
        ],
    )

    assert len(matches) == 1
    assert matches[0].cineville_showtime_id == showtime.id
    assert matches[0].cineville_movie_id == movie.id
    assert matches[0].cineville_movie_title == "Fahrenheit 9/11"
    assert matches[0].listing_titles == ("fahrenheit 9/11",)


def test_only_active_upcoming_cineville_showtimes_at_that_cinema_match(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    cinema = cinema_factory(cineville=True)
    other_cinema = cinema_factory(cineville=True)
    movie = movie_factory()
    listed_at = _screening_time(days=3)

    different_minute = showtime_factory(
        cinema=cinema, movie=movie, datetime=listed_at + timedelta(minutes=15)
    )
    _add_presence(
        session=db_transaction,
        source_stream=f"cineville:{cinema.id}",
        showtime=different_minute,
    )
    inactive = showtime_factory(cinema=cinema, movie=movie_factory(), datetime=listed_at)
    _add_presence(
        session=db_transaction,
        source_stream=f"cineville:{cinema.id}",
        showtime=inactive,
        active=False,
    )
    cinema_scraper_only = showtime_factory(
        cinema=cinema, movie=movie_factory(), datetime=listed_at
    )
    _add_presence(
        session=db_transaction,
        source_stream=f"cinema_scraper:{cinema.id}",
        showtime=cinema_scraper_only,
    )
    elsewhere = showtime_factory(cinema=other_cinema, movie=movie, datetime=listed_at)
    _add_presence(
        session=db_transaction,
        source_stream=f"cineville:{other_cinema.id}",
        showtime=elsewhere,
    )

    matches = unidentified_listings.find_cineville_matches(
        session=db_transaction,
        cinema_id=cinema.id,
        listings=[
            UnidentifiedListing(cinema_id=cinema.id, title="unknown", datetime=listed_at),
            UnidentifiedListing(
                cinema_id=cinema.id,
                title="already played",
                datetime=now_amsterdam_naive() - timedelta(hours=3),
            ),
        ],
    )

    assert matches == []


def test_titles_listed_in_the_same_minute_are_reported_together(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    cinema = cinema_factory(cineville=True)
    listed_at = _screening_time(days=4)
    showtime = showtime_factory(cinema=cinema, movie=movie_factory(), datetime=listed_at)
    _add_presence(
        session=db_transaction,
        source_stream=f"cineville:{cinema.id}",
        showtime=showtime,
    )

    matches = unidentified_listings.find_cineville_matches(
        session=db_transaction,
        cinema_id=cinema.id,
        listings=[
            UnidentifiedListing(cinema_id=cinema.id, title="zeta", datetime=listed_at),
            UnidentifiedListing(cinema_id=cinema.id, title="alpha", datetime=listed_at),
        ],
    )

    assert [match.listing_titles for match in matches] == [("alpha", "zeta")]


def test_trusted_scraper_reconcile_leaves_exempt_cineville_showtimes_alone(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    cinema = cinema_factory(cineville=True)
    unidentified = showtime_factory(
        cinema=cinema, movie=movie_factory(), datetime=_screening_time(days=2)
    )
    not_on_site = showtime_factory(
        cinema=cinema, movie=movie_factory(), datetime=_screening_time(days=5)
    )
    unidentified_presence = _add_presence(
        session=db_transaction,
        source_stream=f"cineville:{cinema.id}",
        showtime=unidentified,
    )
    not_on_site_presence = _add_presence(
        session=db_transaction,
        source_stream=f"cineville:{cinema.id}",
        showtime=not_on_site,
    )

    invalidated = scrape_sync_service.reconcile_trusted_scraper_misses(
        session=db_transaction,
        cinema_id=cinema.id,
        observed_event_keys=set(),
        exempt_showtime_ids={unidentified.id},
    )

    assert invalidated == 1
    presences = {
        presence.id: presence
        for presence in db_transaction.exec(
            select(ShowtimeSourcePresence).where(
                ShowtimeSourcePresence.source_stream == f"cineville:{cinema.id}"
            )
        ).all()
    }
    assert presences[unidentified_presence.id].active is True
    assert presences[not_on_site_presence.id].active is False


def test_recorded_listings_are_kept_per_cinema_and_cleared_when_read() -> None:
    listed_at = _screening_time(days=1)
    unidentified_listings.record_unidentified_listings(
        cinema_id=9001, title="fahrenheit 9/11", datetimes=[listed_at]
    )
    unidentified_listings.record_unidentified_listings(
        cinema_id=9002, title="other", datetimes=[listed_at]
    )

    assert unidentified_listings.consume_unidentified_listings(9001) == [
        UnidentifiedListing(cinema_id=9001, title="fahrenheit 9/11", datetime=listed_at)
    ]
    assert unidentified_listings.consume_unidentified_listings(9001) == []
    assert len(unidentified_listings.consume_unidentified_listings(9002)) == 1


def test_recap_line_names_the_skipped_title_and_the_kept_cineville_showtime() -> None:
    line = runner._unidentified_listing_match_line(
        UnidentifiedListingMatch(
            cinema_id=17,
            showtime_datetime=datetime(2026, 9, 16, 20, 45),
            listing_titles=("fahrenheit 9/11",),
            cineville_showtime_id=1933242,
            cineville_movie_id=1777,
            cineville_movie_title="Fahrenheit 9/11",
        ),
        {17: "LAB111"},
    )

    assert line == (
        "2026-09-16T20:45:00 @ LAB111 | cinema scraper could not identify: "
        "fahrenheit 9/11 | cineville: Fahrenheit 9/11 (movie_id=1777, "
        "showtime_id=1933242) | kept"
    )
