"""One-off ingest: store each covered room's seat floor plan.

Five ticketing platforms hand back seat geometry rather than only a count —
Eagerly, Tricket, Ticketlab, ActiveTickets and Ticketmatic — and each has its
own section below.

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
outbound requests to five ticketing platforms' sites, so each cinema skips
itself (a single cheap DB count) once it has something stored for it,
rather than re-scraping on every deploy. That skip is what makes "run once"
true across environments without a manual step: the first deploy after a
cinema is added (dev, then later prod) does its real ingest, and every
deploy after that is a no-op for it. The guard is drawn per *cinema*, not
per platform or per table: a whole-table count meant every platform added
after the first never ran at all anywhere the Eagerly ingest had already
been (what left every Ticketlab cinema without a floor plan), and a
platform-wide count has the same problem one level down — it left a new or
renamed room permanently unignested at any cinema whose *platform* already
had a plan somewhere else (e.g. Trianon, on Eagerly once Filmhallen already
had one). A cinema that genuinely sells every room free-seating never
yields a real plan, so `_mark_no_floor_plan` records a sentinel row for it
once its candidates are exhausted — that is what keeps the per-cinema guard
from re-scraping it on every deploy forever. Pass `--force` to re-ingest
anyway, e.g. after a covered cinema renovates a room:

    python scripts/ingest-seat-floor-plans.py [--force]
"""

import argparse
import time
from collections.abc import Callable
from typing import NamedTuple

from sqlmodel import Session, col, func, select

from app.api.deps import get_db_context
from app.core.enums import ScreenSide
from app.crud import cinema as cinema_crud
from app.models.cinema_room_floor_plan import CinemaRoomFloorPlan
from app.models.showtime import Showtime
from app.scraping.seat_availability import (
    ACTIVETICKETS_HOSTS,
    EAGERLY_BOOKING_HOSTS,
    EAGERLY_BOOKING_HOSTS_BY_CINEMA,
    TICKETLAB_HOSTS,
    TICKETMATIC_HOSTS,
    TRICKET_ROOM_NAMES,
    TRICKET_SEAT_MAP_HOSTS,
    TRICKET_URL_PATTERN,
    EagerlyFeedCache,
    fetch_activetickets_room_geometry,
    fetch_eagerly_room_geometry,
    fetch_ticketlab_room_geometry,
    fetch_ticketmatic_room_geometry,
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
    room_key: str,
    room_name: str | None,
    seats: list[dict],
    screen_side: ScreenSide,
) -> None:
    existing = session.get(CinemaRoomFloorPlan, (cinema_id, room_key))
    if existing is None:
        session.add(
            CinemaRoomFloorPlan(
                cinema_id=cinema_id,
                room_key=room_key,
                room_name=room_name,
                seats=seats,
                screen_side=screen_side,
            )
        )
        return
    existing.room_name = room_name
    existing.seats = seats
    existing.screen_side = screen_side
    session.add(existing)


def _screen_side(
    *, cinema_key: str, room: str | None, reported: ScreenSide | None
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


def _cinema_done(*, session: Session, cinema_id: int) -> bool:
    """Whether this cinema already has something stored — a real plan, or the
    `_mark_no_floor_plan` sentinel recording that it was tried and has none.
    """
    return (
        session.exec(
            select(func.count())
            .select_from(CinemaRoomFloorPlan)
            .where(col(CinemaRoomFloorPlan.cinema_id) == cinema_id)
        ).one()
        > 0
    )


_NO_FLOOR_PLAN_ROOM_KEY = "__no_floor_plan__"


def _mark_no_floor_plan(*, session: Session, cinema_id: int) -> None:
    """Record that this cinema was checked and has no seated room to plan.

    No real room can ever be keyed this way — every platform keys or names
    its rooms from the booking site itself — so `get_seat_floor_plan` never
    matches this for an actual showtime. It exists only to make
    `_cinema_done` true, so a cinema that sells every room free-seating
    isn't re-scraped on every deploy forever.
    """
    _upsert_floor_plan(
        session=session,
        cinema_id=cinema_id,
        room_key=_NO_FLOOR_PLAN_ROOM_KEY,
        room_name=None,
        seats=[],
        screen_side=ScreenSide.TOP,
    )


def _ingest_eagerly_floor_plans(*, skipped: list[str], force: bool = False) -> int:
    """Eagerly rooms, walked from each site's agenda feed."""
    feed_cache: EagerlyFeedCache = {}
    ingested = 0

    for target in _targets():
        cinema_key = target.cinema_key
        with get_db_context() as session:
            cinema_id = cinema_crud.get_cinema_id_by_key(
                session=session, key=cinema_key
            )
            if not force and _cinema_done(session=session, cinema_id=cinema_id):
                skipped.append(f"{cinema_key} (already ingested)")
                continue

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
            with get_db_context() as session:
                _mark_no_floor_plan(session=session, cinema_id=cinema_id)
                session.commit()
            skipped.append(f"{cinema_key} (no rooms found in agenda feed)")
            continue

        cinema_ingested = 0
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
                    # Eagerly names every room, so the name is both the key
                    # and the label — as it is for every platform but
                    # Ticketlab.
                    room_key=room,
                    room_name=room,
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
            cinema_ingested += 1

        if cinema_ingested == 0:
            with get_db_context() as session:
                _mark_no_floor_plan(session=session, cinema_id=cinema_id)
                session.commit()

    return ingested


class _Platform(NamedTuple):
    """One ticketing platform's ingest function."""

    name: str
    ingest: Callable[..., int]


def _platforms() -> list[_Platform]:
    return [
        _Platform("eagerly", _ingest_eagerly_floor_plans),
        _Platform("tricket", _ingest_tricket_floor_plans),
        _Platform("ticketlab", _ingest_ticketlab_floor_plans),
        _Platform("activetickets", _ingest_activetickets_floor_plans),
        _Platform("ticketmatic", _ingest_ticketmatic_floor_plans),
    ]


def ingest_floor_plans(*, force: bool = False) -> None:
    ingested = 0
    skipped: list[str] = []

    # The guard lives inside each platform's ingest function, per cinema —
    # see `_cinema_done` — so every platform is called every run, and a
    # cinema already done (or already known to have no seated room) is a
    # single cheap DB count rather than a real re-scrape.
    for platform in _platforms():
        ingested += platform.ingest(skipped=skipped, force=force)

    print(f"Done. Ingested {ingested} rooms, skipped {len(skipped)}: {skipped}")


# Cinecenter's shop, and only its shop: see TRICKET_SEAT_MAP_HOSTS for why
# Studio/K's map is not a real seating plan.
_TRICKET_HOST_TO_CINEMA_KEY = {"kassa.cinecenter.nl": "cinecenter"}


def _ingest_tricket_floor_plans(*, skipped: list[str], force: bool = False) -> int:
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
            cinema_id = cinema_crud.get_cinema_id_by_key(
                session=session, key=cinema_key
            )
            if not force and _cinema_done(session=session, cinema_id=cinema_id):
                skipped.append(f"{cinema_key} (already ingested)")
                continue
            screening_ids = _tricket_screening_ids(session=session, host=host)

        done: set[str] = set()
        for screening_id in screening_ids:
            if len(done) == len(TRICKET_ROOM_NAMES):
                break
            geometry = fetch_tricket_room_geometry(host=host, screening_id=screening_id)
            time.sleep(REQUEST_DELAY_SECONDS)
            if geometry is None or geometry.room is None or geometry.room in done:
                continue
            done.add(geometry.room)
            with get_db_context() as session:
                _upsert_floor_plan(
                    session=session,
                    cinema_id=cinema_id,
                    room_key=geometry.room,
                    room_name=geometry.room,
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
        if not done:
            with get_db_context() as session:
                _mark_no_floor_plan(session=session, cinema_id=cinema_id)
                session.commit()
    return ingested


# Ticketlab host (TICKETLAB_HOSTS' entries) -> cinemas.yaml key. Hand-mapped
# once, the same way the Eagerly table above is: the ticket subdomain isn't
# derivable from the cinema's own key or website domain in every case (Luxor
# Zutphen's shop is at luxorzutphen.nl, its cinemas.yaml entry at
# luxortheater.nl).
_TICKETLAB_HOST_TO_CINEMA_KEY = {
    "tickets.artishocksoest.nl": "artishock",
    "tickets.cacaofabriek.nl": "de-cacaofabriek",
    "tickets.cinemamiddelburg.nl": "cinema-middelburg",
    "tickets.cinemaoostereiland.nl": "cinema-oostereiland",
    "tickets.drom.nl": "de-drom",
    "tickets.filmhuisbussum.nl": "filmhuis-bussum",
    "tickets.filmhuiszevenaar.nl": "filmhuis-zevenaar",
    "tickets.filmtheaterfraterhuis.nl": "fraterhuis",
    "tickets.filmtheatervoorschoten.nl": "filmtheater-voorschoten",
    "tickets.fizi.nl": "fizi",
    "tickets.florafilmtheater.nl": "flora",
    "tickets.focusarnhem.nl": "focus-filmtheater",
    "tickets.luxorzutphen.nl": "luxor-theater",
    "tickets.wennekercinema.nl": "wenneker-cinema",
}

# How many of a cinema's upcoming showtimes to try before giving up on finding
# every room. Ticketlab names the room on every page, so a room is done the
# first time it's seen — this only needs to be large enough to cycle through
# a small arthouse cinema's handful of rooms, not every showtime it has.
MAX_TICKETLAB_CANDIDATES_PER_CINEMA = 30


def _ingest_ticketlab_floor_plans(*, skipped: list[str], force: bool = False) -> int:
    """Ticketlab rooms, whose geometry, name and screen side all come off the
    same checkout page the poller already reads for the seat count.

    Like Tricket there is no programme feed to walk, so the showtimes already
    in the database supply the candidate links. Rooms are told apart by the
    page's `locationid` rather than by name — most of these shops print no
    room name anywhere, so the name is stored when there is one and left null
    when there is not, and neither case changes which room a plan is filed
    under.
    """
    ingested = 0
    for host in TICKETLAB_HOSTS:
        cinema_key = _TICKETLAB_HOST_TO_CINEMA_KEY.get(host)
        if cinema_key is None:
            skipped.append(f"{host} (no cinemas.yaml key mapped)")
            continue
        with get_db_context() as session:
            cinema_id = cinema_crud.get_cinema_id_by_key(
                session=session, key=cinema_key
            )
            if not force and _cinema_done(session=session, cinema_id=cinema_id):
                skipped.append(f"{cinema_key} (already ingested)")
                continue
            links = _ticket_links_for_host(session=session, host=host)

        done: set[str] = set()
        for link in links[:MAX_TICKETLAB_CANDIDATES_PER_CINEMA]:
            geometry = fetch_ticketlab_room_geometry(link)
            time.sleep(REQUEST_DELAY_SECONDS)
            if geometry is None or geometry.room_key in done:
                continue
            done.add(geometry.room_key)
            with get_db_context() as session:
                _upsert_floor_plan(
                    session=session,
                    cinema_id=cinema_id,
                    room_key=geometry.room_key,
                    room_name=geometry.room,
                    seats=geometry.seats,
                    # The screen-side override is keyed by the room's *name*,
                    # so it can only ever apply to the three shops that print
                    # one; elsewhere Ticketlab's own `seating_upside_down` is
                    # the only answer there is.
                    screen_side=_screen_side(
                        cinema_key=cinema_key,
                        room=geometry.room,
                        reported=ScreenSide(geometry.screen_side),
                    ),
                )
                session.commit()
            print(
                f"{cinema_key}/{geometry.room or geometry.room_key}: "
                f"{len(geometry.seats)} seats, screen at {geometry.screen_side}"
            )
            ingested += 1

        if not done:
            skipped.append(f"{cinema_key} (no seated showtime yielded a plan)")
            with get_db_context() as session:
                _mark_no_floor_plan(session=session, cinema_id=cinema_id)
                session.commit()
    return ingested


# ActiveTickets host (ACTIVETICKETS_HOSTS' entries) -> cinemas.yaml key.
# Hand-mapped once, the same way the Ticketlab table above is. Four of these
# nine sell every room free-seating (Rialto De Pijp, De Balie, Cinebergen,
# Slieker) and so will never yield a plan — that is expected, not an error,
# and shows up as a normal "no seated showtime" skip below.
_ACTIVETICKETS_HOST_TO_CINEMA_KEY = {
    "activetickets.filmhuisdenhaag.nl": "filmhuis-den-haag",
    "tickets-depijp.rialtofilm.nl": "rialto-de-pijp",
    "tickets.cinebergen.nl": "cinebergen",
    "tickets.debalie.nl": "de-balie",
    "tickets.filmhuis-lumen.nl": "lumen",
    "tickets.filmhuisalkmaar.nl": "filmhuis-alkmaar",
    "tickets.filmtheaterhilversum.nl": "filmtheater-hilversum",
    "tickets.sliekerfilm.nl": "slieker",
    "webshop.lux-nijmegen.nl": "lux",
}

MAX_ACTIVETICKETS_CANDIDATES_PER_CINEMA = 30


def _ingest_activetickets_floor_plans(
    *, skipped: list[str], force: bool = False
) -> int:
    """ActiveTickets rooms, whose geometry, name and screen side (via the
    override/default) all come off the same show page the poller already reads
    for the seat count.

    Like Ticketlab there is no programme feed to walk, so the showtimes
    already in the database supply the candidate links, and a room's name is
    right there on the page.
    """
    ingested = 0
    for host in ACTIVETICKETS_HOSTS:
        cinema_key = _ACTIVETICKETS_HOST_TO_CINEMA_KEY.get(host)
        if cinema_key is None:
            skipped.append(f"{host} (no cinemas.yaml key mapped)")
            continue
        with get_db_context() as session:
            cinema_id = cinema_crud.get_cinema_id_by_key(
                session=session, key=cinema_key
            )
            if not force and _cinema_done(session=session, cinema_id=cinema_id):
                skipped.append(f"{cinema_key} (already ingested)")
                continue
            links = _ticket_links_for_host(session=session, host=host)

        done: set[str] = set()
        for link in links[:MAX_ACTIVETICKETS_CANDIDATES_PER_CINEMA]:
            geometry = fetch_activetickets_room_geometry(link)
            time.sleep(REQUEST_DELAY_SECONDS)
            if geometry is None or geometry.room is None or geometry.room in done:
                continue
            done.add(geometry.room)
            with get_db_context() as session:
                _upsert_floor_plan(
                    session=session,
                    cinema_id=cinema_id,
                    room_key=geometry.room,
                    room_name=geometry.room,
                    seats=geometry.seats,
                    # ActiveTickets' seat plan carries no screen marker at
                    # all, so this is the override or the default, never the
                    # platform.
                    screen_side=_screen_side(
                        cinema_key=cinema_key, room=geometry.room, reported=None
                    ),
                )
                session.commit()
            print(f"{cinema_key}/{geometry.room}: {len(geometry.seats)} seats")
            ingested += 1

        if not done:
            skipped.append(f"{cinema_key} (no seated showtime yielded a plan)")
            with get_db_context() as session:
                _mark_no_floor_plan(session=session, cinema_id=cinema_id)
                session.commit()
    return ingested


# Ticketmatic host (TICKETMATIC_HOSTS' entries) -> cinemas.yaml key.
_TICKETMATIC_HOST_TO_CINEMA_KEY = {
    "kaartverkoop.lievevrouw.nl": "de-lieve-vrouw",
    "ticketing.lumiere.nl": "lumiere-cinema",
    "tickets.concordia.nl": "concordia",
    "tickets.forum.nl": "forum",
    "tickets.gigant.nl": "gigant",
    "tickets.mimik.nl": "mimik",
    "tickets.schuur.nl": "schuur",
}

MAX_TICKETMATIC_CANDIDATES_PER_CINEMA = 30


def _ingest_ticketmatic_floor_plans(*, skipped: list[str], force: bool = False) -> int:
    """Ticketmatic rooms, whose geometry, name and screen side (via the
    override/default) all come off the same performance page the poller
    already reads for the seat count. General-admission rooms never yield a
    plan — that is expected, not an error.
    """
    ingested = 0
    for host in TICKETMATIC_HOSTS:
        cinema_key = _TICKETMATIC_HOST_TO_CINEMA_KEY.get(host)
        if cinema_key is None:
            skipped.append(f"{host} (no cinemas.yaml key mapped)")
            continue
        with get_db_context() as session:
            cinema_id = cinema_crud.get_cinema_id_by_key(
                session=session, key=cinema_key
            )
            if not force and _cinema_done(session=session, cinema_id=cinema_id):
                skipped.append(f"{cinema_key} (already ingested)")
                continue
            links = _ticket_links_for_host(session=session, host=host)

        done: set[str] = set()
        for link in links[:MAX_TICKETMATIC_CANDIDATES_PER_CINEMA]:
            geometry = fetch_ticketmatic_room_geometry(link)
            time.sleep(REQUEST_DELAY_SECONDS)
            if geometry is None or geometry.room is None or geometry.room in done:
                continue
            done.add(geometry.room)
            with get_db_context() as session:
                _upsert_floor_plan(
                    session=session,
                    cinema_id=cinema_id,
                    room_key=geometry.room,
                    room_name=geometry.room,
                    seats=geometry.seats,
                    screen_side=_screen_side(
                        cinema_key=cinema_key, room=geometry.room, reported=None
                    ),
                )
                session.commit()
            print(f"{cinema_key}/{geometry.room}: {len(geometry.seats)} seats")
            ingested += 1

        if not done:
            skipped.append(f"{cinema_key} (no seated showtime yielded a plan)")
            with get_db_context() as session:
                _mark_no_floor_plan(session=session, cinema_id=cinema_id)
                session.commit()
    return ingested


def _ticket_links_for_host(*, session: Session, host: str) -> list[str]:
    """Upcoming ticket links for this shop, from the showtimes already stored."""
    return list(
        session.exec(
            select(Showtime.ticket_link)
            .where(
                col(Showtime.ticket_link).is_not(None),
                col(Showtime.ticket_link).contains(host),
                col(Showtime.datetime) > now_amsterdam_naive(),
            )
            .order_by(col(Showtime.datetime))
        ).all()
    )


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
        help="Re-ingest even for cinemas whose plans are already stored.",
    )
    args = parser.parse_args()
    ingest_floor_plans(force=args.force)
