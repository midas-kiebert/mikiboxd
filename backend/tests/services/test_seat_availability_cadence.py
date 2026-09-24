"""How often a showtime is re-read, and how a run's budget is spread."""

from datetime import datetime, timedelta

import pytest

from app.models.showtime import Showtime
from app.scraping.seat_availability import SeatAvailability
from app.services.seat_availability import (
    POLL_BATCH_LIMIT,
    POLL_HOST_BATCH_LIMIT,
    SOLD_OUT_FINAL_APPROACH,
    SOLD_OUT_FINAL_APPROACH_INTERVAL,
    SOLD_OUT_LAST_CHECK_BEFORE,
    SOLD_OUT_RECHECK_INTERVAL,
    UNCHANGED_BACKOFF_CAP,
    _RECHECK_JITTER,
    _select_batch,
    apply_reading,
    next_check_at,
)

NOW = datetime(2026, 8, 24, 12, 0)


def _showtime(
    *,
    starts_in: timedelta,
    seats_left: int | None = None,
    seats_capacity: int | None = None,
    ticket_link: str = "https://tickets.lab111.nl/order/1",
    showtime_id: int = 1,
) -> Showtime:
    return Showtime(
        id=showtime_id,
        movie_id=1,
        cinema_id=1,
        datetime=NOW + starts_in,
        ticket_link=ticket_link,
        seats_left=seats_left,
        seats_capacity=seats_capacity,
    )


def _delay(showtime: Showtime, *, unchanged_streak: int = 0) -> timedelta:
    """The scheduled interval with the anti-convoy jitter taken back off."""
    return (
        next_check_at(showtime=showtime, now=NOW, unchanged_streak=unchanged_streak)
        - NOW
        - _RECHECK_JITTER / 2
    )


@pytest.mark.parametrize(
    "seats_left, seats_capacity, starts_in, expected",
    [
        # Nearly empty and a week out: nothing worth knowing happens often.
        (80, 100, timedelta(days=7), timedelta(hours=4)),
        # ...but close enough to the showtime, a quiet screening can still
        # start moving.
        (80, 100, timedelta(hours=6), timedelta(hours=2)),
        (50, 100, timedelta(days=7), timedelta(hours=1)),
        (50, 100, timedelta(hours=1, minutes=30), timedelta(minutes=30)),
        (30, 100, timedelta(days=7), timedelta(minutes=30)),
        (30, 100, timedelta(hours=1, minutes=30), timedelta(minutes=20)),
        # The one that can actually sell out under you.
        (5, 100, timedelta(days=7), timedelta(minutes=15)),
        # Nothing readable — try again occasionally, never often.
        (None, None, timedelta(days=7), timedelta(hours=12)),
    ],
)
def test_interval_follows_level_and_proximity(
    seats_left, seats_capacity, starts_in, expected
) -> None:
    showtime = _showtime(
        starts_in=starts_in, seats_left=seats_left, seats_capacity=seats_capacity
    )
    assert _delay(showtime).total_seconds() == pytest.approx(
        expected.total_seconds(), abs=_RECHECK_JITTER.total_seconds() / 2
    )


def _sold_out(starts_in: timedelta, *, now: datetime = NOW) -> Showtime:
    showtime = _showtime(starts_in=starts_in, seats_left=0, seats_capacity=100)
    showtime.datetime = now + starts_in
    return showtime


def test_sold_out_far_off_is_read_hourly() -> None:
    """A thin watch for returned tickets, not the ordinary cadence."""
    showtime = _sold_out(timedelta(days=7))
    delay = next_check_at(showtime=showtime, now=NOW, unchanged_streak=0) - NOW
    assert SOLD_OUT_RECHECK_INTERVAL <= delay <= SOLD_OUT_RECHECK_INTERVAL + _RECHECK_JITTER


def test_sold_out_hourly_reads_skip_the_night() -> None:
    late = datetime(2026, 8, 24, 23, 30)
    showtime = _sold_out(timedelta(days=3), now=late)
    assert next_check_at(
        showtime=showtime, now=late, unchanged_streak=0
    ) == datetime(2026, 8, 25, 8, 0)


def test_sold_out_hourly_read_never_overshoots_the_final_approach() -> None:
    showtime = _sold_out(timedelta(hours=2, minutes=30))
    assert next_check_at(
        showtime=showtime, now=NOW, unchanged_streak=0
    ) == showtime.datetime - SOLD_OUT_FINAL_APPROACH


def test_sold_out_final_approach_reads_every_ten_minutes() -> None:
    showtime = _sold_out(timedelta(hours=1, minutes=30))
    assert next_check_at(
        showtime=showtime, now=NOW, unchanged_streak=0
    ) == NOW + SOLD_OUT_FINAL_APPROACH_INTERVAL


def test_sold_out_final_approach_ends_on_the_last_check() -> None:
    showtime = _sold_out(timedelta(minutes=25))
    assert next_check_at(
        showtime=showtime, now=NOW, unchanged_streak=0
    ) == showtime.datetime - SOLD_OUT_LAST_CHECK_BEFORE


def test_sold_out_is_parked_after_the_last_check() -> None:
    """Twenty minutes out nobody can still buy a ticket and get there. Parked at
    the screening's own start time, which the candidate query can never take —
    it only accepts screenings that have not started yet."""
    showtime = _sold_out(timedelta(minutes=20))
    assert (
        next_check_at(showtime=showtime, now=NOW, unchanged_streak=0)
        == showtime.datetime
    )


def test_a_sold_out_screening_with_tickets_back_returns_to_a_real_cadence() -> None:
    """The parking is a consequence of the level, not a state of its own."""
    showtime = _showtime(
        starts_in=timedelta(days=7), seats_left=0, seats_capacity=100
    )
    apply_reading(
        showtime=showtime,
        availability=SeatAvailability(4, False, "LAB 1", "z-elite"),
        now=NOW,
    )
    assert showtime.seats_next_check_at is not None
    assert showtime.seats_next_check_at < NOW + timedelta(minutes=20)


def test_unchanged_readings_back_the_interval_off_up_to_a_cap() -> None:
    showtime = _showtime(
        starts_in=timedelta(days=7), seats_left=50, seats_capacity=100
    )
    one_hour = timedelta(hours=1).total_seconds()
    jitter = _RECHECK_JITTER.total_seconds() / 2

    assert _delay(showtime, unchanged_streak=2).total_seconds() == pytest.approx(
        3 * one_hour, abs=jitter
    )
    assert _delay(showtime, unchanged_streak=50).total_seconds() == pytest.approx(
        UNCHANGED_BACKOFF_CAP * one_hour, abs=jitter
    )


def test_backoff_never_applies_close_to_the_showtime() -> None:
    """Near the screening a quiet hour means nothing — freshness is the point."""
    showtime = _showtime(
        starts_in=timedelta(hours=1), seats_left=50, seats_capacity=100
    )
    assert _delay(showtime, unchanged_streak=50).total_seconds() == pytest.approx(
        timedelta(minutes=30).total_seconds(), abs=_RECHECK_JITTER.total_seconds() / 2
    )


def test_applying_a_reading_tracks_the_unchanged_streak() -> None:
    showtime = _showtime(starts_in=timedelta(days=7))
    reading = SeatAvailability(40, False, "LAB 1", "z-elite")

    apply_reading(showtime=showtime, availability=reading, now=NOW)
    assert showtime.seats_unchanged_streak == 0
    apply_reading(showtime=showtime, availability=reading, now=NOW)
    assert showtime.seats_unchanged_streak == 1
    apply_reading(
        showtime=showtime,
        availability=SeatAvailability(39, False, "LAB 1", "z-elite"),
        now=NOW,
    )
    assert showtime.seats_unchanged_streak == 0
    assert showtime.seats_checked_at == NOW
    assert showtime.seats_next_check_at is not None


def test_batch_is_capped_per_host_so_one_shop_cannot_take_the_whole_run() -> None:
    candidates = [
        _showtime(
            starts_in=timedelta(days=1),
            showtime_id=index,
            ticket_link=f"https://tickets.lab111.nl/order/{index}",
        )
        for index in range(POLL_HOST_BATCH_LIMIT * 3)
    ]
    by_host = _select_batch(candidates)
    assert sum(len(group) for group in by_host.values()) == POLL_HOST_BATCH_LIMIT


def test_a_flood_of_due_showtimes_is_queued_rather_than_requested_at_once() -> None:
    """What someone marking a hundred showtimes interested actually costs."""
    candidates = [
        _showtime(
            starts_in=timedelta(days=1),
            showtime_id=index,
            ticket_link=f"https://tickets{index}.example.com/order/{index}",
        )
        for index in range(POLL_BATCH_LIMIT * 4)
    ]
    by_host = _select_batch(candidates)
    assert sum(len(group) for group in by_host.values()) == POLL_BATCH_LIMIT
    # Everything left over keeps its due time and comes up again next run.
    taken = {showtime.id for group in by_host.values() for showtime in group}
    assert len(taken) < len(candidates)
