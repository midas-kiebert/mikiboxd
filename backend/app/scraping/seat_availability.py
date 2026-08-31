"""How many seats are left for one showtime, read from its ticket link.

Five ticketing platforms, between them covering every cinema we run our own
scraper for and a good many we don't. Each answers an unauthenticated GET:

* **Z-ELITE / ZL8** (LAB111, De Uitkijk, Kriterion, FC Hyena, Eye) — the
  checkout page carries the remaining seat count in ``data-configured-max`` on
  its ticket-quantity ``<select>``. A page renders one ``<select>`` per badge
  type (Regulier / Cineville / promo) and some badge types are additionally
  capped per order (Eye caps two of its three at 2 and 10), so the *largest*
  value is the one that reflects the room; the smaller ones are order limits.
  A sold-out show renders no ``<select>`` at all, only a sold-out label.
* **Tricket** (Studio/K) — the screening resource itself carries a full
  seat map (``seats``, one entry per physical seat) alongside
  ``numberOfAvailableSeats``, so ``capacity`` is exact too (``len(seats)``).
  The room has no name anywhere in Tricket's API — only a ``hallId`` UUID,
  so a room is distinguished here only by that exact capacity, never a display
  name (Studio/K sells three: 74, 91 and 153 seats; Cinecenter four: 31, 72,
  75 and 76). Which individual seats are taken is *not* readable: the
  screening resource lists every seat in the room but carries no per-seat
  status, and ``/api/screenings/{id}/seats``, which does, requires a
  ``basketId`` — a write to their system that nothing here is willing to make
  several hundred times a day.
* **Eagerly** (Filmhallen, The Movies, Kino, Filmkoepel, Louis Hartlooper,
  Slachtstraat, Springhaver, and Bioscopen Leiden's Lido / Trianon / Kijkhuis)
  — each of these runs its own seat inventory on a "My Cloud Cinema" booking
  app, at its own subdomain (``book.`` for some, ``shop.`` for others, and
  Bioscopen Leiden one per cinema rather than one per site — none of it
  derivable from the site's own domain, hence the lookup tables below). Its ``getSeatPlanData`` endpoint answers with every
  physical seat's status, unauthenticated, and never needs a seat to be
  clicked (clicking one is what starts its 10-minute hold; reading the seat
  map never does). ``seats_left`` is how many are free. The site's own
  ``fk-feed/agenda`` feed — the scraper already reads it, one request covers
  a cinema's whole programme — supplies the ``cinema_id`` the seat-plan call
  needs and the room name; a site not yet in the lookup table falls back to
  the feed's coarser ``ticket_status`` (available / sold-out / no-websale),
  which never gives a count. The same seat map also says which individual
  seats are taken, at no extra cost — that is what backs the stored floor
  plan, so nothing has to re-read a ticket shop to draw a seat picker.

The Z-ELITE checkout page and the Eagerly feed also name the room the showtime
plays in, which not every cinema's scraper can see; it comes back on the same
reading rather than costing a second request.

* **ActiveTickets** (Rialto De Pijp, De Balie, Cinebergen, Slieker, Filmhuis
  Alkmaar, Filmhuis Den Haag, Filmtheater Hilversum, LUX, Lumen) — every show
  page inlines the shop's whole Knockout view-model as ``var jsonCart``, and
  what it contains depends on how the room is sold. A numbered room ships its
  entire seat plan (``EditData.Seats``: availability, blocked flag, x/y and the
  row/seat names), so the count, the room's real total and the taken map all
  come out of the page we already have to fetch — no second request. A
  free-seating room ships no seats at all and only says whether the screening
  is sold out. Both name the room.

* **Ticketlab** (Artishock Soest, Cacaofabriek, Cinema Middelburg, Cinema
  Oostereiland, Drom, Filmhuis Bussum, Filmhuis Zevenaar, Filmtheater
  Fraterhuis, Filmtheater Voorschoten, Fizi, Flora, Focus Arnhem, Luxor
  Zutphen, Wennekercinema) — a white-label shop at each cinema's own
  ``tickets.`` subdomain. A seated show's page inlines a Knockout-style
  ``util.seating.seats`` array — the full seat map, with an id, row/seat name,
  x/y position and a ``state`` code (available / in-cart / sold / blocked) per
  seat — so the count, the room's real total and the taken map all come off
  the checkout page itself, no second request. A free-seating show carries no
  seat map, only a running count in the ``availabletickets`` hidden input.
  Both name the room directly, next to the numeric id that keys it across
  shows — unlike Tricket's anonymous ``hallId`` this needs no hand-built
  lookup table.

Cineville's API has no availability field at all, but that is not the same as a
Cineville-only cinema being uncoverable: the ``ticketingUrl`` it hands out is
the cinema's own shop, so any cinema selling on one of the platforms above is
read whether or not we scrape it ourselves.

Nothing here touches the database. A transport failure raises
``SeatAvailabilityFetchError`` rather than returning zero: reporting a fetch
failure as "sold out" is the same class of bug as treating a rate-limited
scrape as "this showtime is gone".
"""

import json
import re
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import NamedTuple
from urllib.parse import urlsplit

import requests

from app.core.enums import ScreenSide
from app.scraping.logger import logger

REQUEST_TIMEOUT_SECONDS = 20

# Ticket shops serve the checkout page, not an API, and several of them 402/403
# the default python-requests User-Agent.
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
    ),
    "Accept-Language": "nl-NL,nl;q=0.9,en;q=0.8",
}


# `(row_name, seat_name)` for one physical seat, the key a floor plan's stored
# geometry is matched on.
TakenSeat = tuple[str, str]


class SeatAvailabilityFetchError(Exception):
    """Raised when a ticket shop could not be reached or returned nonsense."""


@dataclass(frozen=True)
class SeatAvailability:
    """One reading. ``None`` means "this platform did not say", never "zero"."""

    seats_left: int | None
    sold_out: bool | None
    room: str | None
    platform: str
    # The room's real total, when a platform hands back every seat rather
    # than just a remaining count (only Eagerly's seat map does). `None`
    # elsewhere doesn't mean "no seats" — the poller's running max
    # (`Showtime.seats_capacity`) is the fallback estimate for those.
    capacity: int | None = None
    # Which individual seats were taken at the moment of this reading, for the
    # platforms that hand back a per-seat map (only Eagerly). Follows the same
    # rule as the counts: `None` means "this platform did not say", never
    # "nothing is taken". Persisted alongside the count so the seat picker can
    # be served from the database — see `services/seat_floor_plan.py`.
    taken_seats: tuple[TakenSeat, ...] | None = None

    @property
    def is_known(self) -> bool:
        return self.seats_left is not None or self.sold_out is not None


_UNKNOWN = SeatAvailability(None, None, None, "unsupported")


class _EagerlyShow(NamedTuple):
    ticket_status: str
    location: str | None
    cinema_id: str | None


# A per-run cache of the Eagerly agenda feeds, keyed by site base URL. Passed in
# by the caller rather than held module-level so a long-lived process cannot
# serve a stale programme, and so tests can hand in their own.
EagerlyFeedCache = dict[str, dict[str, _EagerlyShow]]


def _get(url: str) -> requests.Response:
    try:
        response = requests.get(
            url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS
        )
        response.raise_for_status()
    except requests.RequestException as e:
        raise SeatAvailabilityFetchError(f"Could not fetch {url}: {e}") from e
    return response


def normalize_room(raw: str | None) -> str | None:
    """Collapse whitespace — Eye writes "Cinema  3" with a double space."""
    if raw is None:
        return None
    return re.sub(r"\s+", " ", raw).strip() or None


# --- Z-ELITE / ZL8 ----------------------------------------------------------

# Matches every tenant and flow config: LAB111 and Kriterion use `webshop`,
# FC Hyena `fchy_1s`, and Eye reaches the `order` step rather than `start`.
ZELITE_URL_PATTERN = re.compile(r"/flow_configs/[^/]+/steps/[^/]+/show/")
_ZELITE_QUANTITY_MAX = re.compile(r'data-configured-max="(\d+)"')
_ZELITE_SOLD_OUT_LABEL = re.compile(
    r'class="sold-out-label"[^>]*>\s*(?:</?br\s*/?>)*\s*SOLD OUT', re.IGNORECASE
)
# "vr 11 september 2026, 21:30 - LAB 1" / "Wed 26 August 2026, 20:15 - Cinema 1".
# Anchored on the start time so a room whose own name contains " - " survives.
_ZELITE_ROOM = re.compile(r"id='show-starts-at'>[^<]*?,\s*\d{1,2}:\d{2}\s*-\s*([^<]+)<")


def parse_zelite_room(html: str) -> str | None:
    """Read the room out of a Z-ELITE checkout page.

    Public because the Kriterion scraper needs it too: its own feed numbers the
    rooms without naming them, and this is the only place the names appear. A
    show that has already started renders an empty header and yields None.
    """
    match = _ZELITE_ROOM.search(html)
    return normalize_room(match.group(1) if match else None)


def _fetch_zelite(url: str, _feed_cache: EagerlyFeedCache) -> SeatAvailability:
    html = _get(url).text
    room = parse_zelite_room(html)

    quantity_maxima = [int(value) for value in _ZELITE_QUANTITY_MAX.findall(html)]
    if quantity_maxima:
        return SeatAvailability(max(quantity_maxima), False, room, "z-elite")
    if _ZELITE_SOLD_OUT_LABEL.search(html):
        return SeatAvailability(0, True, room, "z-elite")
    # No order form and no sold-out label: the show id no longer resolves (the
    # shop renders "Het evenement kon niet gevonden worden"), or sales have not
    # opened yet. Either way this is not evidence of a full house.
    return SeatAvailability(None, None, room, "z-elite")


# --- Tricket ----------------------------------------------------------------

TRICKET_URL_PATTERN = re.compile(r"^https://kassa\.[^/]+/#/checkout/([0-9a-f-]+)$")


def _fetch_tricket(url: str, _feed_cache: EagerlyFeedCache) -> SeatAvailability:
    match = TRICKET_URL_PATTERN.match(url)
    if match is None:
        return _UNKNOWN
    screening_id = match.group(1)
    host = urlsplit(url).netloc
    # The screening resource (not the bare `/availability` integer) also
    # carries the room's full seat map, so it gives an exact capacity too —
    # Tricket identifies the room only by `hallId`, a UUID with no name
    # anywhere in its API, but knowing the room's actual size (91 seats vs.
    # 153) matters more than knowing what it's called.
    body = _get(f"https://{host}/api/screenings/{screening_id}").text
    try:
        data = json.loads(body)
    except json.JSONDecodeError as e:
        raise SeatAvailabilityFetchError(
            f"Tricket screening {screening_id} was not JSON: {e}"
        ) from e
    if "redirectTo" in data:
        # The id no longer resolves to a real screening (merged, cancelled).
        # Not evidence of anything, least of all a full house.
        return SeatAvailability(None, None, None, "tricket")
    seats = data.get("seats")
    seats_left = data.get("numberOfAvailableSeats")
    if not isinstance(seats, dict) or not isinstance(seats_left, int):
        raise SeatAvailabilityFetchError(
            f"Tricket screening {screening_id} response was missing seat data"
        )
    return SeatAvailability(
        seats_left,
        seats_left == 0,
        TRICKET_ROOM_NAMES.get(str(data.get("hallId") or "")),
        "tricket",
        capacity=len(seats),
        taken_seats=(
            _fetch_tricket_taken_seats(
                host=host, screening_id=screening_id, seats=seats
            )
            if host in TRICKET_SEAT_MAP_HOSTS
            else None
        ),
    )


# --- Tricket seat maps ------------------------------------------------------
#
# Only for shops whose seat map means anything. Tricket hands one back for
# every screening, including rooms that are sold unreserved — Studio/K seats
# nobody where its map says, which is why `cinemas.yaml` has it as
# `seating: free`. A decorative map is worse than none: it would draw a picker
# showing seats to pick, mark "taken" ones nobody is sitting in, and let a
# viewer record a seat number that means nothing to the friend looking for
# them. The count and the room's size are still real for those shops and are
# read as before — this gates the seat *identities*, not the number.
TRICKET_SEAT_MAP_HOSTS = ("kassa.cinecenter.nl",)

# Tricket names a room only by `hallId`, a UUID that appears nowhere else in
# its API — but the cinema's own website embeds its programme with a
# `hallName` and the very same screening ids the checkout links use, so the
# two can be joined once by hand and written down. A stored floor plan is
# keyed by room name, so without this Cinecenter's geometry would have nothing
# to be filed under.
#
# Derived from cinecenter.nl on 2026-08-30 and checked against each hall's own
# seat list, which matched the site's stated capacity exactly. Hall ids are
# stable; a room that is renamed or rebuilt needs this re-derived, and an
# unknown hall simply reads as an unnamed room rather than failing.
TRICKET_ROOM_NAMES: dict[str, str] = {
    "b398f818-35a9-48be-b178-6e18c6c71d86": "Zaal 1",  # Cinecenter, 75 seats
    "60e22a40-8cd9-44fe-afe4-e8075c8b8526": "Zaal 2",  # Cinecenter, 76 seats
    "b94f5fae-52bd-4b7d-a2d5-b3c518b89d21": "Zaal 3",  # Cinecenter, 72 seats
    "f769b38a-9270-4ac9-9121-bfcb1c2215ac": "Zaal 4",  # Cinecenter, 31 seats
}

# Which seats are taken lives behind `?basketId=`, and a basket has to be a
# real one — a made-up or nil id 404s. Creating one is a bare `POST /api/basket`
# that returns an empty basket and holds nothing: seats are locked by a
# separate `/screening-seats/.../lock` call that nothing here ever makes, the
# same line the Eagerly seat map is read on.
#
# One basket per host is enough and is reused for every screening on it, so
# this leaves a single basket record on each shop rather than one per reading.
# It survives being idle, and a shop that has forgotten it answers 404, which
# is the signal to make another.
_tricket_baskets: dict[str, str] = {}
_tricket_basket_lock = threading.Lock()


def _tricket_basket_id(host: str, *, refresh: bool = False) -> str | None:
    with _tricket_basket_lock:
        if not refresh:
            existing = _tricket_baskets.get(host)
            if existing is not None:
                return existing
        try:
            response = requests.post(
                f"https://{host}/api/basket",
                headers=REQUEST_HEADERS,
                timeout=REQUEST_TIMEOUT_SECONDS,
            )
            response.raise_for_status()
            basket_id = response.json().get("id")
        except (requests.RequestException, ValueError) as e:
            # Not fatal: the count came from the screening resource and does
            # not need a basket. Only the seat map is lost.
            logger.warning(f"Could not open a Tricket basket at {host}: {e}")
            return None
        if not isinstance(basket_id, str) or not basket_id:
            return None
        _tricket_baskets[host] = basket_id
        return basket_id


def _fetch_tricket_taken_seats(
    *, host: str, screening_id: str, seats: dict
) -> tuple[TakenSeat, ...] | None:
    """Which of this screening's seats are spoken for, by row and seat name.

    None rather than an empty tuple when the shop would not say — "nothing is
    taken" and "we could not ask" have to stay distinguishable, or a failed
    read would wipe a stored seat map and show a full room as empty.
    """
    booked = _fetch_tricket_booked_seat_ids(host=host, screening_id=screening_id)
    if booked is None:
        return None
    taken = []
    for seat_id in booked:
        seat = seats.get(seat_id)
        if not isinstance(seat, dict):
            continue
        name = _tricket_seat_name(seat)
        if name is not None:
            taken.append(name)
    return tuple(taken)


def _fetch_tricket_booked_seat_ids(
    *, host: str, screening_id: str
) -> list[str] | None:
    """The `bookedSeats` id list, opening or renewing a basket as needed."""
    for refresh in (False, True):
        basket_id = _tricket_basket_id(host, refresh=refresh)
        if basket_id is None:
            return None
        url = (
            f"https://{host}/api/screenings/{screening_id}/seats"
            f"?basketId={basket_id}"
        )
        try:
            response = requests.get(
                url, headers=REQUEST_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS
            )
        except requests.RequestException as e:
            logger.warning(f"Tricket seat map for {screening_id} failed: {e}")
            return None
        if response.status_code == 404 and not refresh:
            # Either the basket has been forgotten or the screening is gone.
            # One retry with a fresh basket tells the two apart without
            # opening a basket on every reading.
            continue
        if not response.ok:
            return None
        try:
            body = response.json()
        except ValueError:
            return None
        booked = body.get("bookedSeats") if isinstance(body, dict) else None
        return booked if isinstance(booked, list) else None
    return None


# Every seat in the map is `<g id="{seatId}" class="seat"><svg x=".." y="..">`,
# and the screen is drawn by the map itself rather than left to the client —
# which is what makes Tricket the one platform that states which end it is at.
_TRICKET_SVG_SEAT = re.compile(
    r'<g\s+id="(?P<id>[0-9a-f-]{36})"\s+class="seat"\s*>\s*'
    r'<svg\s+x="(?P<x>-?\d+(?:\.\d+)?)"\s+y="(?P<y>-?\d+(?:\.\d+)?)"'
)
_TRICKET_SVG_SCREEN = re.compile(
    r'<svg\s+x="-?\d+(?:\.\d+)?"\s+y="(?P<y>-?\d+(?:\.\d+)?)"\s*>'
    r'(?:(?!</svg>).)*?id="screen-title"',
    re.S,
)
# The seat glyph the map re-uses for every seat: `<svg id="seat-rect"
# width="10" height="10">`. Read rather than assumed, since it is what the
# stored geometry's width/height mean.
_TRICKET_SVG_SEAT_SIZE = re.compile(
    r'<svg\s+id="seat-rect"\s+width="(?P<w>\d+)"\s+height="(?P<h>\d+)"'
)


class TricketSeatPlanGeometry(NamedTuple):
    """One room's layout, as the floor-plan store wants it."""

    hall_id: str | None
    room: str | None
    screen_side: str
    seats: list[dict]


def parse_tricket_seating_map(
    seating_map: str, seats: dict
) -> tuple[str, list[dict]] | None:
    """Turn a Tricket `seatingMap` SVG into stored geometry and a screen side.

    `seats` is the screening resource's own id -> {row, seat} table; the SVG
    carries positions and ids but no names, so the two have to be read
    together. A seat drawn in the map that the resource does not name is
    dropped: the floor plan matches on the row/seat pair, and an unnamed seat
    could never be matched to a reading.
    """
    size = _TRICKET_SVG_SEAT_SIZE.search(seating_map)
    seat_width = int(size.group("w")) if size else 10
    seat_height = int(size.group("h")) if size else 10

    geometry: list[dict] = []
    for match in _TRICKET_SVG_SEAT.finditer(seating_map):
        named = seats.get(match.group("id"))
        if not isinstance(named, dict):
            continue
        name = _tricket_seat_name(named)
        if name is None:
            continue
        row_name, seat_name = name
        geometry.append(
            {
                "row_name": row_name,
                "seat_name": seat_name,
                "position_left": float(match.group("x")),
                "position_top": float(match.group("y")),
                "width": seat_width,
                "height": seat_height,
                # Tricket's map draws only real, sellable seats — there are no
                # aisle or filler entries to exclude, unlike Eagerly's.
                "selectable": True,
            }
        )
    if not geometry:
        return None

    screen = _TRICKET_SVG_SCREEN.search(seating_map)
    if screen is None:
        # Every map seen so far draws one; without it the ordinary default is
        # the honest answer rather than a guess from the row numbering, which
        # is exactly the inference that gets Filmhuis Alkmaar backwards.
        return ScreenSide.TOP.value, geometry
    screen_y = float(screen.group("y"))
    top_seat = min(seat["position_top"] for seat in geometry)
    side = ScreenSide.TOP if screen_y < top_seat else ScreenSide.BOTTOM
    return side.value, geometry


def fetch_tricket_room_geometry(
    *, host: str, screening_id: str
) -> TricketSeatPlanGeometry | None:
    """One screening's room layout, for the floor-plan ingest.

    Two reads, both of which the checkout page makes anyway: the screening
    resource for the seat names and the hall, and the seat map for the
    positions. Returns None for anything that does not come back whole, so the
    ingest moves on to another showtime in the same room rather than storing
    half a plan.
    """
    try:
        screening = _get(f"https://{host}/api/screenings/{screening_id}").json()
    except (SeatAvailabilityFetchError, ValueError):
        return None
    seats = screening.get("seats")
    if not isinstance(seats, dict) or not seats:
        return None

    basket_id = _tricket_basket_id(host)
    if basket_id is None:
        return None
    try:
        body = _get(
            f"https://{host}/api/screenings/{screening_id}/seats?basketId={basket_id}"
        ).json()
    except (SeatAvailabilityFetchError, ValueError):
        return None
    seating_map = body.get("seatingMap") if isinstance(body, dict) else None
    if not isinstance(seating_map, str):
        return None

    parsed = parse_tricket_seating_map(seating_map, seats)
    if parsed is None:
        return None
    screen_side, geometry = parsed
    hall_id = str(screening.get("hallId") or "") or None
    return TricketSeatPlanGeometry(
        hall_id=hall_id,
        room=TRICKET_ROOM_NAMES.get(hall_id or ""),
        screen_side=screen_side,
        seats=geometry,
    )


def _tricket_seat_name(seat: dict) -> TakenSeat | None:
    row = str(seat.get("row") or "").strip()
    name = str(seat.get("seat") or "").strip()
    return (row, name) if row and name else None


# --- Eagerly ----------------------------------------------------------------

# The sites known to run Eagerly, written the way `eagerly_site` normalises a
# ticket link's netloc: no leading `www.`.
#
# The URL pattern below is gated on this list rather than accepting
# `/tickets/<number>` on any host at all. That path shape is far too ordinary
# to identify a platform — AnnexCinema and De Sien both sell at it and neither
# runs Eagerly — and a link wrongly claimed here is worse than one not
# recognised: it reads as "seat counts work at this cinema" everywhere the
# client looks, offers the viewer a check, and then 404s on the agenda feed
# every single time, for ever.
EAGERLY_SITE_HOSTS = (
    "bioscopenleiden.nl",
    "filmhallen.nl",
    "filmkoepel.nl",
    "hartlooper.nl",
    "kinorotterdam.nl",
    "slachtstraat.nl",
    "springhaver.nl",
    "themovies.nl",
)

EAGERLY_URL_PATTERN = re.compile(
    r"^https://(?:www\.)?(?:"
    + "|".join(re.escape(host) for host in EAGERLY_SITE_HOSTS)
    + r")/tickets/(\d+)/?$"
)
EAGERLY_SOLD_OUT_STATUS = "sold-out"

# Each Eagerly site's seat map lives on its own "My Cloud Cinema" booking app,
# at a subdomain that isn't derivable from the site's own domain (some use
# `book.`, some `shop.`).
#
# Keyed like EAGERLY_SITE_HOSTS, and normalised on lookup, because the same
# cinema reaches us under both forms: our own scrapers build ticket links with
# the `www.` and Cineville hands out the bare domain. Keying on the raw netloc
# meant whichever form the table didn't list silently lost its seat counts and
# fell back to sold-out-or-not — which is what would have happened to five
# cinemas the moment one of their scrapers broke and the Cineville row won the
# dedupe instead.
#
# A site missing from this table just means nobody's found its booking
# subdomain yet — `_fetch_eagerly` falls back to the feed's status enum. That
# is where bioscopenleiden.nl sits today.
EAGERLY_BOOKING_HOSTS: dict[str, str] = {
    "filmhallen.nl": "book.filmhallen.nl",
    "themovies.nl": "book.themovies.nl",
    "kinorotterdam.nl": "book.kinorotterdam.nl",
    "filmkoepel.nl": "book.filmkoepel.nl",
    "hartlooper.nl": "shop.hartlooper.nl",
    "slachtstraat.nl": "shop.slachtstraat.nl",
    "springhaver.nl": "shop.springhaver.nl",
}


# Bioscopen Leiden is the one site that runs more than one cinema, and each has
# its own booking app — so unlike everywhere else the ticket link's host does
# not say which one to ask; all three sell from `bioscopenleiden.nl/tickets/…`.
# The agenda feed's `cinema_id` is what separates them, and it is already on
# the show entry a reading looks up, so this costs no extra request.
EAGERLY_BOOKING_HOSTS_BY_CINEMA: dict[tuple[str, str], str] = {
    ("bioscopenleiden.nl", "4"): "book.trianon.bioscopenleiden.nl",
    ("bioscopenleiden.nl", "5"): "book.kijkhuis.bioscopenleiden.nl",
    ("bioscopenleiden.nl", "6"): "book.lido.bioscopenleiden.nl",
}


def eagerly_site(netloc: str) -> str:
    """A ticket link's netloc as the two tables above key it."""
    return netloc.removeprefix("www.")


def eagerly_booking_host(site: str, cinema_id: str | None) -> str | None:
    """Which booking app holds this screening's seat map, if any.

    Per-cinema first, since a site that needs that split has no single answer;
    the one-app-per-site table is the normal case.
    """
    if cinema_id is not None:
        split_site = EAGERLY_BOOKING_HOSTS_BY_CINEMA.get((site, cinema_id))
        if split_site is not None:
            return split_site
    return EAGERLY_BOOKING_HOSTS.get(site)


# The seat-plan endpoint keys a per-visitor seat hold to this id; any value
# works since nothing here ever selects a seat, so a fixed one avoids handing
# out a distinct fake identity per request for no reason.
_EAGERLY_MOBILE_DEVICE_ID = "00000000-0000-0000-0000-000000000000"


def eagerly_shows(
    base_url: str, feed_cache: EagerlyFeedCache
) -> dict[str, _EagerlyShow]:
    """Map provider_id -> status/room for one Eagerly site's whole programme."""
    cached = feed_cache.get(base_url)
    if cached is not None:
        return cached

    body = _get(f"{base_url}/fk-feed/agenda").text
    try:
        feed = json.loads(body)
    except json.JSONDecodeError as e:
        raise SeatAvailabilityFetchError(
            f"Eagerly agenda feed at {base_url} was not JSON: {e}"
        ) from e

    shows = {
        str(time["provider_id"]): _EagerlyShow(
            ticket_status=str(time["ticket_status"]),
            location=normalize_room(time.get("location")),
            cinema_id=(
                str(time["cinema_id"]) if time.get("cinema_id") is not None else None
            ),
        )
        for film in feed.values()
        for time in (film.get("times") or [])
        if time.get("provider_id") is not None and time.get("ticket_status") is not None
    }
    feed_cache[base_url] = shows
    return shows


class _SeatCount(NamedTuple):
    """One platform's seat plan, reduced to what a reading needs."""

    free: int
    capacity: int
    taken: tuple[TakenSeat, ...]


def _is_bookable_eagerly_seat(seat: dict) -> bool:
    """Whether a raw Eagerly seat entry is a real, selectable seat.

    "ROL" (rolstoel, wheelchair space) marks floor space next to a seat, not a
    seat itself — it's `seat_selectable`, but counting it would claim capacity
    the room doesn't have. A same-section companion seat next to it is a real
    seat and stays counted.
    """
    return (
        seat.get("seat_selectable") == 1
        and str(seat.get("seat_name") or "").strip().upper() != "ROL"
    )


def _fetch_eagerly_seatplan_raw(
    *, booking_host: str, cinema_id: str, show_time_id: str
) -> list[dict] | None:
    """GET the cinema's own seat map and return its raw seat list, if it has one.

    Read-only: this only ever GETs the seat plan. Selecting a seat — which
    starts its 10-minute checkout hold — happens on a different call the real
    checkout flow makes when someone clicks one, which nothing here does.
    Returns None if the response doesn't look like a real seat plan (e.g. an
    unrecognised show id), so callers can fall back to the feed's status.
    """
    url = (
        f"https://{booking_host}/webservices/cinema_seatplans/getSeatPlanData"
        f"?cinema_id={cinema_id}&mobile_device_id={_EAGERLY_MOBILE_DEVICE_ID}"
        f"&show_time_id={show_time_id}"
    )
    response = _get(url)
    try:
        body = response.json()
    except ValueError as e:
        raise SeatAvailabilityFetchError(
            f"Eagerly seat plan for show {show_time_id} was not JSON: {e}"
        ) from e
    seats = body.get("data") if isinstance(body, dict) else None
    return seats if isinstance(seats, list) else None


def _is_taken_eagerly_seat(seat: dict) -> bool:
    """Whether a bookable seat is spoken for — sold, held, or otherwise blocked.

    A held seat counts as taken: it is someone's ten-minute checkout hold, and
    a seat map that offers it is offering something nobody can buy right now.
    """
    return (
        seat.get("ticket_id") is not None
        or seat.get("seat_lock_id") is not None
        or seat.get("seat_status") != 0
    )


def _seat_key(seat: dict) -> TakenSeat:
    return (
        str(seat.get("row_name") or "").strip(),
        str(seat.get("seat_name") or "").strip(),
    )


def _fetch_eagerly_seatplan(
    *, booking_host: str, cinema_id: str, show_time_id: str
) -> _SeatCount | None:
    """Free/total seats *and* which individual ones are taken, in one read.

    The count and the seat map come off the same response, so a reading that
    pays for one gets the other for nothing — which is the whole reason the
    floor plan can be served from the database instead of re-reading the
    ticket shop every time somebody opens the seat picker.
    """
    seats = _fetch_eagerly_seatplan_raw(
        booking_host=booking_host, cinema_id=cinema_id, show_time_id=show_time_id
    )
    if seats is None:
        return None
    selectable = [seat for seat in seats if _is_bookable_eagerly_seat(seat)]
    if not selectable:
        return None
    taken = tuple(
        _seat_key(seat) for seat in selectable if _is_taken_eagerly_seat(seat)
    )
    return _SeatCount(
        free=len(selectable) - len(taken), capacity=len(selectable), taken=taken
    )


# Floor-plan geometry fields worth persisting; everything else in the raw
# response (ticket/lock ids, current status) is live-request-scoped and would
# only ever be stale if stored.
_FLOOR_PLAN_GEOMETRY_FIELDS = (
    "row_name",
    "seat_name",
    "position_left",
    "position_top",
    "width",
    "height",
)


class EagerlySeatPlanGeometry(NamedTuple):
    """One show's seat map plus the room the booking system says it's in.

    `screen_name` is the booking backend's own name for the room, which is
    what makes this geometry safe to file under a room: the agenda feed's
    `location` and the ticketing system's screen can disagree for individual
    shows (a screening moved between rooms in one system and not the other),
    and storing a plan under the feed's label without checking has already
    filed one room's layout under another's name in production.
    """

    screen_name: str | None
    seats: list[dict]


def fetch_eagerly_seatplan_geometry(
    *, booking_host: str, cinema_id: str, show_time_id: str
) -> EagerlySeatPlanGeometry | None:
    """One room's full seat geometry, for permanent storage.

    Used only by `scripts/ingest-seat-floor-plans.py` — a one-off ingest, not
    something the poller calls, since a room's layout essentially never
    changes. `selectable` here already has the ROL exclusion baked in, so
    nothing downstream needs to know about that platform-specific quirk.
    """
    seats = _fetch_eagerly_seatplan_raw(
        booking_host=booking_host, cinema_id=cinema_id, show_time_id=show_time_id
    )
    if seats is None:
        return None
    # Every seat in a plan carries the same screen; take it off the first one
    # rather than trusting the caller's idea of which room this show is in.
    screen_name = (
        normalize_room(str(seats[0].get("screen_name") or "")) if seats else None
    )
    return EagerlySeatPlanGeometry(
        screen_name=screen_name,
        seats=[
            {
                **{field: seat.get(field) for field in _FLOOR_PLAN_GEOMETRY_FIELDS},
                "selectable": _is_bookable_eagerly_seat(seat),
            }
            for seat in seats
        ],
    )


# How many of a room's showtimes to try before giving up on it. A room only
# needs one showtime the booking system agrees is in it, and the first one
# almost always is; the retries exist for the rare show the agenda feed and
# the ticketing system file under different rooms.
MAX_ROOM_GEOMETRY_CANDIDATES = 5


def fetch_eagerly_room_geometry(
    *,
    booking_host: str,
    room: str,
    candidates: list[tuple[str, str]],
    request_delay_seconds: float = 0.0,
) -> tuple[list[dict] | None, str]:
    """One room's seat geometry, taken from a show that agrees it's in `room`.

    `candidates` is `(show_time_id, cinema_id)` for the showtimes the agenda
    feed puts in `room`, best-first. The room name comes from that feed and
    the geometry from the booking system, and for an individual show the two
    can disagree — a screening moved between rooms in one system and not the
    other — so a candidate is only accepted once its seat plan's own
    `screen_name` says `room` too. Taking the first candidate on trust is
    what filed KINO 1's seat map under KINO 4 in production.

    Returns `(None, reason)` when no candidate agreed, so the caller can leave
    the room without a plan rather than store one belonging to another room.
    """
    rejected: list[str] = []
    for show_time_id, cinema_id in candidates[:MAX_ROOM_GEOMETRY_CANDIDATES]:
        geometry = fetch_eagerly_seatplan_geometry(
            booking_host=booking_host,
            cinema_id=cinema_id,
            show_time_id=show_time_id,
        )
        if request_delay_seconds:
            time.sleep(request_delay_seconds)
        if geometry is None or not geometry.seats:
            rejected.append(f"{show_time_id}: empty seat plan")
            continue
        if geometry.screen_name != room:
            rejected.append(f"{show_time_id}: booked in {geometry.screen_name!r}")
            continue
        return geometry.seats, ""
    return None, "; ".join(rejected) or "no showtimes in the feed"


def _fetch_eagerly(url: str, feed_cache: EagerlyFeedCache) -> SeatAvailability:
    match = EAGERLY_URL_PATTERN.match(url)
    if match is None:
        return _UNKNOWN
    provider_id = match.group(1)
    parts = urlsplit(url)
    # Requested at the normalised host, not the link's own, so the two forms of
    # one site share a single cached programme within a run instead of costing
    # a feed fetch each. Every site in EAGERLY_SITE_HOSTS serves the feed on
    # both forms (checked).
    site = eagerly_site(parts.netloc)
    show = eagerly_shows(f"{parts.scheme}://{site}", feed_cache).get(provider_id)
    if show is None:
        # Dropped from the programme since the last scrape.
        return SeatAvailability(None, None, None, "eagerly")

    booking_host = eagerly_booking_host(site, show.cinema_id)
    if booking_host is not None and show.cinema_id is not None:
        seat_count = _fetch_eagerly_seatplan(
            booking_host=booking_host,
            cinema_id=show.cinema_id,
            show_time_id=provider_id,
        )
        if seat_count is not None:
            return SeatAvailability(
                seat_count.free,
                seat_count.free == 0,
                show.location,
                "eagerly",
                capacity=seat_count.capacity,
                taken_seats=seat_count.taken,
            )

    # No seat map wired up for this site yet (or its show id wasn't
    # recognised there): fall back to the feed's status enum, which only ever
    # says sold out or not, never a count.
    return SeatAvailability(
        None, show.ticket_status == EAGERLY_SOLD_OUT_STATUS, show.location, "eagerly"
    )


# --- ActiveTickets ----------------------------------------------------------

# The nine tenants seen in the catalogue. Gated on a host list for the same
# reason the Eagerly pattern is: `/Show/Details/<id>` is a shape, not a
# platform, and claiming a link we cannot actually read is worse than not
# recognising it — the client shows the cinema as one that reports seat counts
# and then never gets one.
ACTIVETICKETS_HOSTS = (
    "activetickets.filmhuisdenhaag.nl",
    "tickets-depijp.rialtofilm.nl",
    "tickets.cinebergen.nl",
    "tickets.debalie.nl",
    "tickets.filmhuis-lumen.nl",
    "tickets.filmhuisalkmaar.nl",
    "tickets.filmtheaterhilversum.nl",
    "tickets.sliekerfilm.nl",
    "webshop.lux-nijmegen.nl",
)

# The id is the trailing number, after a slug that is itself full of numbers
# ("...-The-Invite-30-Aug-11926930"); the greedy prefix is what makes the last
# one win. Some tenants drop the slug entirely (De Balie links straight to
# `/Show/Details/11839294`) and the locale segment is optional, because
# Cineville hands out links without it and the shop's own pages carry it.
ACTIVETICKETS_URL_PATTERN = re.compile(
    r"^https://(?:"
    + "|".join(re.escape(host) for host in ACTIVETICKETS_HOSTS)
    + r")/(?:[a-z]{2}-[A-Z]{2}/)?Show/Details/(?:[^/]*-)?(\d+)/?$"
)

_ACTIVETICKETS_CART_VAR = "var jsonCart"

# "Rij:  1, Stoel:  11", or "Row: 1, Seat: 11" when the link carries an English
# locale. Nothing else is accepted: a seat whose name we cannot read is left
# out of the map rather than guessed at, since the stored floor plan matches on
# exactly this pair and a wrong guess files one seat's state under another's.
_ACTIVETICKETS_SEAT_NAME = re.compile(
    r"^(?:Rij|Row)\s*:\s*(?P<row>[^,]+?)\s*,\s*(?:Stoel|Seat)\s*:\s*(?P<seat>.+?)$"
)


def _activetickets_cart(page: str) -> dict:
    """The Knockout view-model every ActiveTickets show page inlines.

    Decoded from the opening brace with a real JSON parser rather than matched
    with a regex: the object is several kilobytes of nested shop state, and its
    strings contain both braces and semicolons.
    """
    marker = page.find(_ACTIVETICKETS_CART_VAR)
    start = page.find("{", marker) if marker != -1 else -1
    if start == -1:
        raise SeatAvailabilityFetchError(
            "ActiveTickets page carried no jsonCart view-model"
        )
    try:
        cart, _ = json.JSONDecoder().raw_decode(page, start)
    except json.JSONDecodeError as e:
        raise SeatAvailabilityFetchError(
            f"ActiveTickets jsonCart was not JSON: {e}"
        ) from e
    if not isinstance(cart, dict):
        raise SeatAvailabilityFetchError("ActiveTickets jsonCart was not an object")
    return cart


def _activetickets_show(cart: dict, show_id: str) -> dict | None:
    """The screening the link asked for.

    An anonymous fetch has an empty basket, so `Shows` holds exactly the one —
    but it is a *cart*, so matching the id is the only thing that stays correct
    if that ever stops being true.
    """
    shows = [show for show in (cart.get("Shows") or []) if isinstance(show, dict)]
    for show in shows:
        if str(show.get("ShowId")) == show_id:
            return show
    return None


def _activetickets_seat_name(seat: dict) -> TakenSeat | None:
    match = _ACTIVETICKETS_SEAT_NAME.match(str(seat.get("Description") or "").strip())
    if match is None:
        return None
    return (match.group("row").strip(), match.group("seat").strip())


def _activetickets_seat_count(seats: list[dict]) -> _SeatCount:
    """Reduce an inlined seat plan to free / total / taken.

    `S` is whether the seat can still be bought and `B` whether it is blocked
    for this screening — held back, broken, or sold as part of a reduced
    layout. Neither is buyable, so both are "taken" as far as a reading goes,
    but both stay in the capacity: `B` is a decision about one screening, and
    the room is the same size next week. That is the same direction the running
    max already leans, and the safe one — a screening sold at reduced capacity
    reads emptier than it is rather than the room reading fuller.
    """
    taken: list[TakenSeat] = []
    free = 0
    for seat in seats:
        if seat.get("S") and not seat.get("B"):
            free += 1
            continue
        name = _activetickets_seat_name(seat)
        if name is not None:
            taken.append(name)
    return _SeatCount(free=free, capacity=len(seats), taken=tuple(taken))


def _fetch_activetickets(url: str, _feed_cache: EagerlyFeedCache) -> SeatAvailability:
    match = ACTIVETICKETS_URL_PATTERN.match(url)
    if match is None:
        return _UNKNOWN
    show_id = match.group(1)
    show = _activetickets_show(_activetickets_cart(_get(url).text), show_id)
    if show is None:
        # The shop no longer lists this screening — moved, cancelled, or a
        # stale id in the link. Unknown, which is not the same as sold out.
        return SeatAvailability(None, None, None, "activetickets")

    edit_data = show.get("EditData") or {}
    room = normalize_room(show.get("Location"))
    seats = [seat for seat in (edit_data.get("Seats") or []) if isinstance(seat, dict)]
    if not seats:
        # Free seating: the room is not sold seat by seat, so there is no count
        # to be had here at any price, only the flag. (A numbered room whose
        # seats load per section lands here too — see the note below.) Reported
        # as a plain bool so `_apply_reading` can clear a previous zero when a
        # sold-out screening has tickets handed back.
        return SeatAvailability(
            None, bool(edit_data.get("SoldOut")), room, "activetickets"
        )

    # Newer tenants (LUX) also carry `TicketsAvailable`/`TicketsCapacity`
    # alongside the seat list, and on the one screening that had both,
    # TicketsAvailable agreed with the seat count exactly. They are not read:
    # most tenants don't send them at all, the ones that do send 0/0 for a
    # screening whose sales have not opened — indistinguishable from a real
    # sold-out — and `TicketsCapacity` is the sellable allocation rather than
    # the room, which is the wrong denominator for a busyness level.
    count = _activetickets_seat_count(seats)
    return SeatAvailability(
        count.free,
        count.free == 0,
        room,
        "activetickets",
        capacity=count.capacity,
        taken_seats=count.taken,
    )


# --- Ticketlab ---------------------------------------------------------------

# A white-label ticket shop used by a long tail of small arthouse cinemas, each
# at its own `tickets.<cinema-domain>` subdomain running the same
# `/shop/tickets-new.php` checkout (its own privacy policy points at
# ticketlab.nl). Gated on a host list for the same reason as everywhere else:
# the path shape alone says nothing about the platform.
#
# A seated show inlines two Knockout-style state objects, `state` and `util`,
# the same way ActiveTickets inlines `jsonCart`. `util.seating.seats` is the
# room's full seat map — id, row/seat name, x/y position, and a `state` code
# (from `tickets-new.js`'s `SEAT_STATE_*` constants: 1 unavailable, 2
# available, 3 in someone's cart, 4 sold — anything but 2 is not buyable right
# now). A free-seating show (`state.seated` false) carries no seat map at all,
# only the `availabletickets` hidden input's running count. Both cases name
# the room directly in the page, next to a numeric `locationid` that keys it
# across shows — no hand-built lookup table needed, unlike Tricket's `hallId`.
TICKETLAB_HOSTS = (
    "tickets.artishocksoest.nl",
    "tickets.cacaofabriek.nl",
    "tickets.cinemamiddelburg.nl",
    "tickets.cinemaoostereiland.nl",
    "tickets.drom.nl",
    "tickets.filmhuisbussum.nl",
    "tickets.filmhuiszevenaar.nl",
    "tickets.filmtheaterfraterhuis.nl",
    "tickets.filmtheatervoorschoten.nl",
    "tickets.fizi.nl",
    "tickets.florafilmtheater.nl",
    "tickets.focusarnhem.nl",
    "tickets.luxorzutphen.nl",
    "tickets.wennekercinema.nl",
)

TICKETLAB_URL_PATTERN = re.compile(
    r"^https://(?:"
    + "|".join(re.escape(host) for host in TICKETLAB_HOSTS)
    + r")/shop/tickets-new\.php\?showid=(\d+)$"
)

# A showid that no longer resolves (sold as a different show, or a stale link)
# renders this alert instead of the order form — "Show not found." or, in the
# Dutch locale `_get`'s Accept-Language header asks for, "Voorstelling niet
# gevonden." Matched on the wrapper alone since the two share no text; not
# evidence of a full house either way.
_TICKETLAB_NOT_FOUND = re.compile(r'class="alert alert-danger" role="alert">')
_TICKETLAB_AVAILABLE_TICKETS = re.compile(r'id="availabletickets"[^>]*value="(\d+)"')
# "<h4 ...><small>Location</small></h4></div><div ...><h4 ...>Club Zaal</h4>",
# or "Zaal" for "Location" in the Dutch locale.
_TICKETLAB_ROOM = re.compile(
    r"<small>(?:Location|Zaal)</small></h4></div><div class=\"col-md-9\">"
    r'<h4 class="event-label">([^<]*)</h4>'
)
_TICKETLAB_SEAT_STATE_AVAILABLE = 2


def _ticketlab_room(page: str) -> str | None:
    match = _TICKETLAB_ROOM.search(page)
    return normalize_room(match.group(1) if match else None)


def _ticketlab_js_object(page: str, var_name: str) -> dict:
    """One `name = {...};` assignment inlined in a Ticketlab checkout page.

    Decoded with a real JSON parser, like ActiveTickets' `jsonCart`: these
    objects run to a couple of KB and their strings (film titles, seat
    descriptions) can contain both braces and semicolons.
    """
    marker = re.search(rf"(?<![A-Za-z0-9_]){re.escape(var_name)}\s*=\s*{{", page)
    if marker is None:
        raise SeatAvailabilityFetchError(f"Ticketlab page carried no {var_name!r}")
    start = marker.end() - 1
    try:
        obj, _ = json.JSONDecoder().raw_decode(page, start)
    except json.JSONDecodeError as e:
        raise SeatAvailabilityFetchError(
            f"Ticketlab {var_name!r} was not JSON: {e}"
        ) from e
    if not isinstance(obj, dict):
        raise SeatAvailabilityFetchError(f"Ticketlab {var_name!r} was not an object")
    return obj


def _ticketlab_seat_name(seat: dict) -> TakenSeat | None:
    row = str(seat.get("row") or "").strip()
    name = str(seat.get("seat") or "").strip()
    return (row, name) if row and name else None


def _fetch_ticketlab(url: str, _feed_cache: EagerlyFeedCache) -> SeatAvailability:
    match = TICKETLAB_URL_PATTERN.match(url)
    if match is None:
        return _UNKNOWN
    page = _get(url).text
    if _TICKETLAB_NOT_FOUND.search(page):
        return SeatAvailability(None, None, None, "ticketlab")

    room = _ticketlab_room(page)
    state = _ticketlab_js_object(page, "state")
    if not state.get("seated"):
        # Free seating: the room is not sold seat by seat, so only the running
        # count is on offer, the same shape as ActiveTickets' unnumbered rooms.
        available = _TICKETLAB_AVAILABLE_TICKETS.search(page)
        seats_left = int(available.group(1)) if available else None
        return SeatAvailability(
            seats_left,
            seats_left == 0 if seats_left is not None else None,
            room,
            "ticketlab",
        )

    util = _ticketlab_js_object(page, "util")
    seats = (util.get("seating") or {}).get("seats")
    if not isinstance(seats, list) or not seats:
        return SeatAvailability(None, None, room, "ticketlab")

    taken: list[TakenSeat] = []
    free = 0
    for seat in seats:
        if not isinstance(seat, dict):
            continue
        if seat.get("state") == _TICKETLAB_SEAT_STATE_AVAILABLE:
            free += 1
            continue
        name = _ticketlab_seat_name(seat)
        if name is not None:
            taken.append(name)

    return SeatAvailability(
        free,
        free == 0,
        room,
        "ticketlab",
        capacity=len(seats),
        taken_seats=tuple(taken),
    )


class TicketlabSeatPlanGeometry(NamedTuple):
    """One room's layout, as the floor-plan store wants it."""

    room: str | None
    screen_side: str
    seats: list[dict]


def fetch_ticketlab_room_geometry(url: str) -> TicketlabSeatPlanGeometry | None:
    """One showtime's room layout, for the floor-plan ingest.

    The same checkout page the poller already reads carries the full seat map,
    so this is a plain re-fetch of it rather than a second endpoint. Returns
    None for a free-seating show, an unresolved showid, or anything that does
    not come back whole, so the ingest moves on to another showtime in the
    same room rather than storing half a plan.
    """
    match = TICKETLAB_URL_PATTERN.match(url)
    if match is None:
        return None
    try:
        page = _get(url).text
    except SeatAvailabilityFetchError:
        return None
    if _TICKETLAB_NOT_FOUND.search(page):
        return None

    try:
        state = _ticketlab_js_object(page, "state")
        if not state.get("seated"):
            return None
        util = _ticketlab_js_object(page, "util")
    except SeatAvailabilityFetchError:
        return None
    seats = (util.get("seating") or {}).get("seats")
    if not isinstance(seats, list) or not seats:
        return None

    try:
        settings = _ticketlab_js_object(page, "settings")
    except SeatAvailabilityFetchError:
        settings = {}
    seat_width = settings.get("seat_width")
    seat_height = settings.get("seat_height")
    # `settings.seating_upside_down` is the platform's own flag for which end
    # a room's screen is at — the same role Tricket's drawn screen line plays
    # — read here rather than guessed from row numbering, which is exactly
    # the inference that gets Filmhuis Alkmaar backwards elsewhere. Unverified
    # against a real upside-down room, since none turned up while wiring this
    # up; the per-room override in `screen_side_override` is the escape hatch
    # if a room comes out flipped.
    screen_side = (
        ScreenSide.BOTTOM if settings.get("seating_upside_down") else ScreenSide.TOP
    )

    geometry: list[dict] = []
    for seat in seats:
        if not isinstance(seat, dict):
            continue
        name = _ticketlab_seat_name(seat)
        if name is None:
            continue
        row_name, seat_name = name
        try:
            x = float(seat.get("x"))
            y = float(seat.get("y"))
        except (TypeError, ValueError):
            continue
        geometry.append(
            {
                "row_name": row_name,
                "seat_name": seat_name,
                "position_left": x,
                "position_top": y,
                "width": seat_width or 32,
                "height": seat_height or 32,
                "selectable": True,
            }
        )
    if not geometry:
        return None

    return TicketlabSeatPlanGeometry(
        room=_ticketlab_room(page), screen_side=screen_side.value, seats=geometry
    )


# --- Ticketmatic ("Ticketworks") ---------------------------------------------

# Seven cinemas on the same `<host>/mtTicket/performance/<id>` shape, but the
# platform behaves very differently depending on how the venue sells a room.
# A numbered room inlines an SVG seat plan — one `<rect>` per seat, each
# carrying `data-status` (AVAILABLE / NOTAVAILABLE), `data-row`/`data-seat`
# and an x/y position — so the count, the room's real total, the taken map
# and the geometry all come off the one GET, same as Ticketlab. A
# general-admission room has no seat plan at all, only a ticket-quantity
# picker capped at a fixed ceiling (`absMaxOrderable`, always 10 wherever
# sampled) — except the page prints a *smaller* number there the moment the
# room has fewer than that left to sell, the same way older Z-ELITE
# deployments do. Confirmed live: a Concordia performance read "Maximaal 2
# tickets beschikbaar" against the generic "Maximaal 10 tickets" (no
# "beschikbaar") everywhere else, and `data-max` on the hidden ticket-type
# input dropped to match. At or above the ceiling the true number could be
# anything, so it stays unknown; below it, it's the room's own word for how
# many are left. A performance not yet in its online sales window (or an id
# that no longer resolves) redirects to a plain listing page with neither an
# SVG nor an `absMaxOrderable` — reads as unknown either way.
TICKETMATIC_HOSTS = (
    "kaartverkoop.lievevrouw.nl",
    "ticketing.lumiere.nl",
    "tickets.concordia.nl",
    "tickets.forum.nl",
    "tickets.gigant.nl",
    "tickets.mimik.nl",
    "tickets.schuur.nl",
)

TICKETMATIC_URL_PATTERN = re.compile(
    r"^https://(?:"
    + "|".join(re.escape(host) for host in TICKETMATIC_HOSTS)
    + r")/mtTicket/performance/(\d+)(?:\?.*)?$"
)

# "<div class='mtPerformance' ...><h1>Title</h1><span class='date'>...</span>
# <span class='location'><i .../>Filmzaal 2</span></div>" — present on every
# performance page, seated or not, which is a better room name than the seat
# plan's own `data-section` (bare "1" at one of the seated venues).
_TICKETMATIC_ROOM = re.compile(
    r"<div class='mtPerformance'.*?<span class='location'>.*?</i>([^<]*)</span>", re.S
)
_TICKETMATIC_SEAT_RECT = re.compile(r'<rect id="\d+" class="seat[^"]*".*?></rect>', re.S)
_TICKETMATIC_ATTR = re.compile(r'([\w-]+)="([^"]*)"')
_TICKETMATIC_SEAT_AVAILABLE = "AVAILABLE"

_TICKETMATIC_ORDER_CEILING = 10
_TICKETMATIC_ORDERABLE = re.compile(r"absMaxOrderable = new Number\((\d+)\)")


def _ticketmatic_room(page: str) -> str | None:
    match = _TICKETMATIC_ROOM.search(page)
    return normalize_room(match.group(1) if match else None)


def _ticketmatic_seat_name(attrs: dict[str, str]) -> TakenSeat | None:
    row = attrs.get("data-row", "").strip()
    seat = attrs.get("data-seat", "").strip()
    return (row, seat) if row and seat else None


def _fetch_ticketmatic(url: str, _feed_cache: EagerlyFeedCache) -> SeatAvailability:
    match = TICKETMATIC_URL_PATTERN.match(url)
    if match is None:
        return _UNKNOWN
    page = _get(url).text
    room = _ticketmatic_room(page)

    seat_blocks = _TICKETMATIC_SEAT_RECT.findall(page)
    if seat_blocks:
        taken: list[TakenSeat] = []
        free = 0
        for block in seat_blocks:
            attrs = dict(_TICKETMATIC_ATTR.findall(block))
            if attrs.get("data-status") == _TICKETMATIC_SEAT_AVAILABLE:
                free += 1
                continue
            name = _ticketmatic_seat_name(attrs)
            if name is not None:
                taken.append(name)
        return SeatAvailability(
            free,
            free == 0,
            room,
            "ticketmatic",
            capacity=len(seat_blocks),
            taken_seats=tuple(taken),
        )

    orderable = _TICKETMATIC_ORDERABLE.search(page)
    if orderable is None:
        return SeatAvailability(None, None, room, "ticketmatic")
    seats_left = int(orderable.group(1))
    if seats_left >= _TICKETMATIC_ORDER_CEILING:
        # Still at (or above) the generic per-order cap — could be exactly
        # ten free or four hundred, the page doesn't say.
        return SeatAvailability(None, None, room, "ticketmatic")
    return SeatAvailability(seats_left, seats_left == 0, room, "ticketmatic")


_Handler = Callable[[str, EagerlyFeedCache], SeatAvailability]
_HANDLERS: list[tuple[re.Pattern[str], _Handler]] = [
    (ZELITE_URL_PATTERN, _fetch_zelite),
    (TRICKET_URL_PATTERN, _fetch_tricket),
    (EAGERLY_URL_PATTERN, _fetch_eagerly),
    (ACTIVETICKETS_URL_PATTERN, _fetch_activetickets),
    (TICKETLAB_URL_PATTERN, _fetch_ticketlab),
    (TICKETMATIC_URL_PATTERN, _fetch_ticketmatic),
]


def supports(ticket_link: str) -> bool:
    """Whether any platform handler recognises this ticket link."""
    return any(pattern.search(ticket_link) for pattern, _ in _HANDLERS)


def fetch_seat_availability(
    *,
    ticket_link: str,
    feed_cache: EagerlyFeedCache | None = None,
) -> SeatAvailability:
    """Read seat availability for one showtime from its ticket link.

    Returns an all-``None`` reading for a link no handler recognises, and for a
    show its platform no longer knows about. Raises
    ``SeatAvailabilityFetchError`` if the shop could not be reached.
    """
    if feed_cache is None:
        feed_cache = {}
    for pattern, handler in _HANDLERS:
        if pattern.search(ticket_link):
            availability = handler(ticket_link, feed_cache)
            logger.debug(
                f"Seat availability for {ticket_link}: {availability.seats_left} left "
                f"(sold_out={availability.sold_out}, room={availability.room}, "
                f"{availability.platform})"
            )
            return availability
    return _UNKNOWN
