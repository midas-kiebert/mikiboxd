from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import (
    CurrentUser,
    SessionDep,
)
from app.converters import user as user_converters
from app.core.security import get_password_hash, verify_password
from app.models.auth_schemas import Message, UpdatePassword
from app.models.user import UserUpdate
from app.schemas.showtime import ShowtimeLoggedIn
from app.schemas.user import UserPublic, UserWithFriendStatus
from app.services import me as me_service
from app.services import users as users_service
from app.services import watchlist as watchlist_service
from app.utils import now_amsterdam_naive

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/", response_model=UserPublic)
def get_current_user(current_user: CurrentUser) -> UserPublic:
    return user_converters.to_public(current_user)


@router.delete("/", response_model=Message)
def delete_user_me(session: SessionDep, current_user: CurrentUser) -> Message:
    if current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="Super users are not allowed to delete themselves"
        )
    session.delete(current_user)
    session.commit()
    return Message(message="User deleted successfully")


@router.patch("/", response_model=UserPublic)
def update_user_me(
    *, session: SessionDep, user_in: UserUpdate, current_user: CurrentUser
) -> UserPublic:
    return me_service.update_me(
        session=session, user_in=user_in, current_user=current_user
    )


@router.patch("/password", response_model=Message)
def update_password_me(
    *, session: SessionDep, body: UpdatePassword, current_user: CurrentUser
) -> Message:
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect password")
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=400, detail="New password cannot be the same as the current one"
        )
    hashed_password = get_password_hash(body.new_password)
    current_user.hashed_password = hashed_password
    session.add(current_user)
    session.commit()
    return Message(message="Password updated successfully")


@router.get("/showtimes", response_model=list[ShowtimeLoggedIn])
def get_my_showtimes(
    session: SessionDep,
    current_user: CurrentUser,
    snapshot_time: datetime = Query(default_factory=now_amsterdam_naive),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
) -> list[ShowtimeLoggedIn]:
    return users_service.get_selected_showtimes(
        session=session,
        user_id=current_user.id,
        current_user_id=current_user.id,
        snapshot_time=snapshot_time,
        limit=limit,
        offset=offset,
    )


@router.put("/watchlist", response_model=Message)
def sync_watchlist(
    session: SessionDep,
    current_user: CurrentUser,
) -> Message:
    watchlist_service.sync_watchlist(session=session, user_id=current_user.id)
    return Message(message="Watchlist synced successfully")


@router.get("/friends", response_model=list[UserWithFriendStatus])
def get_friends(
    *, session: SessionDep, current_user: CurrentUser
) -> list[UserWithFriendStatus]:
    return users_service.get_friends(session=session, user_id=current_user.id)


@router.get("/requests/sent")
def get_sent_friend_requests(
    *,
    session: SessionDep,
    current_user: CurrentUser,
) -> list[UserWithFriendStatus]:
    return users_service.get_sent_friend_requests(
        session=session, user_id=current_user.id
    )


@router.get("/requests/received")
def get_received_friend_requests(
    *,
    session: SessionDep,
    current_user: CurrentUser,
) -> list[UserWithFriendStatus]:
    return users_service.get_received_friend_requests(
        session=session, user_id=current_user.id
    )


@router.get("/cinemas", response_model=list[int])
def get_cinema_selections(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[int]:
    """
    Get the IDs of cinemas selected by the current user.

    Parameters:
        session (SessionDep): The SQLAlchemy session to use for the operation.
        current_user (CurrentUser): The currently authenticated user.

    Returns:
        list[int]: List of cinema IDs selected by the user.
    """
    return users_service.get_selected_cinemas_ids(
        session=session, user_id=current_user.id
    )


@router.post("/cinemas", response_model=Message)
def set_cinema_selections(
    session: SessionDep,
    current_user: CurrentUser,
    cinema_ids: list[int],
) -> Message:
    """
    Set the cinemas selected by the current user.

    Parameters:
        session (SessionDep): The SQLAlchemy session to use for the operation.
        current_user (CurrentUser): The currently authenticated user.
        cinema_ids (list[int]): List of cinema IDs to set as selected.

    Returns:
        Message: Confirmation message indicating success.
    """
    users_service.set_cinema_selections(
        session=session, user_id=current_user.id, cinema_ids=cinema_ids
    )
    return Message(message="Cinemas updated successfully")
