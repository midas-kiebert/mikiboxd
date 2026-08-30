"""One-off ingest: store each Eagerly-platform room's seat floor plan.

Filmhallen, The Movies, Kino, Filmkoepel, Louis Hartlooper, Slachtstraat and
Springhaver all run "My Cloud Cinema" booking apps whose `getSeatPlanData`
endpoint hands back full seat geometry, not just a free/capacity count. A
room's layout essentially never changes, so this reads it once per known room
and stores it in `cinemaroomfloorplan` rather than being scraped on a
schedule.

Which room a plan belongs to is the one thing here that can silently go wrong:
the room name comes from the site's agenda feed and the geometry from its
booking system, and for an individual show those two can disagree (a screening
moved between rooms in one system and not the other). A plan is therefore only
stored once its own `screen_name` agrees with the feed's room, walking further
into that room's showtimes when it doesn't.

Run unconditionally from `scripts/prestart.sh` on every deploy, same as
`seed-cities-and-cinemas.py` — but unlike that script this one does real
outbound requests to 7 external booking sites, so it skips entirely (a single
cheap DB count) whenever the table already has rows, rather than re-scraping
on every deploy. That skip is what makes "run once" true across environments
without a manual step: the first deploy after the migration (dev, then later
prod) does the real ingest, and every deploy after that is a no-op. Pass
`--force` to re-ingest anyway, e.g. after a covered cinema renovates a room:

    python scripts/ingest-seat-floor-plans.py [--force]
"""

import argparse
from typing import NamedTuple

from sqlmodel import Session, func, select

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.cinema_room_floor_plan import CinemaRoomFloorPlan
from app.scraping.seat_availability import (
    EAGERLY_BOOKING_HOSTS,
    EAGERLY_BOOKING_HOSTS_BY_CINEMA,
    EagerlyFeedCache,
    fetch_eagerly_room_geometry,
)
from app.scraping.seat_availability import eagerly_shows as fetch_eagerly_shows

REQUEST_DELAY_SECONDS = 0.2

# Eagerly site host (EAGERLY_BOOKING_HOSTS' key, so no `www.`) -> cinemas.yaml key.
_NETLOC_TO_CINEMA_KEY = {
    "filmhallen.nl": "filmhallen",
    "themovies.nl": "the-movies",
    "kinorotterdam.nl": "kino",
    "filmkoepel.nl": "filmkoepel",
    "hartlooper.nl": "louis-hartlooper-complex",
    "slachtstraat.nl": "slachtstraat",
    "springhaver.nl": "springhaver",
}

# ...and the same for the one site that serves several cinemas, where the
# agenda feed's own `cinema_id` is the only thing separating them. Keyed the
# way EAGERLY_BOOKING_HOSTS_BY_CINEMA is.
_SITE_CINEMA_TO_CINEMA_KEY = {
    ("bioscopenleiden.nl", "4"): "trianon",
    ("bioscopenleiden.nl", "5"): "kijkhuis",
    ("bioscopenleiden.nl", "6"): "lido",
}


class _Target(NamedTuple):
    """One cinema's floor plans: where to read the programme, where to read the
    seat plans, and which of the feed's cinemas is ours."""

    site: str
    booking_host: str
    cinema_key: str
    # None for a site whose whole feed is the one cinema, which is all of them
    # except Bioscopen Leiden.
    cinema_id: str | None


def _targets() -> list[_Target]:
    targets = [
        _Target(site, booking_host, _NETLOC_TO_CINEMA_KEY[site], None)
        for site, booking_host in EAGERLY_BOOKING_HOSTS.items()
        if site in _NETLOC_TO_CINEMA_KEY
    ]
    targets += [
        _Target(site, booking_host, _SITE_CINEMA_TO_CINEMA_KEY[key], cinema_id)
        for key, booking_host in EAGERLY_BOOKING_HOSTS_BY_CINEMA.items()
        if key in _SITE_CINEMA_TO_CINEMA_KEY
        for site, cinema_id in (key,)
    ]
    return targets


def _upsert_floor_plan(
    *, session: Session, cinema_id: int, room: str, seats: list[dict]
) -> None:
    existing = session.get(CinemaRoomFloorPlan, (cinema_id, room))
    if existing is None:
        session.add(CinemaRoomFloorPlan(cinema_id=cinema_id, room=room, seats=seats))
        return
    existing.seats = seats
    session.add(existing)


def _already_ingested(*, session: Session) -> bool:
    return session.exec(select(func.count()).select_from(CinemaRoomFloorPlan)).one() > 0


def ingest_floor_plans(*, force: bool = False) -> None:
    if not force:
        with get_db_context() as session:
            if _already_ingested(session=session):
                print("cinemaroomfloorplan already has rows, skipping (pass --force to re-ingest).")
                return

    feed_cache: EagerlyFeedCache = {}
    ingested = 0
    skipped: list[str] = []

    for target in _targets():
        cinema_key = target.cinema_key
        with get_db_context() as session:
            cinema_id = cinema_crud.get_cinema_id_by_key(session=session, key=cinema_key)

        shows = fetch_eagerly_shows(f"https://{target.site}", feed_cache)
        # Every showtime the feed puts in a room, not just the first: the
        # first one is only a candidate until its seat plan agrees it really
        # is in that room. On a shared site the feed carries all three
        # cinemas, so anything from another one is skipped here rather than
        # filed under this cinema's rooms.
        rooms: dict[str, list[tuple[str, str]]] = {}
        for provider_id, show in shows.items():
            if not show.location or not show.cinema_id:
                continue
            if target.cinema_id is not None and show.cinema_id != target.cinema_id:
                continue
            rooms.setdefault(show.location, []).append((provider_id, show.cinema_id))

        if not rooms:
            skipped.append(f"{cinema_key} (no rooms found in agenda feed)")
            continue

        for room, candidates in rooms.items():
            seats, reason = fetch_eagerly_room_geometry(
                booking_host=target.booking_host,
                room=room,
                candidates=candidates,
                request_delay_seconds=REQUEST_DELAY_SECONDS,
            )
            if seats is None:
                skipped.append(f"{cinema_key}/{room} ({reason})")
                continue

            with get_db_context() as session:
                _upsert_floor_plan(
                    session=session, cinema_id=cinema_id, room=room, seats=seats
                )
                session.commit()

            selectable = sum(1 for seat in seats if seat["selectable"])
            print(
                f"{cinema_key}/{room}: {len(seats)} entries, "
                f"{selectable} selectable seats"
            )
            ingested += 1

    print(f"Done. Ingested {ingested} rooms, skipped {len(skipped)}: {skipped}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-ingest even if cinemaroomfloorplan already has rows.",
    )
    args = parser.parse_args()
    ingest_floor_plans(force=args.force)
