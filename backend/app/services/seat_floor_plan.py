"""Merge a room's stored floor plan with the last seat reading and personal seats."""

from sqlmodel import Session

from app.core.enums import GoingStatus
from app.core.viewer import ViewerId
from app.crud import showtime as showtime_crud
from app.crud import showtime_seat_map as seat_map_crud
from app.exceptions.showtime_exceptions import ShowtimeNotFoundError
from app.models.cinema_room_floor_plan import CinemaRoomFloorPlan
from app.schemas.seat_floor_plan import SeatFloorPlanPublic, SeatFloorPlanSeatPublic


def get_seat_floor_plan(
    *, session: Session, showtime_id: int, viewer: ViewerId
) -> SeatFloorPlanPublic | None:
    """A room's seat map for one showtime, or None if this room has none.

    Nothing here touches a ticket shop. Which seats are taken comes from the
    last reading the availability poller took (`ShowtimeSeatMap`), the same one
    the "31 of 111 seats left" badge is drawn from — so the two always agree,
    and opening the seat picker costs a primary-key lookup rather than a live
    request to a small cinema's booking system. Freshness is the poller's job
    and its cadence, which is why `seats_checked_at` is handed to the client
    alongside the seats.

    `None` covers every "not applicable here" case alike (room unknown, no
    floor plan ingested for it) — this is an expected, common condition for
    the vast majority of cinemas, not an error.
    """
    showtime = showtime_crud.get_showtime_by_id(
        session=session, showtime_id=showtime_id
    )
    if showtime is None:
        raise ShowtimeNotFoundError(showtime_id)
    # `room_key` rather than `room`: for most platforms the two are the same
    # string, but Ticketlab's shops mostly print no room name at all, and
    # there the key is the only thing that says which room this is. Either
    # way it is the availability poller that fills it in, so a showtime that
    # has never been polled has no seat map yet — the same condition that
    # leaves it with no seat count.
    if showtime.room_key is None:
        return None

    plan = session.get(CinemaRoomFloorPlan, (showtime.cinema_id, showtime.room_key))
    if plan is None:
        return None

    # No reading yet (or a platform that never reports per-seat state) leaves
    # every seat's status unknown rather than free — a seat map that invents
    # free seats is worse than one that admits it doesn't know.
    seat_map = seat_map_crud.get_seat_map(session=session, showtime_id=showtime_id)
    taken_seats: set[tuple[str, str]] | None = None
    if seat_map is not None:
        taken_seats = {
            (str(row).strip(), str(seat).strip()) for row, seat in seat_map.taken
        }

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
                taken=key in taken_seats if taken_seats is not None else None,
                is_viewer_seat=key == viewer_seat,
                friend_count=friend_count_by_seat.get(key, 0),
            )
        )

    return SeatFloorPlanPublic(
        showtime_id=showtime_id,
        # The showtime's own label first — a scraper that knows the room
        # names it the way the cinema's own programme does — and the plan's
        # otherwise. Null when neither has a name for it, which is the normal
        # case on Ticketlab.
        room=showtime.room or plan.room_name,
        seats=seats,
        screen_side=plan.screen_side,
        seats_checked_at=seat_map.checked_at if seat_map is not None else None,
    )
