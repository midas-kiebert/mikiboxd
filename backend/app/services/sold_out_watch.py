"""Watch a full showtime for a returned ticket, and say so when one appears.

This is the one place in the app that polls a ticket shop hard, and everything
about it is shaped by keeping that affordable. A returned ticket is typically
gone within minutes, so the ordinary seat poller's cadence — measured in hours
— would essentially never catch one; the only useful frequency is one that
would be indefensible applied to the catalogue at large. So it isn't: a watch
covers one showtime, a user may hold one at a time, only some accounts may
hold one at all (`User.is_pro`), and `MAX_ACTIVE_WATCHES` caps how many exist
across everyone.

Within a watch, the frequency still tapers. Most of a watch's life is spent
long before anything can happen, and the minutes that actually matter are the
last couple of hours before the screening, when people who can't make it give
their tickets back. So it looks often at first (a ticket released right after
someone starts watching is the most likely single moment), settles into a slow
background rhythm, and comes back up to full speed for the run-up.
"""

from datetime import datetime, timedelta
from uuid import UUID

from sqlmodel import Session

from app.crud import cinema as cinema_crud
from app.crud import sold_out_watch as sold_out_watch_crud
from app.exceptions.showtime_exceptions import (
    ShowtimeNotFoundError,
    SoldOutWatchCapacityError,
    SoldOutWatchNotAllowedError,
    SoldOutWatchNotApplicableError,
)
from app.models.showtime import Showtime
from app.models.sold_out_watch import SoldOutWatch
from app.models.user import User
from app.schemas.seat_availability import SoldOutWatchPublic
from app.scraping.logger import logger
from app.scraping.seat_availability import (
    SeatAvailabilityFetchError,
    fetch_seat_availability,
    supports,
)
from app.services import push_notifications
from app.services.seat_availability import (
    WATCHABLE_LEVELS,
    apply_reading,
    effective_seat_level,
)
from app.utils import now_amsterdam_naive

# Across every user at once. Deliberately small: this is not a product tier
# with headroom to sell, it is a handful of accounts allowed to lean on a
# handful of ticket shops, and the number is what makes that true.
MAX_ACTIVE_WATCHES = 5

# The opening burst: releases cluster right after someone goes looking, partly
# because that is when they check, partly because they start watching *because*
# something just changed.
INITIAL_INTERVAL = timedelta(minutes=3)
INITIAL_PHASE = timedelta(minutes=45)
# The long middle, where nothing is likely to happen and the point is to still
# be there when it does.
STEADY_INTERVAL = timedelta(minutes=10)
IDLE_PHASE = timedelta(hours=6)
# ...and slower still once a watch has been running most of a day.
IDLE_INTERVAL = timedelta(minutes=20)
# The run-up, when people who can't make it hand their tickets back. This is
# the window the whole feature exists for.
FINAL_APPROACH = timedelta(hours=2)
FINAL_APPROACH_INTERVAL = timedelta(minutes=3)
# Past this point a returned ticket is no use to anyone who'd have to travel.
WATCH_STOPS_BEFORE_SHOWTIME = timedelta(minutes=20)


def next_watch_check_at(
    *, watch: SoldOutWatch, showtime: Showtime, now: datetime
) -> datetime:
    """When this watch should look again."""
    if showtime.datetime - now <= FINAL_APPROACH:
        return now + FINAL_APPROACH_INTERVAL
    watching_for = now - watch.created_at
    if watching_for <= INITIAL_PHASE:
        return now + INITIAL_INTERVAL
    if watching_for <= IDLE_PHASE:
        return now + STEADY_INTERVAL
    return now + IDLE_INTERVAL


def is_watchable(showtime: Showtime) -> bool:
    """Whether it makes sense to offer a watch on this showtime at all."""
    if showtime.ticket_link is None or not supports(showtime.ticket_link):
        return False
    return effective_seat_level(showtime) in WATCHABLE_LEVELS


def _to_public(watch: SoldOutWatch | None) -> SoldOutWatchPublic | None:
    if watch is None:
        return None
    return SoldOutWatchPublic(
        showtime_id=watch.showtime_id, created_at=watch.created_at
    )


def get_watch(*, session: Session, user_id: UUID) -> SoldOutWatchPublic | None:
    return _to_public(
        sold_out_watch_crud.get_watch_for_user(session=session, user_id=user_id)
    )


def start_watch(
    *, session: Session, user: User, showtime_id: int
) -> SoldOutWatchPublic:
    """Point this user's watch at `showtime_id`, replacing whatever it watched.

    Moving the existing watch rather than refusing a second one is what enforces
    "one at a time" — the alternative makes the user go and find the old one
    before they can start the one they actually want.
    """
    if not user.is_pro:
        raise SoldOutWatchNotAllowedError()

    showtime = session.get(Showtime, showtime_id)
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)
    if not is_watchable(showtime):
        raise SoldOutWatchNotApplicableError()
    if showtime.datetime - now_amsterdam_naive() <= WATCH_STOPS_BEFORE_SHOWTIME:
        raise SoldOutWatchNotApplicableError()

    existing = sold_out_watch_crud.get_watch_for_user(
        session=session, user_id=user.id
    )
    # The cap counts watches, not users, so someone moving their own watch is
    # never the person turned away by it.
    if (
        existing is None
        and sold_out_watch_crud.count_active_watches(session=session)
        >= MAX_ACTIVE_WATCHES
    ):
        raise SoldOutWatchCapacityError()

    watch = sold_out_watch_crud.set_watch_for_user(
        session=session,
        user_id=user.id,
        showtime_id=showtime_id,
        now=now_amsterdam_naive(),
    )
    session.commit()
    session.refresh(watch)
    public = _to_public(watch)
    assert public is not None
    return public


def stop_watch(*, session: Session, user_id: UUID) -> bool:
    deleted = sold_out_watch_crud.delete_watch_for_user(
        session=session, user_id=user_id
    )
    session.commit()
    return deleted


def run_due_watches(*, session: Session, now: datetime | None = None) -> int:
    """Check every due watch and return how many found seats.

    A watch that finds seats has done its job and is deleted, so the user is
    told once rather than every few minutes for the rest of the evening.
    """
    reference_time = now or now_amsterdam_naive()
    watches = sold_out_watch_crud.get_due_watches(session=session, now=reference_time)
    if not watches:
        return 0

    cinema_keys = {
        cinema.id: cinema.key for cinema in cinema_crud.get_cinemas(session=session)
    }

    notified = 0
    for watch in watches:
        showtime = session.get(Showtime, watch.showtime_id)
        if showtime is None or showtime.ticket_link is None:
            session.delete(watch)
            continue
        if showtime.datetime - reference_time <= WATCH_STOPS_BEFORE_SHOWTIME:
            session.delete(watch)
            continue

        try:
            availability = fetch_seat_availability(ticket_link=showtime.ticket_link)
        except SeatAvailabilityFetchError as e:
            logger.warning(f"Sold-out watch read failed for showtime {showtime.id}: {e}")
            availability = None

        watch.checks_done += 1
        watch.last_checked_at = reference_time
        watch.next_check_at = next_watch_check_at(
            watch=watch, showtime=showtime, now=reference_time
        )
        session.add(watch)

        if availability is None:
            continue

        # The reading is as good as the poller's, so it lands the same way —
        # which also pushes the showtime's own due time out, instead of the two
        # jobs reading the same page minutes apart. No room-capacity index is
        # threaded through: a watched showtime is by definition already at the
        # top of the ratchet, so what it could teach us about the room cannot
        # change any level, and the poller will fold it in soon enough anyway.
        apply_reading(
            showtime=showtime,
            availability=availability,
            now=reference_time,
            cinema_key=cinema_keys.get(showtime.cinema_id),
        )
        session.add(showtime)

        if showtime.seats_left is None or showtime.seats_left <= 0:
            continue

        push_notifications.notify_user_on_seats_released(
            session=session,
            user_id=watch.user_id,
            showtime=showtime,
            seats_left=showtime.seats_left,
        )
        session.delete(watch)
        notified += 1

    session.commit()
    return notified
