"""Parsing the four ticket platforms into a seat count.

The markup fragments here are trimmed from the real checkout pages; the
attributes the parsers key off are reproduced exactly.
"""

import json

import pytest

from app.scraping import seat_availability
from app.scraping.seat_availability import (
    SeatAvailabilityFetchError,
    fetch_seat_availability,
    supports,
)

LAB111_LINK = (
    "https://tickets.lab111.nl/labcinema/nl/flow_configs/webshop"
    "/steps/start/show/1293554"
)
EYE_LINK = (
    "https://kaarten.eyefilm.nl/eye/en/flow_configs/webshop/steps/order"
    "/show/fea1fa0f-7407-4403-8fd1-0e2682b3997f?remote=planner&set=false"
)
FCHYENA_LINK = (
    "https://tickets.fchyena.nl/fchyena/nl/flow_configs/fchy_1s"
    "/steps/start/show/1304426"
)
TRICKET_LINK = "https://kassa.studio-k.nu/#/checkout/0009fb92-0853-4d68-b7d5-d2cb2487a416"
FILMHALLEN_LINK = "https://filmhallen.nl/tickets/197282/"


class _StubResponse:
    def __init__(self, text: str) -> None:
        self.text = text

    def json(self):
        return json.loads(self.text)


def _stub_get(monkeypatch, pages: dict[str, str]) -> list[str]:
    """Replace the module's HTTP call; returns the list of URLs requested."""
    requested: list[str] = []

    def _fake_get(url: str) -> _StubResponse:
        requested.append(url)
        if url not in pages:
            raise SeatAvailabilityFetchError(f"unexpected url {url}")
        return _StubResponse(pages[url])

    monkeypatch.setattr(seat_availability, "_get", _fake_get)
    return requested


def _zelite_page(
    *,
    header: str,
    configured_maxima: list[int] | None = None,
    sold_out: bool = False,
) -> str:
    selects = "".join(
        '<select base_object_id="1293554" base_object_type="show" '
        f'badge_type_id="{4972 + index}" class="form-control select-quantity" '
        f'data-configured-max="{value}" data-uber-code=""></select>'
        for index, value in enumerate(configured_maxima or [])
    )
    sold_out_label = (
        '<span class="sold-out-label"></br>SOLD OUT</br></br></span>' if sold_out else ""
    )
    return (
        "<html><body>"
        "<div><h4><strong>Akira (4K Restoration)</strong></h4></div>"
        f"<div><span id='show-starts-at'>{header}</span></div>"
        f"{sold_out_label}"
        f'<table id="order-form-table">{selects}</table>'
        "</body></html>"
    )


# --- Z-ELITE ----------------------------------------------------------------


def test_zelite_reads_seats_left_and_room(monkeypatch) -> None:
    _stub_get(
        monkeypatch,
        {
            LAB111_LINK: _zelite_page(
                header="vr 11 september 2026, 21:30 - LAB 1",
                configured_maxima=[55, 55],
            )
        },
    )
    availability = fetch_seat_availability(ticket_link=LAB111_LINK)
    assert availability.seats_left == 55
    assert availability.sold_out is False
    assert availability.room == "LAB 1"
    # Z-ELITE only ever gives a remaining count, never the room's real total.
    assert availability.capacity is None


def test_zelite_takes_max_across_badge_types(monkeypatch) -> None:
    """Eye caps two of its three badge types per order, at 2 and 10.

    Those caps are order limits, not the room — reading the smallest (or the
    first) would report a 127-seat room as nearly sold out on every screening.
    """
    _stub_get(
        monkeypatch,
        {
            EYE_LINK: _zelite_page(
                header="Fri 28 August 2026, 21:00 - Cinema  3",
                configured_maxima=[2, 10, 104],
            )
        },
    )
    availability = fetch_seat_availability(ticket_link=EYE_LINK)
    assert availability.seats_left == 104
    # Eye writes a double space between "Cinema" and the number.
    assert availability.room == "Cinema 3"


def test_zelite_sold_out_has_no_order_form(monkeypatch) -> None:
    _stub_get(
        monkeypatch,
        {
            LAB111_LINK: _zelite_page(
                header="do 10 september 2026, 21:30 - LAB 1", sold_out=True
            )
        },
    )
    availability = fetch_seat_availability(ticket_link=LAB111_LINK)
    assert availability.seats_left == 0
    assert availability.sold_out is True


def test_zelite_missing_show_is_unknown_not_sold_out(monkeypatch) -> None:
    """A dead show id renders neither an order form nor a sold-out label.

    Reporting that as zero would make a showtime the shop has simply dropped
    look like a full house.
    """
    _stub_get(
        monkeypatch,
        {LAB111_LINK: "<html><body>Het evenement kon niet gevonden worden.</body></html>"},
    )
    availability = fetch_seat_availability(ticket_link=LAB111_LINK)
    assert availability.seats_left is None
    assert availability.sold_out is None
    assert availability.is_known is False


def test_zelite_room_name_may_contain_a_dash(monkeypatch) -> None:
    _stub_get(
        monkeypatch,
        {
            FCHYENA_LINK: _zelite_page(
                header="do 27 augustus 2026, 16:30 - Zaal 1 - Balkon",
                configured_maxima=[60],
            )
        },
    )
    assert fetch_seat_availability(ticket_link=FCHYENA_LINK).room == "Zaal 1 - Balkon"


def test_zelite_covers_every_tenant_flow_config() -> None:
    # LAB111/Kriterion use `webshop`, FC Hyena `fchy_1s`, Eye the `order` step.
    assert supports(LAB111_LINK)
    assert supports(FCHYENA_LINK)
    assert supports(EYE_LINK)


# --- Tricket ----------------------------------------------------------------

TRICKET_SCREENING_URL = (
    "https://kassa.studio-k.nu/api/screenings/0009fb92-0853-4d68-b7d5-d2cb2487a416"
)


def _tricket_screening(seat_count: int, available: int) -> str:
    seats = {
        f"seat-{i}": {"row": "1", "seat": str(i), "seatTypeId": "regular"}
        for i in range(seat_count)
    }
    return json.dumps({"seats": seats, "numberOfAvailableSeats": available})


def test_tricket_reads_exact_count_and_capacity(monkeypatch) -> None:
    requested = _stub_get(
        monkeypatch, {TRICKET_SCREENING_URL: _tricket_screening(96, 91)}
    )
    availability = fetch_seat_availability(ticket_link=TRICKET_LINK)
    assert availability.seats_left == 91
    assert availability.capacity == 96
    assert availability.sold_out is False
    assert availability.platform == "tricket"
    assert len(requested) == 1


def test_tricket_zero_available_is_sold_out(monkeypatch) -> None:
    _stub_get(monkeypatch, {TRICKET_SCREENING_URL: _tricket_screening(96, 0)})
    availability = fetch_seat_availability(ticket_link=TRICKET_LINK)
    assert availability.seats_left == 0
    assert availability.sold_out is True
    assert availability.capacity == 96


def test_tricket_redirect_response_is_unknown_not_sold_out(monkeypatch) -> None:
    """A screening id Tricket has merged/moved away from returns a redirect
    payload instead of screening data — not evidence of a full house."""
    _stub_get(
        monkeypatch,
        {TRICKET_SCREENING_URL: json.dumps({"redirectTo": "/some/other/screening"})},
    )
    availability = fetch_seat_availability(ticket_link=TRICKET_LINK)
    assert availability.seats_left is None
    assert availability.sold_out is None
    assert availability.is_known is False


def test_tricket_non_json_body_raises(monkeypatch) -> None:
    _stub_get(monkeypatch, {TRICKET_SCREENING_URL: "<html>nope</html>"})
    with pytest.raises(SeatAvailabilityFetchError):
        fetch_seat_availability(ticket_link=TRICKET_LINK)


def test_tricket_response_missing_seat_data_raises(monkeypatch) -> None:
    _stub_get(monkeypatch, {TRICKET_SCREENING_URL: json.dumps({"unexpected": True})})
    with pytest.raises(SeatAvailabilityFetchError):
        fetch_seat_availability(ticket_link=TRICKET_LINK)


# --- Eagerly ----------------------------------------------------------------


def _eagerly_feed(statuses: dict[str, str], *, cinema_id: str | None = None) -> str:
    return json.dumps(
        {
            "12-monkeys": {
                "times": [
                    {
                        "provider_id": provider_id,
                        "ticket_status": status,
                        "location": "Parisienzaal",
                        "cinema_id": cinema_id,
                    }
                    for provider_id, status in statuses.items()
                ]
            }
        }
    )


def _eagerly_seat(
    *,
    selectable: bool,
    sold: bool = False,
    held: bool = False,
    seat_name: str = "1",
    row_name: str = "A",
) -> dict:
    return {
        "seat_selectable": 1 if selectable else 0,
        "seat_status": 7 if (sold or held) else 0,
        "ticket_id": 555 if sold else None,
        "seat_lock_id": 999 if held else None,
        "seat_name": seat_name,
        "row_name": row_name,
    }


@pytest.mark.parametrize(
    "status, expected_sold_out",
    [
        ("tickets available", False),
        ("sold-out", True),
        ("no-websale", False),
    ],
)
def test_eagerly_status_mapping(monkeypatch, status, expected_sold_out) -> None:
    _stub_get(
        monkeypatch,
        {"https://filmhallen.nl/fk-feed/agenda": _eagerly_feed({"197282": status})},
    )
    availability = fetch_seat_availability(ticket_link=FILMHALLEN_LINK)
    # The feed never carries a count, only a status.
    assert availability.seats_left is None
    assert availability.sold_out is expected_sold_out
    assert availability.room == "Parisienzaal"


def test_eagerly_feed_is_fetched_once_per_site(monkeypatch) -> None:
    requested = _stub_get(
        monkeypatch,
        {
            "https://filmhallen.nl/fk-feed/agenda": _eagerly_feed(
                {"197282": "tickets available", "197283": "sold-out"}
            )
        },
    )
    cache: dict = {}
    first = fetch_seat_availability(ticket_link=FILMHALLEN_LINK, feed_cache=cache)
    second = fetch_seat_availability(
        ticket_link="https://filmhallen.nl/tickets/197283/", feed_cache=cache
    )
    assert first.sold_out is False
    assert second.sold_out is True
    assert len(requested) == 1


def test_eagerly_show_missing_from_feed_is_unknown(monkeypatch) -> None:
    _stub_get(
        monkeypatch,
        {
            "https://filmhallen.nl/fk-feed/agenda": _eagerly_feed(
                {"999999": "tickets available"}
            )
        },
    )
    availability = fetch_seat_availability(ticket_link=FILMHALLEN_LINK)
    assert availability.sold_out is None
    assert availability.is_known is False


def test_eagerly_reads_exact_count_from_seat_plan(monkeypatch) -> None:
    """Filmhallen is in the booking-host table, so a known `cinema_id` from
    the feed is enough to read the real seat map instead of just a status."""
    seatplan_url = (
        "https://book.filmhallen.nl/webservices/cinema_seatplans/getSeatPlanData"
        "?cinema_id=2&mobile_device_id=00000000-0000-0000-0000-000000000000"
        "&show_time_id=197282"
    )
    _stub_get(
        monkeypatch,
        {
            "https://filmhallen.nl/fk-feed/agenda": _eagerly_feed(
                {"197282": "tickets available"}, cinema_id="2"
            ),
            seatplan_url: json.dumps(
                {
                    "data": [
                        _eagerly_seat(selectable=False),  # aisle gap, ignored
                        _eagerly_seat(selectable=True),
                        _eagerly_seat(selectable=True),
                        _eagerly_seat(selectable=True, sold=True),
                        _eagerly_seat(selectable=True, held=True),
                    ]
                }
            ),
        },
    )
    availability = fetch_seat_availability(ticket_link=FILMHALLEN_LINK)
    assert availability.seats_left == 2
    assert availability.sold_out is False
    assert availability.room == "Parisienzaal"
    # The aisle-gap row was excluded, but the sold and held seats count
    # towards the room's real total same as the free ones do.
    assert availability.capacity == 4


def test_eagerly_reading_carries_the_seats_it_counted(monkeypatch) -> None:
    """The count and the seat map come off one response, so the reading that
    pays for the count carries the map too — that is what lets the floor plan
    be served from the database instead of re-reading the ticket shop."""
    seatplan_url = (
        "https://book.filmhallen.nl/webservices/cinema_seatplans/getSeatPlanData"
        "?cinema_id=2&mobile_device_id=00000000-0000-0000-0000-000000000000"
        "&show_time_id=197282"
    )
    _stub_get(
        monkeypatch,
        {
            "https://filmhallen.nl/fk-feed/agenda": _eagerly_feed(
                {"197282": "tickets available"}, cinema_id="2"
            ),
            seatplan_url: json.dumps(
                {
                    "data": [
                        # Filler carries no seat state either way.
                        _eagerly_seat(selectable=False, row_name="A", seat_name=""),
                        _eagerly_seat(selectable=True, row_name="A", seat_name="1"),
                        _eagerly_seat(
                            selectable=True, row_name="A", seat_name="2", sold=True
                        ),
                        # A held seat is somebody's checkout hold: not buyable,
                        # so not free.
                        _eagerly_seat(
                            selectable=True, row_name="B", seat_name="1", held=True
                        ),
                    ]
                }
            ),
        },
    )
    availability = fetch_seat_availability(ticket_link=FILMHALLEN_LINK)
    assert availability.taken_seats == (("A", "2"), ("B", "1"))
    # The two halves of one reading can never disagree: free is what is left.
    assert availability.capacity == 3
    assert availability.seats_left == 1


def test_a_platform_without_a_seat_map_reports_no_seats(monkeypatch) -> None:
    """`None`, never an empty map — "did not say" is not "nothing is taken"."""
    _stub_get(
        monkeypatch,
        {
            LAB111_LINK: _zelite_page(
                header="vr 11 september 2026, 21:30 - LAB 1",
                configured_maxima=[40],
            )
        },
    )
    availability = fetch_seat_availability(ticket_link=LAB111_LINK)
    assert availability.seats_left == 40
    assert availability.taken_seats is None


def test_eagerly_wheelchair_space_does_not_count_as_a_seat(monkeypatch) -> None:
    """A "ROL" (rolstoel) entry is floor space next to a seat, not a seat
    itself; a same-section numbered companion seat is real and stays counted.
    """
    seatplan_url = (
        "https://book.filmhallen.nl/webservices/cinema_seatplans/getSeatPlanData"
        "?cinema_id=2&mobile_device_id=00000000-0000-0000-0000-000000000000"
        "&show_time_id=197282"
    )
    _stub_get(
        monkeypatch,
        {
            "https://filmhallen.nl/fk-feed/agenda": _eagerly_feed(
                {"197282": "tickets available"}, cinema_id="2"
            ),
            seatplan_url: json.dumps(
                {
                    "data": [
                        _eagerly_seat(selectable=True, seat_name="5"),
                        _eagerly_seat(selectable=True, seat_name="ROL"),
                        _eagerly_seat(selectable=True, seat_name="rol"),
                    ]
                }
            ),
        },
    )
    availability = fetch_seat_availability(ticket_link=FILMHALLEN_LINK)
    assert availability.seats_left == 1
    # The wheelchair space itself is excluded from the total too.
    assert availability.capacity == 1


def test_eagerly_seat_plan_all_taken_is_sold_out(monkeypatch) -> None:
    seatplan_url = (
        "https://book.filmhallen.nl/webservices/cinema_seatplans/getSeatPlanData"
        "?cinema_id=2&mobile_device_id=00000000-0000-0000-0000-000000000000"
        "&show_time_id=197282"
    )
    _stub_get(
        monkeypatch,
        {
            "https://filmhallen.nl/fk-feed/agenda": _eagerly_feed(
                {"197282": "tickets available"}, cinema_id="2"
            ),
            seatplan_url: json.dumps(
                {"data": [_eagerly_seat(selectable=True, sold=True)]}
            ),
        },
    )
    availability = fetch_seat_availability(ticket_link=FILMHALLEN_LINK)
    assert availability.seats_left == 0
    assert availability.sold_out is True


def test_eagerly_falls_back_to_status_when_site_has_no_booking_host(monkeypatch) -> None:
    """An Eagerly site with no booking host to ask (here an unmapped
    `cinema_id` on the one multi-cinema site) should still work at the old,
    coarser precision rather than erroring.

    The host has to be a real Eagerly one: a `/tickets/<id>` path on a host
    outside `EAGERLY_SITE_HOSTS` is not an Eagerly link at all and is not
    supported — see `test_eagerly_host_matching.py`.
    """
    link = "https://bioscopenleiden.nl/tickets/42"
    requested = _stub_get(
        monkeypatch,
        {
            "https://bioscopenleiden.nl/fk-feed/agenda": _eagerly_feed(
                {"42": "tickets available"}, cinema_id="2"
            )
        },
    )
    availability = fetch_seat_availability(ticket_link=link)
    assert availability.seats_left is None
    assert availability.sold_out is False
    assert len(requested) == 1  # only the feed, no seat-plan call attempted


def test_eagerly_falls_back_when_feed_has_no_cinema_id(monkeypatch) -> None:
    """Filmhallen is in the booking-host table, but without a `cinema_id`
    from the feed there's nothing to build the seat-plan request with."""
    requested = _stub_get(
        monkeypatch,
        {
            "https://filmhallen.nl/fk-feed/agenda": _eagerly_feed(
                {"197282": "tickets available"}
            )
        },
    )
    availability = fetch_seat_availability(ticket_link=FILMHALLEN_LINK)
    assert availability.seats_left is None
    assert len(requested) == 1


def test_eagerly_seat_plan_with_no_selectable_seats_falls_back(monkeypatch) -> None:
    """An unrecognised show id on the seat-plan side (empty/garbage data)
    should fall back to the feed's status rather than reporting 0 seats."""
    seatplan_url = (
        "https://book.filmhallen.nl/webservices/cinema_seatplans/getSeatPlanData"
        "?cinema_id=2&mobile_device_id=00000000-0000-0000-0000-000000000000"
        "&show_time_id=197282"
    )
    _stub_get(
        monkeypatch,
        {
            "https://filmhallen.nl/fk-feed/agenda": _eagerly_feed(
                {"197282": "tickets available"}, cinema_id="2"
            ),
            seatplan_url: json.dumps({"data": []}),
        },
    )
    availability = fetch_seat_availability(ticket_link=FILMHALLEN_LINK)
    assert availability.seats_left is None
    assert availability.sold_out is False


# --- Routing and failure ----------------------------------------------------


def test_unsupported_link_makes_no_request(monkeypatch) -> None:
    requested = _stub_get(monkeypatch, {})
    # Deliberately a host no platform claims. Real shop URLs make poor
    # examples here: every one of them is a platform we have not read yet,
    # and this test starts failing the day we do.
    link = "https://not-a-ticket-shop.example/showtimes/20903"
    availability = fetch_seat_availability(ticket_link=link)
    assert supports(link) is False
    assert availability.is_known is False
    assert requested == []


def test_transport_failure_raises_rather_than_reporting_zero(monkeypatch) -> None:
    def _boom(url: str):
        raise SeatAvailabilityFetchError("shop is down")

    monkeypatch.setattr(seat_availability, "_get", _boom)
    with pytest.raises(SeatAvailabilityFetchError):
        fetch_seat_availability(ticket_link=LAB111_LINK)
