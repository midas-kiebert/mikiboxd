"""Showtime endpoints."""

import asyncio
import os
import threading
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi import status as http_status

from app.api.deps import CurrentUser, SessionDep, get_db_context
from app.crud import showtime as showtimes_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.inputs.movie import Filters, get_filters
from app.models.auth_schemas import Message
from app.schemas.showtime import ShowtimeLoggedIn, ShowtimeSelectionUpdate
from app.schemas.showtime_ping import SentShowtimePingPublic
from app.schemas.showtime_visibility import (
    ShowtimeVisibilityPublic,
    ShowtimeVisibilityUpdate,
)
from app.services import push_notifications
from app.services import showtimes as showtimes_service

router = APIRouter(prefix="/showtimes", tags=["showtimes"])

# Ping IDs added here before deletion suppress the pending notification.
# In-memory so the background task never needs a second DB round-trip,
# which also keeps test transaction isolation intact.
_cancelled_ping_ids: set[int] = set()
_cancelled_ping_ids_lock = threading.Lock()


_PING_NOTIFICATION_DELAY_SECONDS = 0 if os.getenv("TESTING") == "true" else 5  # noqa: SIM210


@router.put("/selection/{showtime_id}", response_model=ShowtimeLoggedIn)
def update_showtime_selection(
    *,
    session: SessionDep,
    showtime_id: int,
    payload: ShowtimeSelectionUpdate,
    current_user: CurrentUser,
) -> ShowtimeLoggedIn:
    should_update_seat = (
        "seat_row" in payload.model_fields_set
        or "seat_number" in payload.model_fields_set
    )
    try:
        return showtimes_service.update_showtime_selection(
            session=session,
            showtime_id=showtime_id,
            user_id=current_user.id,
            going_status=payload.going_status,
            seat_row=payload.seat_row,
            seat_number=payload.seat_number,
            visible_friend_ids=payload.visible_friend_ids,
            visible_group_ids=payload.visible_group_ids,
            update_seat=should_update_seat,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail=str(error)
        )


async def _notify_after_delay(
    ping_id: int,
    sender_id: UUID,
    receiver_id: UUID,
    showtime_id: int,
) -> None:
    """Send the invite push notification after a short grace window.

    Uninviting within that window adds the ping ID to _cancelled_ping_ids
    which this task checks before sending — no second DB round-trip needed.
    """
    await asyncio.sleep(_PING_NOTIFICATION_DELAY_SECONDS)
    with _cancelled_ping_ids_lock:
        if ping_id in _cancelled_ping_ids:
            _cancelled_ping_ids.discard(ping_id)
            return
    with get_db_context() as session:
        showtime = showtimes_crud.get_showtime_by_id(
            session=session, showtime_id=showtime_id
        )
        if showtime is None:
            return
        push_notifications.notify_user_on_showtime_ping(
            session=session,
            sender_id=sender_id,
            receiver_id=receiver_id,
            showtime=showtime,
        )


@router.post("/{showtime_id}/ping/{friend_id}", response_model=Message)
def ping_friend_for_showtime(
    *,
    session: SessionDep,
    background_tasks: BackgroundTasks,
    showtime_id: int,
    friend_id: UUID,
    current_user: CurrentUser,
) -> Message:
    message, ping_id = showtimes_service.ping_friend_for_showtime(
        session=session,
        showtime_id=showtime_id,
        actor_id=current_user.id,
        friend_id=friend_id,
    )
    background_tasks.add_task(
        _notify_after_delay,
        ping_id=ping_id,
        sender_id=current_user.id,
        receiver_id=friend_id,
        showtime_id=showtime_id,
    )
    return message


@router.post("/{showtime_id}/ping-group/{group_id}", response_model=Message)
def ping_friend_group_for_showtime(
    *,
    session: SessionDep,
    showtime_id: int,
    group_id: UUID,
    current_user: CurrentUser,
) -> Message:
    message = showtimes_service.ping_friend_group_for_showtime(
        session=session,
        showtime_id=showtime_id,
        actor_id=current_user.id,
        group_id=group_id,
    )
    if message is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Friend group not found"
        )
    return message


@router.post("/{showtime_id}/ping-link/{sender_identifier}", response_model=Message)
def receive_ping_from_link(
    *,
    session: SessionDep,
    showtime_id: int,
    sender_identifier: str,
    current_user: CurrentUser,
) -> Message:
    return showtimes_service.receive_ping_from_link(
        session=session,
        showtime_id=showtime_id,
        receiver_id=current_user.id,
        sender_identifier=sender_identifier,
    )


@router.get("/{showtime_id}/pinged-friends", response_model=list[UUID])
def get_pinged_friend_ids_for_showtime(
    *,
    session: SessionDep,
    showtime_id: int,
    current_user: CurrentUser,
) -> list[UUID]:
    return showtimes_service.get_pinged_friend_ids_for_showtime(
        session=session,
        showtime_id=showtime_id,
        actor_id=current_user.id,
    )


@router.get("/{showtime_id}/sent-pings", response_model=list[SentShowtimePingPublic])
def get_sent_pings_for_showtime(
    *,
    session: SessionDep,
    showtime_id: int,
    current_user: CurrentUser,
) -> list[SentShowtimePingPublic]:
    return showtimes_service.get_sent_pings_for_showtime(
        session=session,
        showtime_id=showtime_id,
        actor_id=current_user.id,
    )


@router.delete("/{showtime_id}/ping/{friend_id}", response_model=Message)
def uninvite_friend_from_showtime(
    *,
    session: SessionDep,
    showtime_id: int,
    friend_id: UUID,
    current_user: CurrentUser,
) -> Message:
    # Look up the ping ID before deleting so we can cancel the pending notification.
    existing = showtime_ping_crud.get_showtime_ping(
        session=session,
        showtime_id=showtime_id,
        sender_id=current_user.id,
        receiver_id=friend_id,
    )
    if existing is not None and existing.id is not None:
        with _cancelled_ping_ids_lock:
            _cancelled_ping_ids.add(existing.id)

    deleted = showtimes_service.uninvite_friend_from_showtime(
        session=session,
        showtime_id=showtime_id,
        actor_id=current_user.id,
        friend_id=friend_id,
    )
    if not deleted:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Invite not found"
        )
    return Message(message="Invite cancelled successfully")


@router.get("/visibility/batch", response_model=list[ShowtimeVisibilityPublic])
def get_showtime_visibility_batch(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    showtime_ids: list[int] = Query(default=[]),
) -> list[ShowtimeVisibilityPublic]:
    return showtimes_service.get_showtime_visibility_batch(
        session=session,
        showtime_ids=showtime_ids,
        actor_id=current_user.id,
    )


@router.get("/{showtime_id}/visibility", response_model=ShowtimeVisibilityPublic)
def get_showtime_visibility(
    *,
    session: SessionDep,
    showtime_id: int,
    current_user: CurrentUser,
) -> ShowtimeVisibilityPublic:
    return showtimes_service.get_showtime_visibility(
        session=session,
        showtime_id=showtime_id,
        actor_id=current_user.id,
    )


@router.put("/{showtime_id}/visibility", response_model=ShowtimeVisibilityPublic)
def update_showtime_visibility(
    *,
    session: SessionDep,
    showtime_id: int,
    payload: ShowtimeVisibilityUpdate,
    current_user: CurrentUser,
) -> ShowtimeVisibilityPublic:
    try:
        return showtimes_service.update_showtime_visibility(
            session=session,
            showtime_id=showtime_id,
            actor_id=current_user.id,
            visible_friend_ids=payload.visible_friend_ids,
            visible_group_ids=payload.visible_group_ids,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST, detail=str(error)
        )


@router.get("/count")
def count_main_page_showtimes(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    filters: Filters = Depends(get_filters),
) -> int:
    return showtimes_service.count_main_page_showtimes(
        session=session,
        current_user_id=current_user.id,
        filters=filters,
    )


@router.get("/")
def get_main_page_showtimes(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = 10,
    offset: int = 0,
    filters: Filters = Depends(get_filters),
) -> list[ShowtimeLoggedIn]:
    return showtimes_service.get_main_page_showtimes(
        session=session,
        current_user_id=current_user.id,
        limit=limit,
        offset=offset,
        filters=filters,
    )
