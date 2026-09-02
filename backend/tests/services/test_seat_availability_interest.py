"""What showing interest in a screening does to its seat reading.

Two things have to be true for the sheet to feel live: marking interest earns a
real request unless it would be spam, and the client is told a reading is coming
so it can say so rather than showing nothing or a stale number in silence.

`to_public`'s three-way answer is the third: nothing at all for a cinema whose
seat counts cannot be read (the sheet hides the block), a bare `trackable` for
one that simply has not been read (the sheet offers to go and read it), and a
level once there is one.
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
UNREADABLE_TICKET_LINK = "https://tickets.example.com/order/1"


def _showtime(**kwargs) -> Showtime:
    kwargs.setdefault("ticket_link", READABLE_TICKET_LINK)
    kwargs.setdefault("datetime", NOW + timedelta(days=2))
    return Showtime(
        id=1,
        movie_id=1,
        cinema_id=1,
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


def test_a_long_overdue_showtime_stops_reporting_pending() -> None:
    """Nobody is coming for it. The poller only takes screenings somebody has
    selected, so a hand-requested check (the "Check" button) on one nobody is
    interested in leaves a due time behind that nothing will ever consume — and
    "Checking now…" would stick for the rest of the screening's life."""
    showtime = _showtime(
        seats_left=40,
        seats_capacity=100,
        seats_checked_at=NOW - timedelta(hours=6),
        seats_next_check_at=NOW - timedelta(hours=5),
    )
    assert is_read_pending(showtime, now=NOW) is False


def test_a_started_showtime_reports_nothing_pending() -> None:
    """The candidate query only takes screenings that have not started, and a
    sold-out one is parked at its own start time on purpose."""
    showtime = _showtime(
        datetime=NOW - timedelta(minutes=10),
        seats_left=0,
        seats_capacity=100,
        seats_checked_at=NOW - timedelta(hours=1),
        seats_next_check_at=NOW - timedelta(minutes=10),
    )
    assert is_read_pending(showtime, now=NOW) is False


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
        ticket_link=UNREADABLE_TICKET_LINK,
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


def test_a_cinema_we_cannot_read_says_nothing_at_all() -> None:
    """The one case the client hides the whole "Available seats" block on, so
    it has to stay distinguishable from "not read yet" — a permanent shrug next
    to a real ticket link is worse than no row."""
    showtime = _showtime(ticket_link=UNREADABLE_TICKET_LINK)

    assert to_public(showtime) is None


def test_a_readable_showtime_nobody_has_read_offers_the_check() -> None:
    showtime = _showtime(seats_checked_at=None, seats_next_check_at=None)

    public = to_public(showtime)

    assert public is not None
    assert public.trackable is True
    assert public.level is None
    assert public.checking is False
    assert public.can_request_check is True


def test_a_read_already_on_its_way_is_not_worth_asking_for_again() -> None:
    showtime = _showtime(
        seats_checked_at=None, seats_next_check_at=NOW - timedelta(seconds=1)
    )

    public = to_public(showtime)

    assert public is not None
    assert public.checking is True
    assert public.can_request_check is False


def test_a_showtime_read_once_with_nothing_usable_is_not_offered_again() -> None:
    """Read, and the platform had no count to give. Not "yet" — the poller owns
    it from here, and the button would only buy a repeat of the same answer."""
    showtime = _showtime(
        seats_checked_at=NOW - timedelta(hours=1),
        seats_next_check_at=NOW + timedelta(hours=12),
    )

    public = to_public(showtime)

    assert public is not None
    assert public.trackable is True
    assert public.level is None
    assert public.can_request_check is False


def test_a_reading_survives_its_ticket_link_becoming_unreadable() -> None:
    """`trackable` is about the ticket shop, not about what we know: a count we
    already have is still shown once the link moves to a platform we cannot
    read, just with nothing on offer beyond it."""
    showtime = _showtime(
        ticket_link=UNREADABLE_TICKET_LINK,
        seats_left=40,
        seats_capacity=100,
        seats_checked_at=NOW - timedelta(minutes=1),
        seats_next_check_at=NOW + timedelta(hours=1),
    )

    public = to_public(showtime)

    assert public is not None
    assert public.level is SeatAvailabilityLevel.VERY_BUSY
    assert public.trackable is False
    assert public.watchable is False
    assert public.can_request_check is False
