"""The sold-out watch's cadence and what it will agree to watch."""

from datetime import datetime, timedelta

import pytest

from app.models.showtime import Showtime
from app.models.sold_out_watch import SoldOutWatch
from app.services.sold_out_watch import (
    FINAL_APPROACH_INTERVAL,
    IDLE_INTERVAL,
    INITIAL_INTERVAL,
    STEADY_INTERVAL,
    is_watchable,
    next_watch_check_at,
)

NOW = datetime(2026, 8, 24, 12, 0)
READABLE_TICKET_LINK = "https://tickets.lab111.nl/order/1"


def _showtime(
    *,
    starts_in: timedelta = timedelta(days=1),
    seats_left: int | None = 0,
    seats_capacity: int | None = 100,
    ticket_link: str | None = READABLE_TICKET_LINK,
) -> Showtime:
    return Showtime(
        id=1,
        movie_id=1,
        cinema_id=1,
        datetime=NOW + starts_in,
        ticket_link=ticket_link,
        seats_left=seats_left,
        seats_capacity=seats_capacity,
    )


def _watch(*, watching_for: timedelta) -> SoldOutWatch:
    return SoldOutWatch(
        user_id="00000000-0000-0000-0000-000000000001",  # type: ignore[arg-type]
        showtime_id=1,
        created_at=NOW - watching_for,
        next_check_at=NOW,
    )


@pytest.mark.parametrize(
    "watching_for, starts_in, expected",
    [
        # Right after someone starts watching is the likeliest single moment.
        (timedelta(minutes=5), timedelta(days=1), INITIAL_INTERVAL),
        # The long middle, where the job is to still be there.
        (timedelta(hours=2), timedelta(days=1), STEADY_INTERVAL),
        (timedelta(hours=20), timedelta(days=1), IDLE_INTERVAL),
        # ...and back to full speed for the run-up, which is when people who
        # can't make it actually hand their tickets back.
        (timedelta(hours=20), timedelta(hours=1), FINAL_APPROACH_INTERVAL),
    ],
)
def test_cadence_tapers_then_ramps_back_up(
    watching_for, starts_in, expected
) -> None:
    next_check = next_watch_check_at(
        watch=_watch(watching_for=watching_for),
        showtime=_showtime(starts_in=starts_in),
        now=NOW,
    )
    assert next_check - NOW == expected


@pytest.mark.parametrize(
    "seats_left, seats_capacity, expected",
    [
        (0, 100, True),
        # Nearly sold out counts: the difference from full is a rounding error,
        # and waiting for the last few seats is the same want.
        (4, 100, True),
        (40, 100, False),
        # No reading at all is not a reason to start polling something hard.
        (None, None, False),
    ],
)
def test_only_full_showtimes_are_watchable(
    seats_left, seats_capacity, expected
) -> None:
    showtime = _showtime(seats_left=seats_left, seats_capacity=seats_capacity)
    assert is_watchable(showtime) is expected


def test_a_ticket_shop_we_cannot_read_is_not_watchable() -> None:
    """Rialto and Cineville reveal nothing, so a watch there would poll for ever
    and never be able to say anything."""
    showtime = _showtime(ticket_link="https://rialto.activetickets.nl/order/1")
    assert is_watchable(showtime) is False
    assert is_watchable(_showtime(ticket_link=None)) is False
