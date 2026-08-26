"""How many seats are left for one showtime, read from its ticket link.

Every cinema we run our own scraper for sells through one of four ticketing
platforms, and each of them answers an unauthenticated GET:

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
  and Studio/K's two halls (91 and 153 seats, confirmed live) are
  distinguished here only by that exact capacity, never a display name.
* **Eagerly** (Filmhallen, The Movies, Kino, Filmkoepel, Louis Hartlooper,
  Slachtstraat, Springhaver) — each of these runs its own seat inventory on a
  "My Cloud Cinema" booking app, at its own subdomain (``book.`` for some,
  ``shop.`` for others — not derivable from the site's own domain, hence the
  lookup table below). Its ``getSeatPlanData`` endpoint answers with every
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

ActiveTickets (Rialto) exposes neither, and Cineville's API has no availability
field at all, so showtimes that only exist via Cineville cannot be covered.

Nothing here touches the database. A transport failure raises
``SeatAvailabilityFetchError`` rather than returning zero: reporting a fetch
failure as "sold out" is the same class of bug as treating a rate-limited
scrape as "this showtime is gone".
"""

import json
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import NamedTuple
from urllib.parse import urlsplit

import requests

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
        seats_left, seats_left == 0, None, "tricket", capacity=len(seats)
    )


# --- Eagerly ----------------------------------------------------------------

EAGERLY_URL_PATTERN = re.compile(r"^https://[^/]+/tickets/(\d+)/?$")
EAGERLY_SOLD_OUT_STATUS = "sold-out"

# Each Eagerly site's seat map lives on its own "My Cloud Cinema" booking app,
# at a subdomain that isn't derivable from the site's own domain (some use
# `book.`, some `shop.`), keyed by the netloc `ticket_link` actually uses.
# A site missing from this table just means nobody's found its booking
# subdomain yet — `_fetch_eagerly` falls back to the feed's status enum.
EAGERLY_BOOKING_HOSTS: dict[str, str] = {
    "filmhallen.nl": "book.filmhallen.nl",
    "themovies.nl": "book.themovies.nl",
    "www.kinorotterdam.nl": "book.kinorotterdam.nl",
    "www.filmkoepel.nl": "book.filmkoepel.nl",
    "www.hartlooper.nl": "shop.hartlooper.nl",
    "www.slachtstraat.nl": "shop.slachtstraat.nl",
    "www.springhaver.nl": "shop.springhaver.nl",
}

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


class _EagerlySeatCount(NamedTuple):
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
) -> _EagerlySeatCount | None:
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
    return _EagerlySeatCount(
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
    show = eagerly_shows(f"{parts.scheme}://{parts.netloc}", feed_cache).get(
        provider_id
    )
    if show is None:
        # Dropped from the programme since the last scrape.
        return SeatAvailability(None, None, None, "eagerly")

    booking_host = EAGERLY_BOOKING_HOSTS.get(parts.netloc)
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


_Handler = Callable[[str, EagerlyFeedCache], SeatAvailability]
_HANDLERS: list[tuple[re.Pattern[str], _Handler]] = [
    (ZELITE_URL_PATTERN, _fetch_zelite),
    (TRICKET_URL_PATTERN, _fetch_tricket),
    (EAGERLY_URL_PATTERN, _fetch_eagerly),
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
