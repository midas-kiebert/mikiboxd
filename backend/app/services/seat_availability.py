"""Keep `Showtime.seats_left` fresh for showtimes people care about.

Reads come from `app.scraping.seat_availability`, which turns a showtime's
ticket link into a seat count. This module decides *which* showtimes to read,
how often, and what to write down.

Capacity is mostly not modelled. `seats_capacity` defaults to the largest
`seats_left` ever seen for that showtime: the first reading lands days or
weeks before the screening, while it is still near-empty, so the running max
converges on the real capacity of that particular screening — including
screenings sold at reduced capacity, which a per-room number would get wrong.
The cost is that a showtime first polled when it is already half sold reads
low, which makes `is_running_low` fire late rather than early. Late is the
safe direction. Two things skip the estimate and set it outright: a platform
that hands back a room's real total (currently only Eagerly's seat map), and
a manual entry in `seat_capacity_overrides.yaml` for cinemas/rooms no
platform ever reveals it for.
"""

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

import yaml
from sqlmodel import Session

from app.crud import cinema as cinema_crud
from app.crud import showtime as showtimes_crud
from app.models.showtime import Showtime
from app.scraping.logger import logger
from app.scraping.seat_availability import (
    EagerlyFeedCache,
    SeatAvailability,
    SeatAvailabilityFetchError,
    fetch_seat_availability,
)
from app.utils import now_amsterdam_naive

_CAPACITY_OVERRIDES_CONFIG = (
    Path(__file__).resolve().parents[1] / "configs" / "seat_capacity_overrides.yaml"
)


@lru_cache(maxsize=1)
def _capacity_overrides() -> dict[str, dict[str, int]]:
    with _CAPACITY_OVERRIDES_CONFIG.open() as f:
        config = yaml.safe_load(f) or {}
    return config.get("overrides") or {}


def _capacity_override(*, cinema_key: str | None, room: str | None) -> int | None:
    """A manually-entered capacity for this cinema/room, from
    `seat_capacity_overrides.yaml`, if one has been entered."""
    if cinema_key is None or room is None:
        return None
    return _capacity_overrides().get(cinema_key, {}).get(room)

# Only showtimes this far out are worth reading: further away nothing is close
# to selling out, and the answer would be stale long before it mattered.
POLL_HORIZON = timedelta(days=14)
# Per-showtime cooldown.
POLL_RECHECK_AFTER = timedelta(hours=6)
# A count nobody can act on is not worth a request.
POLL_MINIMUM_NOTICE = timedelta(hours=1)
# Ceiling on one run, so a backlog cannot turn into a burst at a ticket shop.
POLL_BATCH_LIMIT = 200
# Ticket shops are fetched one host at a time; this is how many *hosts* run at
# once. Never raise this into per-host concurrency — these are real checkout
# pages, and the Z-ELITE shops sit behind a virtual waiting room.
HOST_CONCURRENCY = 4

# "Running low" is whichever is larger: a flat handful of seats, or a share of
# the screening's own capacity. The flat number carries small rooms (10 left in
# a 40-seat room is a real warning, 10% of it is 4 and far too late), and the
# fraction carries large ones (10 left in Eye's 312-seat Cinema 1 is far too
# late, 10% of it is 31).
RUNNING_LOW_ABSOLUTE_SEATS = 10
RUNNING_LOW_CAPACITY_FRACTION = 0.1


def is_running_low(*, seats_left: int | None, seats_capacity: int | None) -> bool:
    """Whether a showtime is close enough to full to warn about.

    Sold out is deliberately not "running low" — it is a different, stronger
    state, and a caller that wants to show something for it should check
    `seats_left == 0` itself.
    """
    if seats_left is None or seats_left <= 0:
        return False
    threshold = RUNNING_LOW_ABSOLUTE_SEATS
    if seats_capacity is not None:
        threshold = max(
            threshold, int(seats_capacity * RUNNING_LOW_CAPACITY_FRACTION)
        )
    return seats_left <= threshold


def _ticket_host(showtime: Showtime) -> str:
    return urlsplit(showtime.ticket_link or "").netloc


def _read_host(showtimes: list[Showtime]) -> dict[int, SeatAvailability]:
    """Read every showtime at one ticket host, sequentially.

    One host per worker rather than one showtime per worker: it keeps us to a
    single in-flight request per ticket shop, and it lets the Eagerly agenda
    feed be fetched once for the host instead of racing several threads onto
    the same download.
    """
    feed_cache: EagerlyFeedCache = {}
    readings: dict[int, SeatAvailability] = {}
    for showtime in showtimes:
        if showtime.ticket_link is None:
            continue
        try:
            readings[showtime.id] = fetch_seat_availability(
                ticket_link=showtime.ticket_link, feed_cache=feed_cache
            )
        except SeatAvailabilityFetchError as e:
            # Leave the last known numbers in place. A failed read is not
            # evidence of anything, least of all a full house.
            logger.warning(f"Seat availability read failed for showtime {showtime.id}: {e}")
    return readings


def _apply_reading(
    *,
    showtime: Showtime,
    availability: SeatAvailability,
    cinema_key: str | None = None,
) -> None:
    if availability.room is not None:
        showtime.room = availability.room

    # A platform that hands back every seat (currently only Eagerly's seat
    # map) tells us the room's real total outright; a manual entry in
    # `seat_capacity_overrides.yaml` is the same kind of fact, just typed in
    # by hand for a room no platform ever reveals it for. Either beats the
    # running-max estimate immediately, rather than only once it's converged,
    # and neither should ever be undercut by a later, thinner reading.
    known_capacity = availability.capacity or _capacity_override(
        cinema_key=cinema_key, room=showtime.room
    )
    if known_capacity is not None:
        showtime.seats_capacity = max(showtime.seats_capacity or 0, known_capacity)

    if availability.seats_left is not None:
        showtime.seats_left = availability.seats_left
        # Only a positive reading says anything about how big the screening is.
        # Folding a sold-out zero into the running max would record a capacity
        # of nought for a showtime whose very first reading happened to be full.
        if known_capacity is None and availability.seats_left > 0:
            showtime.seats_capacity = max(
                showtime.seats_capacity or 0, availability.seats_left
            )
    elif availability.sold_out:
        # Eagerly says sold out without ever saying how many; capacity is left
        # alone because zero tells us nothing about how big the room is.
        showtime.seats_left = 0
    elif availability.sold_out is False:
        # Known to be on sale, count unknown. Clearing matters: without it a
        # showtime that sold out and then had tickets released would keep
        # reading as zero for ever.
        showtime.seats_left = None


def refresh_seat_availability(
    *,
    session: Session,
    now: datetime | None = None,
) -> int:
    """Re-read seat availability for due showtimes and return how many were read.

    `seats_checked_at` is stamped on every showtime this run considered, even
    when the read failed or the platform is one we cannot read — otherwise the
    unreadable ones would be picked again on every run and crowd out the rest
    of the batch.
    """
    reference_time = now or now_amsterdam_naive()
    candidates = showtimes_crud.get_seat_availability_candidates(
        session=session,
        now=reference_time,
        horizon=POLL_HORIZON,
        recheck_after=POLL_RECHECK_AFTER,
        minimum_notice=POLL_MINIMUM_NOTICE,
        limit=POLL_BATCH_LIMIT,
    )
    if not candidates:
        return 0

    cinema_keys = {
        cinema.id: cinema.key for cinema in cinema_crud.get_cinemas(session=session)
    }

    by_host: dict[str, list[Showtime]] = defaultdict(list)
    for showtime in candidates:
        by_host[_ticket_host(showtime)].append(showtime)

    readings: dict[int, SeatAvailability] = {}
    max_workers = min(len(by_host), HOST_CONCURRENCY) or 1
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for host_readings in executor.map(_read_host, by_host.values()):
            readings.update(host_readings)

    read_count = 0
    for showtime in candidates:
        availability = readings.get(showtime.id)
        if availability is not None:
            _apply_reading(
                showtime=showtime,
                availability=availability,
                cinema_key=cinema_keys.get(showtime.cinema_id),
            )
            if availability.is_known:
                read_count += 1
        showtime.seats_checked_at = reference_time
        session.add(showtime)
    session.commit()
    return read_count
