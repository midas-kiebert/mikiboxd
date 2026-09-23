"""Read side of the publish-timing logs, for the admin publish-timing view.

Aggregates in Python: a two-month window is ~100k Cineville events, and spreading
a site sighting over the hours of its window doesn't map neatly onto SQL.
"""

import datetime as dt
import statistics
from collections import Counter, defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from sqlmodel import Session, col, func, select

from app.models.cinema import Cinema
from app.models.cineville_event import CinevilleEvent
from app.models.listing_first_seen import ListingFirstSeen
from app.models.movie import Movie
from app.models.scrape_run import ScrapeRun
from app.schemas.publish_timing import (
    PublishTimingBucket,
    PublishTimingCinemaOption,
    PublishTimingCinemaRow,
    PublishTimingDelay,
    PublishTimingRecentListing,
    PublishTimingResponse,
    PublishTimingSource,
)
from app.utils import now_amsterdam_naive

SITE_STREAM_PREFIX = "cinema_scraper:"
CINEVILLE_STREAM_PREFIX = "cineville:"
RECENT_LIMIT = 25
# A sighting window longer than this (the scheduler was down, say) says too
# little about *when* in it the listing appeared to put on the heatmap.
MAX_HEATMAP_WINDOW = dt.timedelta(hours=24)

LEAD_TIME_BUCKETS: tuple[tuple[str, dt.timedelta], ...] = (
    ("< 1 day", dt.timedelta(days=1)),
    ("1–3 days", dt.timedelta(days=3)),
    ("3–7 days", dt.timedelta(days=7)),
    ("1–2 weeks", dt.timedelta(days=14)),
    ("2–4 weeks", dt.timedelta(days=28)),
)
LEAD_TIME_OVERFLOW = "> 4 weeks"
DELAY_BUCKETS: tuple[tuple[str, dt.timedelta], ...] = (
    ("< 15 min", dt.timedelta(minutes=15)),
    ("15–60 min", dt.timedelta(hours=1)),
    ("1–2 h", dt.timedelta(hours=2)),
    ("2–6 h", dt.timedelta(hours=6)),
    ("6–12 h", dt.timedelta(hours=12)),
)
DELAY_OVERFLOW = "> 12 h"


@dataclass(frozen=True)
class _Listing:
    """One listing, whichever log it came from."""

    group_key: str
    cinema_id: int | None
    cinema_name: str
    batch_key: tuple[str, dt.datetime]
    # Earliest and latest moment it can have been published; equal for Cineville.
    published_from: dt.datetime
    published_at: dt.datetime
    screening_at: dt.datetime
    first_seen_at: dt.datetime | None
    title: str | None
    delay: dt.timedelta | None


def _bucketed(
    values: Iterable[dt.timedelta],
    buckets: Sequence[tuple[str, dt.timedelta]],
    overflow: str,
) -> list[PublishTimingBucket]:
    counts: Counter[str] = Counter()
    for value in values:
        label = next((name for name, limit in buckets if value < limit), overflow)
        counts[label] += 1
    labels = [name for name, _ in buckets] + [overflow]
    return [PublishTimingBucket(label=label, count=counts[label]) for label in labels]


def _minutes(value: dt.timedelta) -> float:
    return round(value.total_seconds() / 60, 1)


def _quantile(values: Sequence[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(fraction * len(ordered)))]


def _empty_heatmap() -> list[list[float]]:
    return [[0.0] * 24 for _ in range(7)]


def _spread(
    heatmap: list[list[float]], start: dt.datetime, end: dt.datetime, weight: float
) -> None:
    """Add `weight` to the heatmap, divided evenly over the hours of [start, end]."""
    if end <= start:
        heatmap[end.weekday()][end.hour] += weight
        return
    total = (end - start).total_seconds()
    cursor = start
    while cursor < end:
        next_hour = cursor.replace(minute=0, second=0, microsecond=0) + dt.timedelta(
            hours=1
        )
        hour_end = min(end, next_hour)
        heatmap[cursor.weekday()][cursor.hour] += (
            weight * (hour_end - cursor).total_seconds() / total
        )
        cursor = hour_end


def _cinema_names(session: Session) -> dict[int, str]:
    return {cinema.id: cinema.name for cinema in session.exec(select(Cinema)).all()}


def _cineville_listings(
    *,
    session: Session,
    window_start: dt.datetime,
    cinema_id: int | None,
    logging_started_at: dt.datetime | None,
) -> list[_Listing]:
    # Hidden events and events not yet tied to a film don't show in Cineville's
    # app (nor in our scrape), so they aren't publications yet.
    statement = select(CinevilleEvent).where(
        col(CinevilleEvent.source_created_at) >= window_start,
        col(CinevilleEvent.is_hidden).is_(False),
        col(CinevilleEvent.production_id).is_not(None),
    )
    if cinema_id is not None:
        statement = statement.where(CinevilleEvent.cinema_id == cinema_id)
    listings = []
    for event in session.exec(statement).all():
        delay = None
        if (
            event.first_seen_at is not None
            and logging_started_at is not None
            and event.source_created_at >= logging_started_at
        ):
            delay = max(dt.timedelta(0), event.first_seen_at - event.source_created_at)
        listings.append(
            _Listing(
                group_key=f"venue:{event.venue_id}",
                cinema_id=event.cinema_id,
                cinema_name=event.venue_name,
                batch_key=(
                    event.venue_id,
                    event.source_created_at.replace(second=0, microsecond=0),
                ),
                published_from=event.source_created_at,
                published_at=event.source_created_at,
                screening_at=event.start_at,
                first_seen_at=event.first_seen_at,
                title=event.title,
                delay=delay,
            )
        )
    return listings


def _site_rows(
    *, session: Session, window_start: dt.datetime, cinema_id: int | None
) -> list[ListingFirstSeen]:
    statement = select(ListingFirstSeen).where(
        col(ListingFirstSeen.source_stream).startswith(SITE_STREAM_PREFIX),
        col(ListingFirstSeen.first_seen_at) >= window_start,
    )
    if cinema_id is not None:
        statement = statement.where(ListingFirstSeen.cinema_id == cinema_id)
    return list(session.exec(statement).all())


def _site_listings(
    *, session: Session, rows: Sequence[ListingFirstSeen]
) -> list[_Listing]:
    names = _cinema_names(session)
    movie_ids = {row.movie_id for row in rows}
    titles = (
        dict(
            session.exec(
                select(Movie.id, Movie.title).where(col(Movie.id).in_(movie_ids))
            ).all()
        )
        if movie_ids
        else {}
    )
    return [
        _Listing(
            group_key=f"cinema:{row.cinema_id}",
            cinema_id=row.cinema_id,
            cinema_name=names.get(row.cinema_id, f"Cinema {row.cinema_id}"),
            batch_key=(row.source_stream, row.first_seen_at),
            published_from=row.window_start,
            published_at=row.first_seen_at,
            screening_at=row.showtime_datetime,
            first_seen_at=row.first_seen_at,
            title=titles.get(row.movie_id),
            delay=None,
        )
        for row in rows
    ]


@dataclass(frozen=True)
class _SourceComparison:
    both: int
    site_first: int
    median_lead_minutes: float | None


def _compare_with_cineville(
    *, session: Session, site_rows: Sequence[ListingFirstSeen]
) -> dict[int, _SourceComparison]:
    """Per cinema: of screenings both its site and Cineville listed, who had them first.

    The site's time is when we first saw it there (an upper bound on when it
    went up); Cineville's is its own creation time, when known.
    """
    if not site_rows:
        return {}
    keys = {row.source_event_key for row in site_rows}
    cineville_created: dict[tuple[int, str], dt.datetime] = {}
    for row in session.exec(
        select(ListingFirstSeen).where(
            col(ListingFirstSeen.source_stream).startswith(CINEVILLE_STREAM_PREFIX),
            col(ListingFirstSeen.source_event_key).in_(keys),
            col(ListingFirstSeen.source_created_at).is_not(None),
        )
    ).all():
        assert row.source_created_at is not None
        cineville_created[(row.cinema_id, row.source_event_key)] = row.source_created_at
    leads: dict[int, list[float]] = defaultdict(list)
    for row in site_rows:
        created = cineville_created.get((row.cinema_id, row.source_event_key))
        if created is not None:
            leads[row.cinema_id].append(_minutes(created - row.first_seen_at))
    return {
        cinema_id: _SourceComparison(
            both=len(values),
            site_first=sum(1 for value in values if value > 0),
            median_lead_minutes=statistics.median(values),
        )
        for cinema_id, values in leads.items()
    }


def _per_cinema_rows(
    listings: Sequence[_Listing], comparisons: dict[int, _SourceComparison]
) -> list[PublishTimingCinemaRow]:
    grouped: dict[str, list[_Listing]] = defaultdict(list)
    for listing in listings:
        grouped[listing.group_key].append(listing)
    rows = []
    for group in grouped.values():
        weekdays = Counter(listing.published_at.weekday() for listing in group)
        hours = Counter(listing.published_at.hour for listing in group)
        top_weekday, top_weekday_count = weekdays.most_common(1)[0]
        delays = [_minutes(item.delay) for item in group if item.delay is not None]
        comparison = (
            comparisons.get(group[0].cinema_id)
            if group[0].cinema_id is not None
            else None
        )
        rows.append(
            PublishTimingCinemaRow(
                cinema_id=group[0].cinema_id,
                name=group[0].cinema_name,
                listings=len(group),
                top_weekday=top_weekday,
                top_hour=hours.most_common(1)[0][0],
                top_weekday_share=round(top_weekday_count / len(group), 3),
                median_delay_minutes=statistics.median(delays) if delays else None,
                both_sources_count=comparison.both if comparison else None,
                site_first_share=(
                    round(comparison.site_first / comparison.both, 3)
                    if comparison and comparison.both
                    else None
                ),
                median_site_lead_minutes=(
                    comparison.median_lead_minutes if comparison else None
                ),
            )
        )
    return sorted(rows, key=lambda row: -row.listings)


def _cinema_options(session: Session) -> list[PublishTimingCinemaOption]:
    site_cinema_ids = {
        int(stream.removeprefix(SITE_STREAM_PREFIX))
        for stream in session.exec(
            select(ScrapeRun.source_stream)
            .where(col(ScrapeRun.source_stream).startswith(SITE_STREAM_PREFIX))
            .distinct()
        ).all()
        if stream.removeprefix(SITE_STREAM_PREFIX).isdigit()
    }
    return sorted(
        (
            PublishTimingCinemaOption(
                cinema_id=cinema.id,
                name=cinema.name,
                cineville=cinema.cineville,
                own_scraper=cinema.id in site_cinema_ids,
            )
            for cinema in session.exec(select(Cinema)).all()
            if cinema.cineville or cinema.id in site_cinema_ids
        ),
        key=lambda option: option.name.lower(),
    )


def get_publish_timing(
    *,
    session: Session,
    source: PublishTimingSource,
    days: int,
    cinema_id: int | None,
) -> PublishTimingResponse:
    now = now_amsterdam_naive()
    window_start = now - dt.timedelta(days=days)
    comparisons: dict[int, _SourceComparison] = {}
    median_window_minutes: float | None = None

    if source == PublishTimingSource.CINEVILLE:
        logging_started_at = session.exec(
            select(func.min(col(CinevilleEvent.first_seen_at)))
        ).one()
        listings = _cineville_listings(
            session=session,
            window_start=window_start,
            cinema_id=cinema_id,
            logging_started_at=logging_started_at,
        )
    else:
        logging_started_at = session.exec(
            select(func.min(col(ListingFirstSeen.first_seen_at))).where(
                col(ListingFirstSeen.source_stream).startswith(SITE_STREAM_PREFIX)
            )
        ).one()
        site_rows = _site_rows(
            session=session, window_start=window_start, cinema_id=cinema_id
        )
        listings = _site_listings(session=session, rows=site_rows)
        comparisons = _compare_with_cineville(session=session, site_rows=site_rows)
        widths = [
            _minutes(listing.published_at - listing.published_from)
            for listing in listings
        ]
        median_window_minutes = statistics.median(widths) if widths else None

    heatmap_listings = _empty_heatmap()
    heatmap_batches = _empty_heatmap()
    seen_batches: set[tuple[str, dt.datetime]] = set()
    for listing in listings:
        if listing.published_at - listing.published_from > MAX_HEATMAP_WINDOW:
            continue
        _spread(heatmap_listings, listing.published_from, listing.published_at, 1.0)
        if listing.batch_key not in seen_batches:
            seen_batches.add(listing.batch_key)
            _spread(heatmap_batches, listing.published_from, listing.published_at, 1.0)

    delays = [listing.delay for listing in listings if listing.delay is not None]
    delay_minutes = [_minutes(delay) for delay in delays]
    delay = (
        PublishTimingDelay(
            count=len(delays),
            median_minutes=statistics.median(delay_minutes) if delay_minutes else None,
            p90_minutes=_quantile(delay_minutes, 0.9),
            buckets=_bucketed(delays, DELAY_BUCKETS, DELAY_OVERFLOW),
        )
        if source == PublishTimingSource.CINEVILLE
        else None
    )
    recent = sorted(listings, key=lambda listing: listing.published_at, reverse=True)

    return PublishTimingResponse(
        source=source,
        days=days,
        cinema_id=cinema_id,
        window_start=window_start,
        logging_started_at=logging_started_at,
        listings=len(listings),
        batches=len({listing.batch_key for listing in listings}),
        heatmap_listings=[[round(v, 2) for v in row] for row in heatmap_listings],
        heatmap_batches=[[round(v, 2) for v in row] for row in heatmap_batches],
        lead_time=_bucketed(
            (listing.screening_at - listing.published_at for listing in listings),
            LEAD_TIME_BUCKETS,
            LEAD_TIME_OVERFLOW,
        ),
        delay=delay,
        median_window_minutes=median_window_minutes,
        per_cinema=_per_cinema_rows(listings, comparisons),
        recent=[
            PublishTimingRecentListing(
                cinema_name=listing.cinema_name,
                title=listing.title,
                screening_at=listing.screening_at,
                published_at=listing.published_at,
                first_seen_at=listing.first_seen_at,
                delay_minutes=(
                    _minutes(listing.delay) if listing.delay is not None else None
                ),
            )
            for listing in recent[:RECENT_LIMIT]
        ],
        cinemas=_cinema_options(session),
    )
