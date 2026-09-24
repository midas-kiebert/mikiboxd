"""One-off backfill: load past Cineville events into the publish-timing log.

The scrape logs every event it sees from now on (`CinevilleEvent`), but
Cineville keeps past events too, each with its own created/updated time, so the
publish-timing view can start with months of history instead of none. Rows
written here have no `first_seen_at` (we never saw them live) and never
overwrite a row a live sweep wrote. Needs no TMDB lookups. About 60 requests
for 8 weeks, paced a second apart:

    python scripts/backfill-cineville-events.py [weeks]
"""

import asyncio
import sys
from datetime import datetime, timedelta

import aiohttp

from app.api.deps import get_db_context
from app.scraping.get_showtimes import get_all_events_async
from app.services import cineville_events

DEFAULT_WEEKS = 8
PAGE_DELAY_SECONDS = 1.0


async def _fetch(weeks: int):
    end = datetime.utcnow()
    async with aiohttp.ClientSession() as session:
        return await get_all_events_async(
            session,
            start=end - timedelta(weeks=weeks),
            end=end,
            page_delay_seconds=PAGE_DELAY_SECONDS,
        )


def backfill(weeks: int) -> None:
    events = asyncio.run(_fetch(weeks))
    print(f"Fetched {len(events)} past Cineville events ({weeks} weeks)")
    with get_db_context() as session:
        rows = cineville_events.event_rows(
            events=events,
            title_by_production={},
            cinema_id_by_venue_name=cineville_events.cinema_id_by_venue_name(session),
            seen_at=None,
        )
        cineville_events.insert_missing_event_rows(session=session, rows=rows)
        session.commit()
    print("Done.")


if __name__ == "__main__":
    backfill(int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_WEEKS)
