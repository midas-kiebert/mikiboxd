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
low, which makes the fullest levels fire late rather than early. Late is the
safe direction. Two things skip the estimate and set it outright: a platform
that hands back a room's real total (currently only Eagerly's seat map), and
a manual entry in `seat_capacity_overrides.yaml` for cinemas/rooms no
platform ever reveals it for.

How often a showtime is re-read is decided here too, and written down as
`Showtime.seats_next_check_at` so the selecting query stays a single indexed
comparison. Every request is a real hit on a small cinema's ticket shop, so
the cadence is deliberately stingy: an empty screening two weeks out changes
nothing worth knowing twice a day, while one that is nearly full an hour
before it starts changes by the minute.
"""

import random
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit

import yaml
from sqlmodel import Session

from app.core.enums import SeatAvailabilityLevel, is_fuller_than
from app.crud import cinema as cinema_crud
from app.crud import cinema_room_capacity as room_capacity_crud
from app.crud import showtime as showtimes_crud
from app.crud import showtime_seat_map as seat_map_crud
from app.crud.cinema_room_capacity import RoomCapacityIndex
from app.exceptions.showtime_exceptions import ShowtimeNotFoundError
from app.models.cinema import Cinema
from app.models.showtime import Showtime
from app.schemas.seat_availability import ShowtimeSeatAvailabilityPublic
from app.scraping.logger import logger
from app.scraping.seat_availability import (
    EagerlyFeedCache,
    SeatAvailability,
    SeatAvailabilityFetchError,
    fetch_seat_availability,
    supports,
)
from app.services import push_notifications
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


# There is no far horizon. A screening months out with a seat left is more
# worth a request than a half-empty one tomorrow, and its own due time — set
# from how full it is, in `next_check_at` below — already decides how often it
# comes up. What bounds the cost is the caps here, not a cutoff date.
# Ceiling on one run, so a backlog cannot turn into a burst at a ticket shop.
# The poller runs often enough that a backlog this leaves behind is picked up
# a minute later rather than dropped.
#
# These are per *run*, so together with the tick they are the real rate limit:
# at a one-minute tick, 15 and 3 are 900/hour overall and 180/hour at any one
# shop — the same ceiling the old 60 and 12 bought at a five-minute tick, but
# arriving as a trickle instead of a burst every five minutes. Change the tick
# and these have to move with it, or the rate moves too.
POLL_BATCH_LIMIT = 15
# ...and a tighter ceiling per ticket shop, because "15 requests spread over
# ten cinemas" and "15 requests at one cinema" are very different things to be
# on the receiving end of.
POLL_HOST_BATCH_LIMIT = 3
# How many showtimes the query may return before the caps above trim it. Larger
# than the batch limit so a host that has used up its share can be passed over
# in favour of one that hasn't, instead of the whole run stalling behind it.
POLL_CANDIDATE_LIMIT = 400
# Ticket shops are fetched one host at a time; this is how many *hosts* run at
# once. Never raise this into per-host concurrency — these are real checkout
# pages, and the Z-ELITE shops sit behind a virtual waiting room.
HOST_CONCURRENCY = 4

# `last_few` fires on whichever comes first: a flat handful of seats, or a
# share of the screening's own capacity. The flat number carries small rooms
# (6 left in a 40-seat room is a real warning, 10% of it is 4 and far too
# late), and the fraction carries large ones (6 left in Eye's 312-seat Cinema 1
# is far too late, 10% of it is 31).
LAST_FEW_ABSOLUTE_SEATS = 6

# The remaining cutoffs are the fraction of the room still free, and a reading
# takes the emptiest bucket it still clears. Spread evenly across the middle
# rather than clustered at the ends: most screenings people look at sit between
# a third and two thirds full, and a scale that calls all of them "busy" tells
# nobody anything.
SOME_TAKEN_FREE_FRACTION = 0.75
BUSY_FREE_FRACTION = 0.40
VERY_BUSY_FREE_FRACTION = 0.10

# Where waiting for a returned ticket is a sensible thing to want. Lives here
# rather than with the watch itself so the client can be told, in the same
# response that carries the level, whether the option applies.
WATCHABLE_LEVELS = (
    SeatAvailabilityLevel.SOLD_OUT,
    SeatAvailabilityLevel.LAST_FEW,
)

# Reaching one of these is worth telling an interested user about, once.
SEAT_ALERT_LEVELS = (
    SeatAvailabilityLevel.LAST_FEW,
    SeatAvailabilityLevel.SOLD_OUT,
)

# The ratchet stops here rather than at SOLD_OUT. Everything below it only ever
# gets busier in practice, so pinning it is honest; sold out is the one state
# that genuinely reverses — the whole ticket-watch feature exists because it
# does — and a screening you can buy a seat for must never still read
# "Sold out". Raise this to SOLD_OUT to make the level strictly monotone.
LEVEL_FLOOR_CEILING = SeatAvailabilityLevel.LAST_FEW


def seat_availability_level(
    *, seats_left: int | None, seats_capacity: int | None
) -> SeatAvailabilityLevel | None:
    """Which busyness bucket a reading falls in, or None if we cannot say.

    None is not a sixth level and must not be rendered as one: it means the
    platform never gave a number, or gave one we have no capacity to compare it
    against. The cutoffs live here and nowhere else — the client picks an icon
    per level, it does not do arithmetic on the seat count.
    """
    if seats_left is None:
        return None
    if seats_left <= 0:
        return SeatAvailabilityLevel.SOLD_OUT
    # True whatever the room's size, and knowable without a capacity at all.
    if seats_left <= LAST_FEW_ABSOLUTE_SEATS:
        return SeatAvailabilityLevel.LAST_FEW
    if not seats_capacity:
        return None
    free = seats_left / seats_capacity
    if free >= SOME_TAKEN_FREE_FRACTION:
        return SeatAvailabilityLevel.SOME_TAKEN
    if free >= BUSY_FREE_FRACTION:
        return SeatAvailabilityLevel.BUSY
    if free >= VERY_BUSY_FREE_FRACTION:
        return SeatAvailabilityLevel.VERY_BUSY
    return SeatAvailabilityLevel.LAST_FEW


def effective_seat_level(showtime: Showtime) -> SeatAvailabilityLevel | None:
    """The level to show for `showtime`: what it reads now, but never emptier
    than the fullest it has ever been.

    The ratchet is not cosmetic. `seats_capacity` only ever grows — a better
    reading, an exact total from the platform, or the room's capacity learned
    from a sibling screening — and a bigger denominator makes an unchanged seat
    count look emptier than it did an hour ago. Without the floor a screening
    would visibly empty out as we learned more about it.
    """
    level = seat_availability_level(
        seats_left=showtime.seats_left, seats_capacity=showtime.seats_capacity
    )
    floor = showtime.seats_level_floor
    if floor is None:
        return level
    if level is None or is_fuller_than(floor, level):
        return floor
    return level


def _raised_floor(
    *, floor: SeatAvailabilityLevel | None, level: SeatAvailabilityLevel | None
) -> SeatAvailabilityLevel | None:
    """The new floor after seeing `level`, capped at `LEVEL_FLOOR_CEILING`."""
    if level is None:
        return floor
    capped = (
        LEVEL_FLOOR_CEILING if is_fuller_than(level, LEVEL_FLOOR_CEILING) else level
    )
    return capped if is_fuller_than(capped, floor) else floor


# How long to wait before reading a showtime again, per level: the interval
# used normally, and a tighter one for once the screening is close enough that
# a change still leaves someone time to act on it.
#
# The shape of it: the emptier a screening is, the less often anything worth
# knowing happens to it, and the further out it is, the less anyone can do with
# the answer.
#
# SOLD_OUT is deliberately absent — it is never re-read at all, see
# `next_check_at`. Anything past the ordinary levels is the sold-out watch's
# job (`app.services.sold_out_watch`): a much smaller, capped set of showtimes
# that can afford to look properly often.
_RECHECK_INTERVALS: dict[
    SeatAvailabilityLevel | None, tuple[timedelta, timedelta, timedelta]
] = {
    # level: (normal interval, "close" threshold, interval once close)
    SeatAvailabilityLevel.SOME_TAKEN: (
        timedelta(hours=4),
        timedelta(hours=8),
        timedelta(hours=2),
    ),
    SeatAvailabilityLevel.BUSY: (
        timedelta(hours=1),
        timedelta(hours=2),
        timedelta(minutes=30),
    ),
    SeatAvailabilityLevel.VERY_BUSY: (
        timedelta(minutes=30),
        timedelta(hours=2),
        timedelta(minutes=20),
    ),
    SeatAvailabilityLevel.LAST_FEW: (
        timedelta(minutes=15),
        timedelta(hours=2),
        timedelta(minutes=15),
    ),
    # The platform said nothing usable. Try again occasionally in case it starts
    # answering (a show id that isn't in the feed yet, a seat map that appears
    # once sales open), but never at a rate that costs a readable showtime its
    # place in the batch.
    None: (timedelta(hours=12), timedelta(hours=6), timedelta(hours=6)),
}

# A showtime whose count has not moved in several readings is read at a
# multiple of its interval, up to this cap. It only applies to the normal
# interval, never the close-to-showtime one: near the screening, freshness is
# the whole point and a quiet hour means nothing.
UNCHANGED_BACKOFF_CAP = 4
# Two showtimes that come due in the same second should not be read in the same
# second forever after. A few minutes of noise is enough to break up the convoy
# a burst of interest creates.
_RECHECK_JITTER = timedelta(minutes=4)
# Nothing here will ever read this link, so stop selecting it. Not "never":
# a cinema can move to a platform we do read, and the scrape rewrites ticket
# links in place.
UNSUPPORTED_RECHECK_AFTER = timedelta(days=7)


def next_check_at(
    *,
    showtime: Showtime,
    now: datetime,
    unchanged_streak: int,
) -> datetime:
    """When `showtime` should next be read, from how full and how soon it is.

    Reads the *effective* level, so the cadence always matches the level being
    shown — a screening pinned at "last few seats" by the ratchet keeps the
    quarter-hourly attention that level deserves.
    """
    level = effective_seat_level(showtime)
    if level is SeatAvailabilityLevel.SOLD_OUT:
        # Never again. A sold-out screening reads sold out on the next hundred
        # requests too, and the one case that matters — a ticket handed back —
        # is what the sold-out watch exists for, at a frequency this poller
        # could never justify across the catalogue. Parked at the screening's
        # own start time rather than a null: null means "never read" here and
        # would put it at the front of every run, while the start time can never
        # come due — the candidate query only takes screenings that have not
        # started, so "due" and "eligible" are mutually exclusive for it.
        #
        # The cost is deliberate and worth knowing: without a watch on it, a
        # screening that sells out and then has tickets released keeps reading
        # "Sold out" until someone looks. `LEVEL_FLOOR_CEILING` stops one rung
        # short of SOLD_OUT precisely so that state *can* reverse, and this is
        # the one thing standing between that mechanism and having no effect.
        return showtime.datetime
    interval, close_threshold, close_interval = _RECHECK_INTERVALS[level]
    if showtime.datetime - now <= close_threshold:
        delay = close_interval
    else:
        delay = interval * min(1 + unchanged_streak, UNCHANGED_BACKOFF_CAP)
    return now + delay + _RECHECK_JITTER * random.random()


def request_reading_on_interest(
    *, session: Session, showtime_id: int, now: datetime | None = None
) -> None:
    """Someone just selected this showtime — make sure a seat count is coming.

    Only ever brings the next reading forward for a showtime that has never
    been read at all; one with an existing reading, however old, is left on
    its own cadence. Queues, never requests: see
    `showtimes_crud.mark_seat_availability_due`.
    """
    reference_time = now or now_amsterdam_naive()
    showtimes_crud.mark_seat_availability_due(
        session=session,
        showtime_id=showtime_id,
        now=reference_time,
    )


# How many single-showtime "first interest" reads may be in flight across the
# whole process at once. Bounded so a burst of many people selecting many
# showtimes at the same moment degrades to the ordinary poller cadence instead
# of turning into an unbounded pile of concurrent ticket-shop requests — the
# thing `mark_seat_availability_due` above is deliberately careful not to
# cause. A quiet moment gets an answer in seconds; a busy one just falls back
# to "within a few minutes", which is what happened before this existed.
_IMMEDIATE_CHECK_CONCURRENCY = 6
_immediate_check_semaphore = threading.Semaphore(_IMMEDIATE_CHECK_CONCURRENCY)
# ...and never two at once at the same ticket shop, which the semaphore alone
# does not prevent. The poller keeps one in-flight request per host for the same
# reason — the Z-ELITE shops sit behind a virtual waiting room — and this path
# must not be the one that breaks that rule.
_immediate_check_hosts: set[str] = set()
_immediate_check_hosts_lock = threading.Lock()
# How far to push a skipped immediate read's due time. It has to move at all:
# the due time is in the past (that is what asked for this read), and every
# reader takes a past due time to mean "a reading is on its way" — so a read
# that never happened would otherwise leave the showtime claiming to be
# checking for ever. The poller only ever comes back to showtimes somebody has
# selected, so for the rest nothing else would ever correct it.
#
# Short, because the only thing standing in the way was a momentary crowd at
# the same ticket shop: a selected showtime is picked up by the very next
# poller run after this, and an unselected one simply stops promising a number
# and offers the check again.
_SKIPPED_CHECK_RETRY_AFTER = timedelta(minutes=1)


def _defer_skipped_check(*, session: Session, showtime: Showtime) -> None:
    """Move a showtime off "a read is coming" after declining to read it."""
    showtime.seats_next_check_at = now_amsterdam_naive() + _SKIPPED_CHECK_RETRY_AFTER
    session.add(showtime)
    session.commit()


def should_check_immediately(*, session: Session, showtime_id: int) -> bool:
    """Whether `showtime_id` has never had a seat reading at all.

    Read before `request_reading_on_interest` queues it, so the caller can
    decide whether to also try an immediate, best-effort read — see `check_now`.
    Only ever true once per showtime's life, and deliberately so: a showtime we
    already have a number for loses nothing by waiting for the poller, which
    marking interest brings forward anyway. The live request exists purely so
    the first person to care about a screening is not shown a blank where a
    seat count belongs.
    """
    showtime = session.get(Showtime, showtime_id)
    return (
        showtime is not None
        and showtime.seats_checked_at is None
        and showtime.ticket_link is not None
        and supports(showtime.ticket_link)
    )


def check_now(*, session: Session, showtime_id: int) -> None:
    """Best-effort immediate read for a showtime someone just showed interest in
    for the first time, so they are not left watching "checking..." for a whole
    poller tick.

    Skipped outright, rather than queued, when the process is already busy doing
    this for other showtimes, or when another one is already in flight at the
    same ticket shop — the poller remains the only guaranteed path, and this is
    purely a latency shortcut for the common, quiet case. Both guards exist for
    one scenario: somebody working down a long list, marking a hundred showtimes
    interested inside a minute. Every one of those is a first reading, so every
    one of them wants a live request, and without a ceiling that is how a cinema
    decides to block us. A skip still moves the due time (see
    `_defer_skipped_check`) — declining to read is not a reason to keep telling
    the client one is on its way.

    The never-read test is repeated here under this session because the request
    that dispatched it decided moments ago, and two people can tap the same
    showtime at once.
    """
    showtime = session.get(Showtime, showtime_id)
    if (
        showtime is None
        or showtime.seats_checked_at is not None
        or showtime.ticket_link is None
    ):
        return
    if not _immediate_check_semaphore.acquire(blocking=False):
        _defer_skipped_check(session=session, showtime=showtime)
        return
    host: str | None = None
    try:
        host = urlsplit(showtime.ticket_link).netloc
        with _immediate_check_hosts_lock:
            if host in _immediate_check_hosts:
                host = None
                _defer_skipped_check(session=session, showtime=showtime)
                return
            _immediate_check_hosts.add(host)
        try:
            availability = fetch_seat_availability(ticket_link=showtime.ticket_link)
        except SeatAvailabilityFetchError as e:
            logger.warning(
                f"Immediate seat availability read failed for showtime {showtime_id}: {e}"
            )
            # Without this the due time this call was triggered by (set by
            # `request_reading_on_interest`, always <= now) is never moved, so
            # `is_read_pending` keeps reporting "checking" forever — the poller
            # would eventually fix it by rescheduling on its own failed reads,
            # but only for a showtime that is still an eligible candidate (has
            # not started yet). One that has already started never comes up
            # again, so a failed immediate check would otherwise strand it in
            # "checking" for good.
            showtime.seats_next_check_at = next_check_at(
                showtime=showtime,
                now=now_amsterdam_naive(),
                unchanged_streak=showtime.seats_unchanged_streak,
            )
            session.add(showtime)
            session.commit()
            return
        cinema = session.get(Cinema, showtime.cinema_id)
        # This is a showtime's *first* reading, so its own running max is a
        # single sample and will read far too small in a room that is already
        # half sold — exactly the case where what the room taught the poller
        # matters most. Threading the index in is what stops that first number
        # from claiming an 85-seat room holds the 57 seats that happened to be
        # free (see `apply_reading`).
        room_capacities = room_capacity_crud.get_room_capacities(
            session=session, cinema_ids=[showtime.cinema_id]
        )
        known_room_capacities = dict(room_capacities)
        crossed = apply_reading(
            showtime=showtime,
            availability=availability,
            now=now_amsterdam_naive(),
            cinema_key=cinema.key if cinema else None,
            room_capacities=room_capacities,
            session=session,
        )
        _persist_raised_room_capacities(
            session=session,
            room_capacities=room_capacities,
            before=known_room_capacities,
        )
        session.add(showtime)
        session.commit()
        if crossed:
            push_notifications.send_seat_alerts(
                session=session, showtime_ids=[showtime_id]
            )
    finally:
        if host is not None:
            with _immediate_check_hosts_lock:
                _immediate_check_hosts.discard(host)
        _immediate_check_semaphore.release()


def is_read_pending(showtime: Showtime, *, now: datetime | None = None) -> bool:
    """Whether a fresh reading for this showtime is expected within moments.

    Read off the due time rather than any in-flight bookkeeping: a showtime that
    is already due is taken by the poller on its next tick, and anything that
    lands a reading pushes the due time into the future, which is exactly when
    this should stop being true. A due time that is absent means nobody has
    queued a read at all — no active selection — so nothing is coming.
    """
    if showtime.ticket_link is None or not supports(showtime.ticket_link):
        return False
    if showtime.seats_next_check_at is None:
        return False
    return showtime.seats_next_check_at <= (now or now_amsterdam_naive())


def is_trackable(showtime: Showtime) -> bool:
    """Whether a seat count can be read for this showtime at all.

    A property of its ticket shop, not of anything we have or haven't done yet:
    the overwhelming majority of cinemas run on platforms nothing here can read,
    and for those the client hides the availability block entirely rather than
    showing an "unknown" that will never resolve.
    """
    return showtime.ticket_link is not None and supports(showtime.ticket_link)


def to_public(showtime: Showtime) -> ShowtimeSeatAvailabilityPublic | None:
    """This showtime's availability as the client sees it, or None if there is
    nothing to say about it and never will be — see the schema's docstring."""
    level = effective_seat_level(showtime)
    checking = is_read_pending(showtime)
    trackable = is_trackable(showtime)
    if level is None:
        if not checking and not trackable:
            return None
        return ShowtimeSeatAvailabilityPublic(
            showtime_id=showtime.id,
            checking=checking,
            trackable=trackable,
            # The same one-shot rule as `should_check_immediately`, and off
            # while a read is already on its way — asking twice for the reading
            # that is currently being fetched buys nothing.
            can_request_check=(
                trackable and showtime.seats_checked_at is None and not checking
            ),
        )
    return ShowtimeSeatAvailabilityPublic(
        showtime_id=showtime.id,
        level=level,
        seats_left=showtime.seats_left,
        seats_capacity=showtime.seats_capacity,
        checked_at=showtime.seats_checked_at,
        watchable=(level in WATCHABLE_LEVELS and trackable),
        checking=checking,
        trackable=trackable,
    )


def get_seat_availability(
    *, session: Session, showtime_id: int
) -> ShowtimeSeatAvailabilityPublic | None:
    showtime = session.get(Showtime, showtime_id)
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)
    return to_public(showtime)


def get_seat_availability_batch(
    *, session: Session, showtime_ids: list[int]
) -> list[ShowtimeSeatAvailabilityPublic]:
    """Availability for many showtimes at once, skipping the ones there will
    never be anything to say about.

    Showtimes on a ticket platform nothing here can read are simply left out:
    the client caches per showtime and treats a missing entry as "no seat
    counts at this cinema", which is the one thing it wants to know about them.
    Everything else comes back, including a screening whose count has not been
    read yet — the client offers to ask for that one, so "not read" and "not
    readable" have to be told apart.
    """
    if not showtime_ids:
        return []
    showtimes_by_id = showtimes_crud.get_showtimes_by_ids(
        session=session, showtime_ids=list(dict.fromkeys(showtime_ids))
    )
    availabilities = (to_public(showtime) for showtime in showtimes_by_id.values())
    return [availability for availability in availabilities if availability is not None]


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
            logger.warning(
                f"Seat availability read failed for showtime {showtime.id}: {e}"
            )
    return readings


def apply_reading(
    *,
    showtime: Showtime,
    availability: SeatAvailability,
    now: datetime,
    cinema_key: str | None = None,
    room_capacities: RoomCapacityIndex | None = None,
    session: Session | None = None,
) -> bool:
    """Write one reading onto `showtime`, schedule its next one, and say whether
    it just became worth warning people about.

    Every caller that reads a ticket shop goes through this, including the
    sold-out watch — a reading it paid for is exactly as good as the poller's,
    and letting it land here is what stops the two from reading the same
    showtime twice over.

    `session` is what lets the reading's per-seat half be written down too (see
    `ShowtimeSeatMap`); every caller that actually polls has one. Omitting it
    keeps this a pure mutation of `showtime`, which is all the cadence and
    ratchet tests want.

    `room_capacities` is read *and updated in place*: a reading teaches us about
    the room as much as about the screening, and the next screening in that room
    should not have to learn it again. Persisting the changed entries is the
    caller's job (see `refresh_seat_availability`).

    Returns True only on the transition into `SEAT_ALERT_LEVELS`, and because
    that transition is tracked on the monotone floor rather than the live level,
    it can only ever be True once in a showtime's life.
    """
    previous_seats_left = showtime.seats_left
    previous_floor = showtime.seats_level_floor
    _apply_reading(showtime=showtime, availability=availability, cinema_key=cinema_key)

    # A room's capacity is the same fact for every screening in it, so the two
    # estimates feed each other: this reading raises the room's number, and the
    # room's number raises this screening's.
    if room_capacities is not None and showtime.room is not None:
        room_key = (showtime.cinema_id, showtime.room)
        if showtime.seats_capacity:
            room_capacities[room_key] = max(
                room_capacities.get(room_key, 0), showtime.seats_capacity
            )
        room_capacity = room_capacities.get(room_key)
        if room_capacity:
            showtime.seats_capacity = max(showtime.seats_capacity or 0, room_capacity)

    showtime.seats_level_floor = _raised_floor(
        floor=previous_floor, level=effective_seat_level(showtime)
    )

    if showtime.seats_left == previous_seats_left:
        showtime.seats_unchanged_streak += 1
    else:
        showtime.seats_unchanged_streak = 0
    showtime.seats_checked_at = now
    # The same response the count came from also said which seats those were,
    # so writing it down here costs nothing and is what keeps the seat picker
    # inside this cadence instead of reading the ticket shop on every open.
    if session is not None and availability.taken_seats is not None:
        seat_map_crud.record_seat_map(
            session=session,
            showtime_id=showtime.id,
            taken=[[row, seat] for row, seat in availability.taken_seats],
            checked_at=now,
        )
    showtime.seats_next_check_at = next_check_at(
        showtime=showtime,
        now=now,
        unchanged_streak=showtime.seats_unchanged_streak,
    )

    return (
        showtime.seats_level_floor in SEAT_ALERT_LEVELS
        and previous_floor not in SEAT_ALERT_LEVELS
    )


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


def simulate_reading(
    *,
    session: Session,
    showtime_id: int,
    seats_left: int | None,
    seats_capacity: int | None = None,
    reset: bool = False,
) -> ShowtimeSeatAvailabilityPublic | None:
    """Drive one showtime through the whole pipeline with made-up numbers.

    Exists because the interesting behaviour here — a level ratcheting up, the
    once-ever "nearly sold out" notice — only happens on a *transition*, and
    staging is reseeded from production, so it arrives with every one of those
    transitions already in the past. Waiting for a real screening to sell out
    while you watch is not a test.

    `reset` clears the ratchet floor and every "already told them" stamp for
    this showtime, so the same crossing can be exercised again and again. Both
    are superuser-only and refused in production — see the route.
    """
    showtime = session.get(Showtime, showtime_id)
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)

    now = now_amsterdam_naive()
    if reset:
        showtime.seats_level_floor = None
        showtime.seats_unchanged_streak = 0
        showtimes_crud.clear_seat_alerts(session=session, showtime_id=showtime_id)

    if seats_capacity is not None:
        showtime.seats_capacity = seats_capacity

    crossed = apply_reading(
        showtime=showtime,
        availability=SeatAvailability(
            seats_left, seats_left == 0, showtime.room, "simulated"
        ),
        now=now,
    )
    session.add(showtime)
    session.commit()

    if crossed:
        push_notifications.send_seat_alerts(session=session, showtime_ids=[showtime_id])
    session.refresh(showtime)
    return to_public(showtime)


def _select_batch(candidates: list[Showtime]) -> dict[str, list[Showtime]]:
    """Trim the due list to what one run may actually request, grouped by host.

    Candidates arrive in priority order — never read, then fewest seats left,
    then most overdue — and are taken in that order until either the run's
    budget or the host's own share of it runs out. Whatever is left over keeps
    its due time and is simply picked up by the next run, which is what turns a
    burst of new interest into a queue instead of a stampede.
    """
    by_host: dict[str, list[Showtime]] = defaultdict(list)
    taken = 0
    for showtime in candidates:
        if taken >= POLL_BATCH_LIMIT:
            break
        host = _ticket_host(showtime)
        if len(by_host[host]) >= POLL_HOST_BATCH_LIMIT:
            continue
        by_host[host].append(showtime)
        taken += 1
    return by_host


def _persist_raised_room_capacities(
    *,
    session: Session,
    room_capacities: RoomCapacityIndex,
    before: RoomCapacityIndex,
) -> None:
    """Write back the room capacities this run's readings raised.

    `apply_reading` updates the index in place, so the only rows worth a write
    are the ones that actually moved; everything else is what was loaded a
    moment ago.
    """
    for (cinema_id, room), capacity in room_capacities.items():
        if before.get((cinema_id, room)) == capacity:
            continue
        room_capacity_crud.record_room_capacity(
            session=session, cinema_id=cinema_id, room=room, seats_capacity=capacity
        )


def refresh_seat_availability(
    *,
    session: Session,
    now: datetime | None = None,
) -> int:
    """Re-read seat availability for due showtimes and return how many were read.

    Every showtime this run touches gets a new `seats_next_check_at`, including
    the ones whose read failed or whose platform we cannot read at all —
    otherwise those would come up due again immediately and crowd the readable
    ones out of every batch.
    """
    reference_time = now or now_amsterdam_naive()
    candidates = showtimes_crud.get_seat_availability_candidates(
        session=session,
        now=reference_time,
        limit=POLL_CANDIDATE_LIMIT,
    )
    if not candidates:
        return 0

    # Links no handler recognises cost a request to learn nothing. Park them
    # rather than reading them, and they stop competing for the batch.
    unsupported = [
        showtime
        for showtime in candidates
        if showtime.ticket_link is not None and not supports(showtime.ticket_link)
    ]
    for showtime in unsupported:
        showtime.seats_next_check_at = reference_time + UNSUPPORTED_RECHECK_AFTER
        session.add(showtime)

    unsupported_ids = {showtime.id for showtime in unsupported}
    by_host = _select_batch(
        [showtime for showtime in candidates if showtime.id not in unsupported_ids]
    )
    if not by_host:
        session.commit()
        return 0

    cinema_keys = {
        cinema.id: cinema.key for cinema in cinema_crud.get_cinemas(session=session)
    }
    batch_showtimes = [showtime for group in by_host.values() for showtime in group]
    room_capacities = room_capacity_crud.get_room_capacities(
        session=session,
        cinema_ids={showtime.cinema_id for showtime in batch_showtimes},
    )
    known_room_capacities = dict(room_capacities)

    readings: dict[int, SeatAvailability] = {}
    max_workers = min(len(by_host), HOST_CONCURRENCY) or 1
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for host_readings in executor.map(_read_host, by_host.values()):
            readings.update(host_readings)

    read_count = 0
    alerted_showtime_ids: list[int] = []
    for showtime in batch_showtimes:
        availability = readings.get(showtime.id)
        if availability is None:
            # The read failed. Nothing is known that wasn't before, so the
            # cadence is recomputed from the numbers already on the row.
            showtime.seats_next_check_at = next_check_at(
                showtime=showtime,
                now=reference_time,
                unchanged_streak=showtime.seats_unchanged_streak,
            )
        else:
            crossed = apply_reading(
                showtime=showtime,
                availability=availability,
                now=reference_time,
                cinema_key=cinema_keys.get(showtime.cinema_id),
                room_capacities=room_capacities,
                session=session,
            )
            if crossed:
                alerted_showtime_ids.append(showtime.id)
            if availability.is_known:
                read_count += 1
        session.add(showtime)

    _persist_raised_room_capacities(
        session=session,
        room_capacities=room_capacities,
        before=known_room_capacities,
    )
    session.commit()

    if alerted_showtime_ids:
        # Deliberately after the commit: the floor is what makes this fire once
        # ever, so it has to be durable before anyone is told.
        push_notifications.send_seat_alerts(
            session=session, showtime_ids=alerted_showtime_ids
        )
    return read_count
