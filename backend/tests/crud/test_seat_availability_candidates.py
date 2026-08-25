"""Which showtimes the seat poller picks up, and in what order.

The ordering is the whole policy: there is no date horizon any more, so what
gets read when a run is capped is decided entirely here.
"""

from datetime import timedelta

from sqlmodel import Session

from app.crud import showtime as showtime_crud
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.utils import now_amsterdam_naive

NOW = now_amsterdam_naive()


def _candidates(session: Session, limit: int = 50) -> list[int]:
    return [
        showtime.id
        for showtime in showtime_crud.get_seat_availability_candidates(
            session=session,
            now=NOW,
            limit=limit,
        )
    ]


def _selected(
    session: Session, showtime_factory, user, /, **kwargs
) -> Showtime:
    """A showtime someone is interested in — the only kind the poller reads."""
    showtime: Showtime = showtime_factory(**kwargs)
    session.add(ShowtimeSelection(user_id=user.id, showtime_id=showtime.id))
    session.flush()
    return showtime


def test_a_showtime_months_out_is_still_polled(
    *, db_transaction: Session, showtime_factory, user_factory
):
    """The case the old 14-day horizon got wrong: a screening far in the future
    with almost no seats left is the most worth reading, not the least."""
    user = user_factory()
    far = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(days=90),
        seats_left=1,
        seats_capacity=200,
        seats_checked_at=NOW - timedelta(minutes=20),
        seats_next_check_at=NOW - timedelta(minutes=5),
    )

    assert far.id in _candidates(db_transaction)


def test_a_tight_cadence_outranks_a_longer_one_at_equal_lateness(
    *, db_transaction: Session, showtime_factory, user_factory
):
    """Priority is lateness measured in the showtime's *own* intervals. Both of
    these are 15 minutes overdue; the one on a quarter-hourly cadence is a whole
    interval late, the one on a twelve-hour cadence has barely started."""
    user = user_factory()
    almost_full = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(days=90),
        seats_left=1,
        seats_capacity=200,
        # 15-minute interval: checked at -30, due at -15.
        seats_checked_at=NOW - timedelta(minutes=30),
        seats_next_check_at=NOW - timedelta(minutes=15),
    )
    barely_touched = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(hours=6),
        seats_left=190,
        seats_capacity=200,
        # 12-hour interval, equally overdue in wall-clock minutes.
        seats_checked_at=NOW - timedelta(hours=12, minutes=15),
        seats_next_check_at=NOW - timedelta(minutes=15),
    )

    assert _candidates(db_transaction) == [almost_full.id, barely_touched.id]


def test_a_starved_showtime_climbs_until_it_is_read(
    *, db_transaction: Session, showtime_factory, user_factory
):
    """Nothing can be dropped by the run caps forever: a showtime passed over
    keeps accruing lateness in its own intervals until it outranks its busier
    neighbours."""
    user = user_factory()
    starved = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(days=3),
        seats_left=150,
        seats_capacity=200,
        # Hourly cadence, six hours overdue — six intervals late.
        seats_checked_at=NOW - timedelta(hours=7),
        seats_next_check_at=NOW - timedelta(hours=6),
    )
    urgent = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(days=3),
        seats_left=2,
        seats_capacity=200,
        # Quarter-hourly and one interval late.
        seats_checked_at=NOW - timedelta(minutes=30),
        seats_next_check_at=NOW - timedelta(minutes=15),
    )

    assert _candidates(db_transaction) == [starved.id, urgent.id]


def test_a_moving_count_outranks_a_stalled_one(
    *, db_transaction: Session, showtime_factory, user_factory
):
    """Something is actually happening to this screening. Equal cadence, equal
    lateness — the one whose count moved on its last reading goes first."""
    user = user_factory()
    stalled = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(days=3),
        seats_left=100,
        seats_capacity=200,
        seats_unchanged_streak=3,
        seats_checked_at=NOW - timedelta(hours=2),
        seats_next_check_at=NOW - timedelta(hours=1),
    )
    moving = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(days=3),
        seats_left=100,
        seats_capacity=200,
        seats_unchanged_streak=0,
        seats_checked_at=NOW - timedelta(hours=2),
        seats_next_check_at=NOW - timedelta(hours=1),
    )

    assert _candidates(db_transaction) == [moving.id, stalled.id]


def test_a_never_read_showtime_goes_ahead_of_everything(
    *, db_transaction: Session, showtime_factory, user_factory
):
    """Someone selected it and there is nothing at all to show them yet."""
    user = user_factory()
    unread = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(days=30),
        seats_left=None,
        seats_checked_at=None,
        seats_next_check_at=None,
    )
    almost_full = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(days=2),
        seats_left=2,
        seats_capacity=200,
        seats_unchanged_streak=0,
        seats_checked_at=NOW - timedelta(hours=4),
        seats_next_check_at=NOW - timedelta(hours=3),
    )

    assert _candidates(db_transaction) == [unread.id, almost_full.id]


def test_an_unknown_count_sorts_last_not_first(
    *, db_transaction: Session, showtime_factory, user_factory
):
    """A platform that reports status without a number leaves `seats_left`
    null. Null must not read as "zero seats left" and hog every batch."""
    user = user_factory()
    unknown_count = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(days=2),
        seats_left=None,
        # Read before — this is an unreadable count, not a new showtime.
        # Same cadence and lateness as the one below, so only the tiebreak
        # separates them.
        seats_unchanged_streak=1,
        seats_checked_at=NOW - timedelta(hours=2),
        seats_next_check_at=NOW - timedelta(hours=1),
    )
    half_empty = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(days=2),
        seats_left=100,
        seats_capacity=200,
        seats_unchanged_streak=1,
        seats_checked_at=NOW - timedelta(hours=2),
        seats_next_check_at=NOW - timedelta(hours=1),
    )

    assert _candidates(db_transaction) == [half_empty.id, unknown_count.id]


def test_a_showtime_about_to_start_is_still_read(
    *, db_transaction: Session, showtime_factory, user_factory
):
    """There is no minimum notice: somebody ten minutes from the cinema can
    still act on a seat that just freed up."""
    user = user_factory()
    starting_soon = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(minutes=10),
        seats_left=1,
        seats_capacity=200,
        seats_checked_at=NOW - timedelta(minutes=20),
        seats_next_check_at=NOW - timedelta(minutes=5),
    )

    assert starting_soon.id in _candidates(db_transaction)


def test_a_screening_that_has_started_is_dropped(
    *, db_transaction: Session, showtime_factory, user_factory
):
    """The one bound left on when. Seats mean nothing once the film is running,
    and there are unboundedly many past screenings with selections on them."""
    user = user_factory()
    started = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW - timedelta(minutes=1),
        seats_left=1,
        seats_capacity=200,
        seats_checked_at=NOW - timedelta(minutes=20),
        seats_next_check_at=NOW - timedelta(minutes=5),
    )

    assert started.id not in _candidates(db_transaction)


def test_a_sold_out_screening_can_never_come_due(
    *, db_transaction: Session, showtime_factory, user_factory
):
    """`next_check_at` parks it at its own start time, and the query only takes
    screenings that have not started — the two conditions cannot both hold."""
    user = user_factory()
    parked = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(days=3),
        seats_left=0,
        seats_capacity=200,
        seats_checked_at=NOW - timedelta(hours=1),
        seats_next_check_at=NOW + timedelta(days=3),
    )

    assert parked.id not in _candidates(db_transaction)


def test_a_showtime_nobody_selected_is_never_read(
    *, db_transaction: Session, showtime_factory
):
    """Every reading is a request at a real ticket shop."""
    unselected: Showtime = showtime_factory(
        datetime=NOW + timedelta(days=2),
        seats_left=1,
        seats_capacity=200,
        seats_next_check_at=NOW - timedelta(minutes=5),
    )
    db_transaction.flush()

    assert unselected.id not in _candidates(db_transaction)


def test_a_showtime_not_yet_due_is_left_alone(
    *, db_transaction: Session, showtime_factory, user_factory
):
    """The row's own due time is the only cadence, and it is respected even for
    a screening down to its last seat."""
    user = user_factory()
    not_due = _selected(
        db_transaction,
        showtime_factory,
        user,
        datetime=NOW + timedelta(days=2),
        seats_left=1,
        seats_capacity=200,
        seats_checked_at=NOW - timedelta(minutes=2),
        seats_next_check_at=NOW + timedelta(minutes=13),
    )

    assert not_due.id not in _candidates(db_transaction)
