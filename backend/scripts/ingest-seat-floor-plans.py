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
import time
from typing import NamedTuple

from sqlmodel import Session, col, func, select

from app.api.deps import get_db_context
from app.core.enums import ScreenSide
from app.crud import cinema as cinema_crud
from app.models.cinema_room_floor_plan import CinemaRoomFloorPlan
from app.models.showtime import Showtime
from app.scraping.seat_availability import (
    EAGERLY_BOOKING_HOSTS,
    EAGERLY_BOOKING_HOSTS_BY_CINEMA,
    TRICKET_ROOM_NAMES,
    TRICKET_SEAT_MAP_HOSTS,
    TRICKET_URL_PATTERN,
    EagerlyFeedCache,
    fetch_eagerly_room_geometry,
    fetch_tricket_room_geometry,
)
from app.scraping.seat_availability import eagerly_shows as fetch_eagerly_shows
from app.services.seat_availability import screen_side_override
from app.utils import now_amsterdam_naive

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
    *,
    session: Session,
    cinema_id: int,
    room: str,
    seats: list[dict],
    screen_side: ScreenSide,
) -> None:
    existing = session.get(CinemaRoomFloorPlan, (cinema_id, room))
    if existing is None:
        session.add(
            CinemaRoomFloorPlan(
                cinema_id=cinema_id, room=room, seats=seats, screen_side=screen_side
            )
        )
        return
    existing.seats = seats
    existing.screen_side = screen_side
    session.add(existing)


def _screen_side(
    *, cinema_key: str, room: str, reported: ScreenSide | None
) -> ScreenSide:
    """Which end this room's screen is at.

    A hand-entered override wins over everything: it is the only source for the
    platforms that never say, and it is also the escape hatch if a platform
    that does say turns out to be wrong about a room. Otherwise the platform's
    own answer, and failing that `top` — which is what every room stored before
    this existed already renders as.
    """
    override = screen_side_override(cinema_key=cinema_key, room=room)
    if override is not None:
        return override
    return reported or ScreenSide.TOP


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
                    session=session,
                    cinema_id=cinema_id,
                    room=room,
                    seats=seats,
                    # Eagerly's seat plan carries no screen marker at all, so
                    # this is the override or the default, never the platform.
                    screen_side=_screen_side(
                        cinema_key=cinema_key, room=room, reported=None
                    ),
                )
                session.commit()

            selectable = sum(1 for seat in seats if seat["selectable"])
            print(
                f"{cinema_key}/{room}: {len(seats)} entries, "
                f"{selectable} selectable seats"
            )
            ingested += 1

    ingested += _ingest_tricket_floor_plans(skipped=skipped)

    print(f"Done. Ingested {ingested} rooms, skipped {len(skipped)}: {skipped}")


# Cinecenter's shop, and only its shop: see TRICKET_SEAT_MAP_HOSTS for why
# Studio/K's map is not a real seating plan.
_TRICKET_HOST_TO_CINEMA_KEY = {"kassa.cinecenter.nl": "cinecenter"}


def _ingest_tricket_floor_plans(*, skipped: list[str]) -> int:
    """Tricket rooms, whose geometry and screen side come off the seat map.

    Unlike Eagerly there is no programme feed to walk: the shop only answers
    per screening, so the showtimes already in the database are what supply the
    ids. A room is done as soon as one of its screenings has yielded a plan —
    they are all the same room.
    """
    ingested = 0
    for host in TRICKET_SEAT_MAP_HOSTS:
        cinema_key = _TRICKET_HOST_TO_CINEMA_KEY.get(host)
        if cinema_key is None:
            skipped.append(f"{host} (no cinemas.yaml key mapped)")
            continue
        with get_db_context() as session:
            cinema_id = cinema_crud.get_cinema_id_by_key(session=session, key=cinema_key)
            screening_ids = _tricket_screening_ids(session=session, host=host)

        done: set[str] = set()
        for screening_id in screening_ids:
            if len(done) == len(TRICKET_ROOM_NAMES):
                break
            geometry = fetch_tricket_room_geometry(
                host=host, screening_id=screening_id
            )
            time.sleep(REQUEST_DELAY_SECONDS)
            if geometry is None or geometry.room is None or geometry.room in done:
                continue
            done.add(geometry.room)
            with get_db_context() as session:
                _upsert_floor_plan(
                    session=session,
                    cinema_id=cinema_id,
                    room=geometry.room,
                    seats=geometry.seats,
                    screen_side=_screen_side(
                        cinema_key=cinema_key,
                        room=geometry.room,
                        reported=ScreenSide(geometry.screen_side),
                    ),
                )
                session.commit()
            print(
                f"{cinema_key}/{geometry.room}: {len(geometry.seats)} seats, "
                f"screen at {geometry.screen_side}"
            )
            ingested += 1

        missing = set(TRICKET_ROOM_NAMES.values()) - done
        if missing:
            skipped.append(f"{cinema_key} (no upcoming screening in {sorted(missing)})")
    return ingested


def _tricket_screening_ids(*, session: Session, host: str) -> list[str]:
    """Screening ids for this shop, from the ticket links already stored."""
    links = session.exec(
        select(Showtime.ticket_link)
        .where(
            col(Showtime.ticket_link).is_not(None),
            col(Showtime.ticket_link).contains(host),
            col(Showtime.datetime) > now_amsterdam_naive(),
        )
        .order_by(col(Showtime.datetime))
    ).all()
    ids = []
    for link in links:
        match = TRICKET_URL_PATTERN.match(link or "")
        if match is not None:
            ids.append(match.group(1))
    return ids


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-ingest even if cinemaroomfloorplan already has rows.",
    )
    args = parser.parse_args()
    ingest_floor_plans(force=args.force)
