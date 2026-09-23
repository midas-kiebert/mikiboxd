"""Screenings a cinema's own site lists but its scraper could not identify.

When a cinema scraper can't match a film to TMDB it skips the film, so none of
its screenings reach the scraper's results. On its own that only means the
scraper creates nothing for them. It turns destructive when Cineville lists the
same screening and did identify the film: a scraper trusted over Cineville (see
``app.scraping.trusted_scrapers``) treats every Cineville showtime missing from
its results as a Cineville false positive and removes it. That is how LAB111's
Fahrenheit 9/11 screenings were deleted and re-created on every run in
September 2026 — LAB111's lookup tied the film with *Fahrenheit 11/9*.

So scrapers note what they skipped (``BaseCinemaScraper.record_unidentified_listing``),
and after each cinema scraper run ``find_cineville_matches`` looks up the
Cineville showtimes at the same cinema and minute. Those are exempt from the
trusted-scraper cleanup, and every one is reported in the scrape recap: each is
a film the cinema scraper failed to identify where Cineville succeeded.
"""

import threading
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import exists
from sqlmodel import Session, col, select

from app.models.showtime import Showtime
from app.models.showtime_source_presence import ShowtimeSourcePresence
from app.services.showtime_title_conflict import CINEVILLE_STREAM_PREFIX
from app.utils import now_amsterdam_naive


@dataclass(frozen=True)
class UnidentifiedListing:
    cinema_id: int
    title: str
    datetime: datetime


@dataclass(frozen=True)
class UnidentifiedListingMatch:
    """A Cineville showtime at the same cinema and minute as an unidentified listing."""

    cinema_id: int
    showtime_datetime: datetime
    # Several films can start in the same minute at a multi-screen cinema, so
    # every unidentified title listed at that minute is kept.
    listing_titles: tuple[str, ...]
    cineville_showtime_id: int
    cineville_movie_id: int
    cineville_movie_title: str


_listings_lock = threading.Lock()
_listings_by_cinema: dict[int, list[UnidentifiedListing]] = defaultdict(list)

_matches_lock = threading.Lock()
_matches: list[UnidentifiedListingMatch] = []


def record_unidentified_listings(
    *,
    cinema_id: int,
    title: str,
    datetimes: Iterable[datetime],
) -> None:
    listings = [
        UnidentifiedListing(cinema_id=cinema_id, title=title, datetime=dt)
        for dt in datetimes
    ]
    if not listings:
        return
    with _listings_lock:
        _listings_by_cinema[cinema_id].extend(listings)


def consume_unidentified_listings(cinema_id: int) -> list[UnidentifiedListing]:
    """Return and clear the listings recorded for this cinema since the last call."""
    with _listings_lock:
        return _listings_by_cinema.pop(cinema_id, [])


def find_cineville_matches(
    *,
    session: Session,
    cinema_id: int,
    listings: Iterable[UnidentifiedListing],
) -> list[UnidentifiedListingMatch]:
    """Cineville showtimes at the same cinema and minute as an unidentified listing.

    Only upcoming showtimes with an active Cineville presence count: those are
    the ones the trusted-scraper cleanup would otherwise remove.
    """
    now = now_amsterdam_naive()
    titles_by_datetime: dict[datetime, set[str]] = defaultdict(set)
    for listing in listings:
        if listing.cinema_id == cinema_id and listing.datetime >= now:
            titles_by_datetime[listing.datetime].add(listing.title)
    if not titles_by_datetime:
        return []

    active_cineville_presence = exists(
        select(ShowtimeSourcePresence.id).where(
            ShowtimeSourcePresence.showtime_id == Showtime.id,
            ShowtimeSourcePresence.source_stream
            == f"{CINEVILLE_STREAM_PREFIX}{cinema_id}",
            col(ShowtimeSourcePresence.active).is_(True),
        )
    )
    showtimes = session.exec(
        select(Showtime)
        .where(
            Showtime.cinema_id == cinema_id,
            col(Showtime.datetime).in_(list(titles_by_datetime)),
            active_cineville_presence,
        )
        .order_by(col(Showtime.datetime), col(Showtime.id))
    ).all()
    return [
        UnidentifiedListingMatch(
            cinema_id=cinema_id,
            showtime_datetime=showtime.datetime,
            listing_titles=tuple(sorted(titles_by_datetime[showtime.datetime])),
            cineville_showtime_id=showtime.id,
            cineville_movie_id=showtime.movie_id,
            cineville_movie_title=showtime.movie.title,
        )
        for showtime in showtimes
    ]


def record_unidentified_listing_matches(
    matches: Iterable[UnidentifiedListingMatch],
) -> None:
    with _matches_lock:
        _matches.extend(matches)


def consume_unidentified_listing_matches() -> list[UnidentifiedListingMatch]:
    """Return and clear the matches seen since the last call."""
    with _matches_lock:
        collected = list(_matches)
        _matches.clear()
    return collected
