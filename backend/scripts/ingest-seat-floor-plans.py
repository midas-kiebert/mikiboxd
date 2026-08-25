"""One-off ingest: store each Eagerly-platform room's seat floor plan.

Filmhallen, The Movies, Kino, Filmkoepel, Louis Hartlooper, Slachtstraat and
Springhaver all run "My Cloud Cinema" booking apps whose `getSeatPlanData`
endpoint hands back full seat geometry, not just a free/capacity count. A
room's layout essentially never changes, so this reads it once per known room
and stores it in `cinemaroomfloorplan` rather than being scraped on a
schedule. Run once after deploying the `cinemaroomfloorplan` migration, and
again by hand only if a covered cinema renovates a room:

    python scripts/ingest-seat-floor-plans.py
"""

import time

from sqlmodel import Session

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.cinema_room_floor_plan import CinemaRoomFloorPlan
from app.scraping.seat_availability import (
    EAGERLY_BOOKING_HOSTS,
    EagerlyFeedCache,
    fetch_eagerly_seatplan_geometry,
)
from app.scraping.seat_availability import eagerly_shows as fetch_eagerly_shows

REQUEST_DELAY_SECONDS = 0.2

# Eagerly's agenda-feed netloc (EAGERLY_BOOKING_HOSTS' key) -> cinemas.yaml key.
_NETLOC_TO_CINEMA_KEY = {
    "filmhallen.nl": "filmhallen",
    "themovies.nl": "the-movies",
    "www.kinorotterdam.nl": "kino",
    "www.filmkoepel.nl": "filmkoepel",
    "www.hartlooper.nl": "louis-hartlooper-complex",
    "www.slachtstraat.nl": "slachtstraat",
    "www.springhaver.nl": "springhaver",
}


def _upsert_floor_plan(
    *, session: Session, cinema_id: int, room: str, seats: list[dict]
) -> None:
    existing = session.get(CinemaRoomFloorPlan, (cinema_id, room))
    if existing is None:
        session.add(CinemaRoomFloorPlan(cinema_id=cinema_id, room=room, seats=seats))
        return
    existing.seats = seats
    session.add(existing)


def ingest_floor_plans() -> None:
    feed_cache: EagerlyFeedCache = {}
    ingested = 0
    skipped: list[str] = []

    for netloc, booking_host in EAGERLY_BOOKING_HOSTS.items():
        cinema_key = _NETLOC_TO_CINEMA_KEY.get(netloc)
        if cinema_key is None:
            skipped.append(f"{netloc} (no cinemas.yaml key mapped)")
            continue

        with get_db_context() as session:
            cinema_id = cinema_crud.get_cinema_id_by_key(session=session, key=cinema_key)

        shows = fetch_eagerly_shows(f"https://{netloc}", feed_cache)
        rooms: dict[str, tuple[str, str]] = {}  # room -> (provider_id, eagerly_cinema_id)
        for provider_id, show in shows.items():
            if show.location and show.cinema_id and show.location not in rooms:
                rooms[show.location] = (provider_id, show.cinema_id)

        if not rooms:
            skipped.append(f"{cinema_key} (no rooms found in agenda feed)")
            continue

        for room, (provider_id, eagerly_cinema_id) in rooms.items():
            seats = fetch_eagerly_seatplan_geometry(
                booking_host=booking_host,
                cinema_id=eagerly_cinema_id,
                show_time_id=provider_id,
            )
            time.sleep(REQUEST_DELAY_SECONDS)
            if not seats:
                skipped.append(f"{cinema_key}/{room} (empty seat plan)")
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
    ingest_floor_plans()
