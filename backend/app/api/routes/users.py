from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Query

from app.api.deps import (
    CurrentUser,
    SessionDep,
)
from app.models.user import UserRegister
from app.schemas.showtime import ShowtimeLoggedIn
from app.schemas.user import UserPublic, UserWithFriendStatus
from app.services import users as users_service
from app.utils import now_amsterdam_naive

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/search", response_model=list[UserWithFriendStatus])
def search_users(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    query: str = Query(..., min_length=1),
    offset: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=50),
) -> list[UserWithFriendStatus]:
    return users_service.get_users(
        session=session,
        current_user_id=current_user.id,
        query=query,
        offset=offset,
        limit=limit,
    )


@router.post("/signup", response_model=UserPublic)
def register_user(*, session: SessionDep, user_in: UserRegister) -> UserPublic:
    return users_service.register_user(
        session=session,
        user_in=user_in,
    )


@router.get("/{user_id}/showtimes", response_model=list[ShowtimeLoggedIn])
def get_user_selected_showtimes(
    session: SessionDep,
    current_user: CurrentUser,
    user_id: UUID,
    snapshot_time: datetime = now_amsterdam_naive(),
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
) -> list[ShowtimeLoggedIn]:
    return users_service.get_selected_showtimes(
        session=session,
        user_id=user_id,
        snapshot_time=snapshot_time,
        limit=limit,
        offset=offset,
        current_user_id=current_user.id,
    )
