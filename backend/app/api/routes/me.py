from datetime import datetime

from fastapi import APIRouter, HTTPException

from app.api.deps import (
    CurrentUser,
    SessionDep,
)
from app.converters import user as user_converters
from app.core.security import get_password_hash, verify_password
from app.models.auth_schemas import Message, UpdatePassword, UserUpdateMe
from app.schemas.showtime import ShowtimeLoggedIn
from app.schemas.user import UserPublic
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
    *, session: SessionDep, user_in: UserUpdateMe, current_user: CurrentUser
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
    snapshot_time: datetime = now_amsterdam_naive(),
) -> list[ShowtimeLoggedIn]:
    return users_service.get_selected_showtimes(
        session=session,
        user_id=current_user.id,
        snapshot_time=snapshot_time,
    )


@router.put("/watchlist", response_model=Message)
def sync_watchlist(
    session: SessionDep,
    current_user: CurrentUser,
) -> Message:
    watchlist_service.sync_watchlist(session=session, user_id=current_user.id)
    return Message(message="Watchlist synced successfully")


@router.get("/friends", response_model=list[UserPublic])
def get_friends(*, session: SessionDep, current_user: CurrentUser) -> list[UserPublic]:
    return users_service.get_friends(session=session, user_id=current_user.id)


@router.get("/requests/sent")
def get_sent_friend_requests(
    *,
    session: SessionDep,
    current_user: CurrentUser,
) -> list[UserPublic]:
    return users_service.get_sent_friend_requests(
        session=session, user_id=current_user.id
    )


@router.get("/requests/received")
def get_received_friend_requests(
    *,
    session: SessionDep,
    current_user: CurrentUser,
) -> list[UserPublic]:
    return users_service.get_received_friend_requests(
        session=session, user_id=current_user.id
    )
