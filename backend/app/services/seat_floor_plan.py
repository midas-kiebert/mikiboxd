"""Merge a room's stored floor plan with live status and personal seats."""

from urllib.parse import urlsplit

from sqlmodel import Session

from app.core.enums import GoingStatus
from app.core.viewer import ViewerId
from app.crud import showtime as showtime_crud
from app.exceptions.showtime_exceptions import ShowtimeNotFoundError
from app.models.cinema_room_floor_plan import CinemaRoomFloorPlan
from app.schemas.seat_floor_plan import SeatFloorPlanPublic, SeatFloorPlanSeatPublic
from app.scraping.logger import logger
from app.scraping.seat_availability import (
    EAGERLY_BOOKING_HOSTS,
    EAGERLY_URL_PATTERN,
    SeatAvailabilityFetchError,
    fetch_eagerly_seatplan_live_status,
)
from app.scraping.seat_availability import eagerly_shows as fetch_eagerly_shows

# One cache per process, shared across requests within its short TTL (see
# `fetch_eagerly_seatplan_live_status`'s own cache) — a per-request cache here
# would still hit the agenda feed on every call, which this also avoids.
_feed_cache: dict[str, dict] = {}


def _resolve_live_status(ticket_link: str) -> dict[tuple[str, str], bool] | None:
    """Which seats are taken right now, or None if that can't be determined.

    Reuses the exact resolution path `_fetch_eagerly` already uses for the
    aggregate count — the ticket link's own netloc names the booking host,
    and the site's agenda feed (cached) supplies the Eagerly-internal cinema
    id a showtime's `provider_id` needs. Any failure here is not fatal to the
    request: the floor plan still renders, just without live status.
    """
    match = EAGERLY_URL_PATTERN.match(ticket_link)
    if match is None:
        return None
    provider_id = match.group(1)
    netloc = urlsplit(ticket_link).netloc
    booking_host = EAGERLY_BOOKING_HOSTS.get(netloc)
    if booking_host is None:
        return None
    try:
        show = fetch_eagerly_shows(f"https://{netloc}", _feed_cache).get(provider_id)
        if show is None or show.cinema_id is None:
            return None
        return fetch_eagerly_seatplan_live_status(
            booking_host=booking_host,
            cinema_id=show.cinema_id,
            show_time_id=provider_id,
        )
    except SeatAvailabilityFetchError:
        logger.warning(f"Live seat status unavailable for {ticket_link}")
        return None


def get_seat_floor_plan(
    *, session: Session, showtime_id: int, viewer: ViewerId
) -> SeatFloorPlanPublic | None:
    """A room's seat map for one showtime, or None if this room has none.

    `None` covers every "not applicable here" case alike (room unknown, no
    floor plan ingested for it) — this is an expected, common condition for
    the vast majority of cinemas, not an error.
    """
    showtime = showtime_crud.get_showtime_by_id(session=session, showtime_id=showtime_id)
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)
    if showtime.room is None:
        return None

    plan = session.get(CinemaRoomFloorPlan, (showtime.cinema_id, showtime.room))
    if plan is None:
        return None

    live_status = _resolve_live_status(showtime.ticket_link)

    viewer_seat: tuple[str, str] | None = None
    if viewer is not None:
        selection = showtime_crud.get_showtime_selection(
            session=session, showtime_id=showtime_id, user_id=viewer
        )
        if selection is not None and selection.seat_row and selection.seat_number:
            viewer_seat = (selection.seat_row.strip(), selection.seat_number.strip())

    # Not who — just how many, per seat.
    friend_count_by_seat: dict[tuple[str, str], int] = {}
    if viewer is not None:
        friends_going = showtime_crud.get_friends_for_showtime(
            session=session,
            showtime_id=showtime_id,
            user_id=viewer,
            going_status=GoingStatus.GOING,
        )
        selections_by_user = showtime_crud.get_showtime_selections_for_users(
            session=session,
            showtime_id=showtime_id,
            user_ids=[friend.id for friend in friends_going],
        )
        for selection in selections_by_user.values():
            if not selection.seat_row or not selection.seat_number:
                continue
            key = (selection.seat_row.strip(), selection.seat_number.strip())
            friend_count_by_seat[key] = friend_count_by_seat.get(key, 0) + 1

    seats = []
    for seat in plan.seats:
        key = (str(seat["row_name"]).strip(), str(seat["seat_name"]).strip())
        seats.append(
            SeatFloorPlanSeatPublic(
                row_name=seat["row_name"],
                seat_name=seat["seat_name"],
                position_left=seat["position_left"],
                position_top=seat["position_top"],
                width=seat["width"],
                height=seat["height"],
                selectable=seat["selectable"],
                taken=live_status.get(key) if live_status is not None else None,
                is_viewer_seat=key == viewer_seat,
                friend_count=friend_count_by_seat.get(key, 0),
            )
        )

    return SeatFloorPlanPublic(
        showtime_id=showtime_id, room=showtime.room, seats=seats
    )
