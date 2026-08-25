"""What showing interest in a screening does to its seat reading.

Two things have to be true for the sheet to feel live: marking interest earns a
real request unless it would be spam, and the client is told a reading is coming
so it can say so rather than showing nothing or a stale number in silence.
"""

from datetime import timedelta

from app.core.enums import SeatAvailabilityLevel
from app.models.showtime import Showtime
from app.services.seat_availability import (
    is_read_pending,
    request_reading_on_interest,
    should_check_immediately,
    to_public,
)
from app.utils import now_amsterdam_naive

# Real "now": `to_public` reads the clock itself to decide whether a reading is
# pending, so the fixtures have to sit either side of the actual current time.
NOW = now_amsterdam_naive()

READABLE_TICKET_LINK = (
    "https://tickets.lab111.nl/labcinema/nl/flow_configs/webshop"
    "/steps/start/show/1293554"
)


def _showtime(**kwargs) -> Showtime:
    kwargs.setdefault("ticket_link", READABLE_TICKET_LINK)
    return Showtime(
        id=1,
        movie_id=1,
        cinema_id=1,
        datetime=NOW + timedelta(days=2),
        **kwargs,
    )


def test_a_due_showtime_reports_a_reading_on_the_way() -> None:
    showtime = _showtime(
        seats_left=40,
        seats_capacity=100,
        seats_checked_at=NOW - timedelta(hours=2),
        seats_next_check_at=NOW - timedelta(minutes=1),
    )
    assert is_read_pending(showtime, now=NOW) is True


def test_a_showtime_on_cooldown_reports_nothing_pending() -> None:
    showtime = _showtime(
        seats_left=40,
        seats_capacity=100,
        seats_checked_at=NOW - timedelta(minutes=1),
        seats_next_check_at=NOW + timedelta(minutes=30),
    )
    assert is_read_pending(showtime, now=NOW) is False


def test_a_showtime_nobody_asked_about_reports_nothing_pending() -> None:
    """A null due time is "nobody has queued a read", not "read imminently"."""
    showtime = _showtime(seats_checked_at=None, seats_next_check_at=None)
    assert is_read_pending(showtime, now=NOW) is False


def test_an_unreadable_platform_never_reports_pending() -> None:
    showtime = _showtime(
        ticket_link="https://tickets.example.com/order/1",
        seats_next_check_at=NOW - timedelta(minutes=1),
    )
    assert is_read_pending(showtime, now=NOW) is False


def test_checking_coexists_with_the_number_already_known() -> None:
    """A re-read must not blank a perfectly good answer: the client shows the
    previous count *and* says a fresher one is coming."""
    showtime = _showtime(
        seats_left=30,
        seats_capacity=100,
        seats_checked_at=NOW - timedelta(hours=2),
        seats_next_check_at=NOW - timedelta(minutes=1),
    )

    public = to_public(showtime)

    assert public is not None
    assert public.checking is True
    assert public.seats_left == 30
    assert public.level is SeatAvailabilityLevel.VERY_BUSY


def test_a_first_read_pending_is_reported_without_a_level() -> None:
    showtime = _showtime(seats_next_check_at=NOW - timedelta(seconds=1))

    public = to_public(showtime)

    assert public is not None
    assert public.checking is True
    assert public.level is None


def test_the_level_shown_is_the_ratcheted_one() -> None:
    """`to_public` is the display path, so it has to read the same level the
    cadence does — the floor is what stops a screening appearing to empty out."""
    showtime = _showtime(
        seats_left=40,
        seats_capacity=100,
        seats_level_floor=SeatAvailabilityLevel.LAST_FEW,
        seats_checked_at=NOW - timedelta(minutes=1),
        seats_next_check_at=NOW + timedelta(minutes=15),
    )

    public = to_public(showtime)

    assert public is not None
    assert public.level is SeatAvailabilityLevel.LAST_FEW
    assert public.watchable is True


def test_a_showtime_already_read_never_earns_a_second_live_request(
    *, db_transaction, showtime_factory
) -> None:
    """The live request exists so the first person to care about a screening is
    not shown a blank. Once there is a number, marking interest queues a poller
    read and nothing more — otherwise somebody working down a long list would
    fire a request per tap."""
    read_once: Showtime = showtime_factory(
        datetime=NOW + timedelta(days=2),
        ticket_link=READABLE_TICKET_LINK,
        seats_left=40,
        seats_capacity=100,
        seats_checked_at=NOW - timedelta(hours=6),
    )
    never_read: Showtime = showtime_factory(
        datetime=NOW + timedelta(days=2),
        ticket_link=READABLE_TICKET_LINK.replace("1293554", "1293555"),
        seats_checked_at=None,
    )
    db_transaction.flush()

    assert (
        should_check_immediately(
            session=db_transaction, showtime_id=read_once.id
        )
        is False
    )
    assert (
        should_check_immediately(
            session=db_transaction, showtime_id=never_read.id
        )
        is True
    )


def test_selecting_a_showtime_with_a_stale_reading_does_not_pull_its_cadence_forward(
    *, db_transaction, showtime_factory
) -> None:
    """`request_reading_on_interest` is what fires when a user sets GOING or
    INTERESTED. For a showtime that already has a reading — no matter how
    stale — that must be a pure no-op on `seats_next_check_at`: the poller's
    own cadence owns that field from here on."""
    far_future = NOW + timedelta(days=1)
    showtime: Showtime = showtime_factory(
        datetime=NOW + timedelta(days=2),
        ticket_link="https://tickets.lab111.nl/order/3",
        seats_left=12,
        seats_capacity=100,
        seats_checked_at=NOW - timedelta(hours=2),
        seats_next_check_at=far_future,
    )
    db_transaction.flush()

    request_reading_on_interest(
        session=db_transaction, showtime_id=showtime.id, now=NOW
    )

    assert showtime.seats_next_check_at == far_future
