"""Throwaway manual check: paste a ticket link, see what we'd read for it.

Usage:
    ./.venv/bin/python scratch_check_seats.py <ticket_link> [cinema_key]

`cinema_key` is optional and only affects the capacity line: pass it (the
same key as in seat_capacity_overrides.yaml, e.g. "lab111") to also check a
manual override for this showtime's room, the way the real poller would.
Without it, only a platform-reported exact capacity (currently just Eagerly)
shows up here — overrides never get checked, since this script has no
showtime/cinema in the database to resolve one from.
"""

import sys

from app.scraping.seat_availability import (
    SeatAvailabilityFetchError,
    fetch_seat_availability,
    supports,
)
from app.services.seat_availability import _capacity_override


def main() -> None:
    if len(sys.argv) not in (2, 3):
        print("usage: scratch_check_seats.py <ticket_link> [cinema_key]")
        raise SystemExit(1)
    ticket_link = sys.argv[1]
    cinema_key = sys.argv[2] if len(sys.argv) == 3 else None

    if not supports(ticket_link):
        print(f"No handler recognises this link: {ticket_link}")
        raise SystemExit(1)

    try:
        availability = fetch_seat_availability(ticket_link=ticket_link)
    except SeatAvailabilityFetchError as e:
        print(f"Fetch failed: {e}")
        raise SystemExit(1) from e

    print(f"platform:    {availability.platform}")
    print(f"room:        {availability.room}")
    print(f"seats_left:  {availability.seats_left}")
    print(f"sold_out:    {availability.sold_out}")

    if availability.capacity is not None:
        print(f"capacity:    {availability.capacity} (exact, from this platform's seat map)")
        return

    override = _capacity_override(cinema_key=cinema_key, room=availability.room)
    if override is not None:
        print(f"capacity:    {override} (manual override for {cinema_key}/{availability.room!r})")
    elif cinema_key is not None:
        print(
            f"capacity:    no override entered for {cinema_key}/{availability.room!r} "
            "in seat_capacity_overrides.yaml"
        )
    else:
        print("capacity:    unknown (this platform never returns a room total; pass a")
        print("             cinema_key as the 2nd argument to also check for an override)")


if __name__ == "__main__":
    main()
