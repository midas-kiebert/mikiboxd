"""Write side of the raw Cineville event log (`CinevilleEvent`)."""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlmodel import Session, col, func, update

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.cineville_event import CinevilleEvent
from app.scraping.get_showtimes import CinevilleEventRecord
from app.utils import now_amsterdam_naive, to_amsterdam_time

UPSERT_CHUNK_SIZE = 1000
# The listing only holds events starting after the moment it was fetched, so an
# event starting within this margin of the sweep may drop out without having
# gone anywhere.
GONE_START_MARGIN = timedelta(minutes=15)


@dataclass(frozen=True)
class CinevilleSweep:
    """One complete read of Cineville's upcoming events."""

    started_at: datetime
    events: Sequence[CinevilleEventRecord]
    # The films listing (`get_movies.Film`), for a readable title per event.
    films: Sequence[Any]


def cinema_id_by_venue_name(session: Session) -> dict[str, int]:
    return {
        venue_name: cinema.id
        for cinema in cinema_crud.get_cinemas(session=session)
        if cinema.cineville
        for venue_name in (cinema.name, *cinema.aliases)
    }


def event_rows(
    *,
    events: Iterable[CinevilleEventRecord],
    title_by_production: dict[str, str],
    cinema_id_by_venue_name: dict[str, int],
    seen_at: datetime | None,
) -> list[dict[str, Any]]:
    return [
        {
            "id": event.id,
            "venue_id": event.venueId,
            "venue_name": event.venueName,
            "cinema_id": cinema_id_by_venue_name.get(event.venueName),
            "production_id": event.productionId,
            "title": title_by_production.get(event.productionId or "", event.title),
            "start_at": to_amsterdam_time(event.startDate),
            "is_hidden": event.isHidden,
            "source_created_at": to_amsterdam_time(event.createdAt),
            "source_updated_at": to_amsterdam_time(event.updatedAt),
            "first_seen_at": seen_at,
            "last_seen_at": seen_at,
            "gone_at": None,
        }
        for event in events
    ]


def upsert_event_rows(*, session: Session, rows: Sequence[dict[str, Any]]) -> None:
    """Insert or refresh events; an existing row keeps its first sighting."""
    for start in range(0, len(rows), UPSERT_CHUNK_SIZE):
        statement = insert(CinevilleEvent).values(
            list(rows[start : start + UPSERT_CHUNK_SIZE])
        )
        excluded = statement.excluded
        session.execute(
            statement.on_conflict_do_update(
                index_elements=["id"],
                set_={
                    "venue_id": excluded.venue_id,
                    "venue_name": excluded.venue_name,
                    "cinema_id": excluded.cinema_id,
                    "production_id": excluded.production_id,
                    "title": excluded.title,
                    "start_at": excluded.start_at,
                    "is_hidden": excluded.is_hidden,
                    "source_created_at": excluded.source_created_at,
                    "source_updated_at": excluded.source_updated_at,
                    "first_seen_at": func.coalesce(
                        col(CinevilleEvent.first_seen_at), excluded.first_seen_at
                    ),
                    "last_seen_at": excluded.last_seen_at,
                    "gone_at": None,
                },
            )
        )


def insert_missing_event_rows(
    *, session: Session, rows: Sequence[dict[str, Any]]
) -> None:
    """Insert events not logged yet, leaving rows a live sweep wrote untouched."""
    for start in range(0, len(rows), UPSERT_CHUNK_SIZE):
        session.execute(
            insert(CinevilleEvent)
            .values(list(rows[start : start + UPSERT_CHUNK_SIZE]))
            .on_conflict_do_nothing(index_elements=["id"])
        )


def record_sweep(sweep: CinevilleSweep) -> None:
    """Log every event of a complete sweep, and mark upcoming ones it no longer lists."""
    title_by_production = {str(film.id): film.title for film in sweep.films}
    with get_db_context() as session:
        rows = event_rows(
            events=sweep.events,
            title_by_production=title_by_production,
            cinema_id_by_venue_name=cinema_id_by_venue_name(session),
            seen_at=sweep.started_at,
        )
        upsert_event_rows(session=session, rows=rows)
        # Only events we saw live can be declared gone; backfilled rows have no
        # sighting to compare against.
        session.execute(
            update(CinevilleEvent)
            .where(
                col(CinevilleEvent.last_seen_at) < sweep.started_at,
                col(CinevilleEvent.gone_at).is_(None),
                col(CinevilleEvent.start_at)
                > now_amsterdam_naive() + GONE_START_MARGIN,
            )
            .values(gone_at=sweep.started_at)
        )
        session.commit()
