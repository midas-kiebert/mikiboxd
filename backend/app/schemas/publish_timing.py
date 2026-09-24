"""Admin publish-timing response schemas.

When cinemas put new screenings online, read from the two publish-timing logs:
Cineville's own creation timestamps (`CinevilleEvent`) and the first time each
cinema's own site was seen listing a screening (`ListingFirstSeen`). The JSON
is script/LLM friendly; the admin page renders the same data.
"""

import datetime as dt
from enum import Enum

from pydantic import BaseModel


class PublishTimingSource(str, Enum):
    # Cineville's createdAt per event: exact to the second, all venues, and
    # backfilled from before logging started.
    CINEVILLE = "cineville"
    # First sighting by a cinema's own scraper: somewhere in the window since
    # that scraper's previous run, so only as sharp as its cadence.
    SITES = "sites"


class PublishTimingBucket(BaseModel):
    label: str
    count: int


class PublishTimingDelay(BaseModel):
    """How long after Cineville published a screening we first had it."""

    count: int
    median_minutes: float | None
    p90_minutes: float | None
    buckets: list[PublishTimingBucket]


class PublishTimingCinemaRow(BaseModel):
    cinema_id: int | None
    name: str
    listings: int
    # Weekday 0 = Monday. The weekday/hour that saw the most listings.
    top_weekday: int | None
    top_hour: int | None
    # Share of listings published on the top weekday.
    top_weekday_share: float | None
    median_delay_minutes: float | None
    # For cinemas scraped from both sources: of the screenings both listed,
    # the share our site scraper saw first, and by how much it led (negative =
    # Cineville was first).
    both_sources_count: int | None = None
    site_first_share: float | None = None
    median_site_lead_minutes: float | None = None


class PublishTimingRecentListing(BaseModel):
    cinema_name: str
    title: str | None
    screening_at: dt.datetime
    published_at: dt.datetime
    first_seen_at: dt.datetime | None
    delay_minutes: float | None


class PublishTimingCinemaOption(BaseModel):
    cinema_id: int
    name: str
    cineville: bool
    own_scraper: bool


class PublishTimingResponse(BaseModel):
    source: PublishTimingSource
    days: int
    cinema_id: int | None
    window_start: dt.datetime
    # When live logging began for this source; delays are only measured for
    # listings published after it.
    logging_started_at: dt.datetime | None
    listings: int
    # Distinct publish moments: a cinema putting 40 screenings online at once
    # counts once here and 40 times in `listings`.
    batches: int
    # 7 rows (Monday first) × 24 hours, Amsterdam time. A site listing seen in
    # a multi-hour window is spread evenly over the hours of that window.
    heatmap_listings: list[list[float]]
    heatmap_batches: list[list[float]]
    lead_time: list[PublishTimingBucket]
    delay: PublishTimingDelay | None
    # Typical width of the sites' sighting windows (their scrape cadence).
    median_window_minutes: float | None
    per_cinema: list[PublishTimingCinemaRow]
    recent: list[PublishTimingRecentListing]
    cinemas: list[PublishTimingCinemaOption]
