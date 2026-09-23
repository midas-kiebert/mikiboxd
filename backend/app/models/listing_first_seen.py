"""When each source first listed each screening, for publish-timing analysis.

One row per (source stream, showtime identity), written the first time a scrape
of that stream observes it. Unlike `ShowtimeSourcePresence` it has no foreign key
to the showtime, so it outlives the screening itself — showtimes are deleted a
day after they pass, and the point of this table is to look back over months.

The screening appeared on the source some time in (`window_start`,
`first_seen_at`]: `window_start` is when the previous successful run of the
same stream started. How narrow that window is depends on how often the stream
is scraped. Cineville also says when *it* created the listing
(`source_created_at`); the cinema sites don't.
"""

import datetime as dt

from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel


class ListingFirstSeen(SQLModel, table=True):
    __table_args__ = (
        UniqueConstraint(
            "source_stream",
            "source_event_key",
            name="uq_listingfirstseen_stream_key",
        ),
    )
    id: int | None = Field(default=None, primary_key=True)
    # Same naming as ShowtimeSourcePresence: "cineville:<cinema id>" or
    # "cinema_scraper:<cinema id>".
    source_stream: str = Field(index=True)
    source_event_key: str
    cinema_id: int = Field(index=True)
    movie_id: int
    showtime_datetime: dt.datetime
    first_seen_at: dt.datetime = Field(index=True)
    window_start: dt.datetime
    source_created_at: dt.datetime | None = None
