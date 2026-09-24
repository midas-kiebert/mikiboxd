"""Write side of the publish-timing log (`ListingFirstSeen`)."""

from collections.abc import Sequence
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, col, select

from app.models.listing_first_seen import ListingFirstSeen
from app.models.showtime import Showtime

if TYPE_CHECKING:
    from app.services.scrape_sync import ObservedPresence


def record_first_seen(
    *,
    session: Session,
    source_stream: str,
    new_listings: Sequence["ObservedPresence"],
    first_seen_at: datetime,
    window_start: datetime,
) -> int:
    """Log listings a stream observed for the first time; returns rows written.

    A key that is already logged keeps its original row, so a showtime deleted
    and re-created by churn doesn't move its first sighting forward.
    """
    if not new_listings:
        return 0
    showtime_ids = {listing.showtime_id for listing in new_listings}
    showtimes = {
        showtime.id: showtime
        for showtime in session.exec(
            select(Showtime).where(col(Showtime.id).in_(showtime_ids))
        ).all()
    }
    rows = [
        {
            "source_stream": source_stream,
            "source_event_key": listing.source_event_key,
            "cinema_id": showtime.cinema_id,
            "movie_id": showtime.movie_id,
            "showtime_datetime": showtime.datetime,
            "first_seen_at": first_seen_at,
            "window_start": window_start,
            "source_created_at": listing.source_created_at,
        }
        for listing in new_listings
        if (showtime := showtimes.get(listing.showtime_id)) is not None
    ]
    if not rows:
        return 0
    session.execute(
        insert(ListingFirstSeen)
        .values(rows)
        .on_conflict_do_nothing(constraint="uq_listingfirstseen_stream_key")
    )
    return len(rows)
