from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import CurrentUser, SessionDep
from app.inputs.movie import Filters, get_filters
from app.models.auth_schemas import Message
from app.schemas.showtime import ShowtimeLoggedIn, ShowtimeSelectionUpdate
from app.schemas.showtime_visibility import (
    ShowtimeVisibilityPublic,
    ShowtimeVisibilityUpdate,
)
from app.services import showtimes as showtimes_service

router = APIRouter(prefix="/showtimes", tags=["showtimes"])


@router.put("/selection/{showtime_id}", response_model=ShowtimeLoggedIn)
def update_showtime_selection(
    *,
    session: SessionDep,
    showtime_id: int,
    payload: ShowtimeSelectionUpdate,
    current_user: CurrentUser,
    filters: Filters = Depends(get_filters),
) -> ShowtimeLoggedIn:
    should_update_seat = (
        "seat_row" in payload.model_fields_set
        or "seat_number" in payload.model_fields_set
    )
    return showtimes_service.update_showtime_selection(
        session=session,
        showtime_id=showtime_id,
        user_id=current_user.id,
        going_status=payload.going_status,
        seat_row=payload.seat_row,
        seat_number=payload.seat_number,
        update_seat=should_update_seat,
        filters=filters,
    )


@router.post("/{showtime_id}/ping/{friend_id}", response_model=Message)
def ping_friend_for_showtime(
    *,
    session: SessionDep,
    showtime_id: int,
    friend_id: UUID,
    current_user: CurrentUser,
) -> Message:
    return showtimes_service.ping_friend_for_showtime(
        session=session,
        showtime_id=showtime_id,
        actor_id=current_user.id,
        friend_id=friend_id,
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
        )
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error))


@router.get("/")
def get_main_page_showtimes(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = 20,
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
