from fastapi import APIRouter, Query

from app.api.deps import (
    CurrentUser,
    SessionDep,
)
from app.models.user import UserRegister
from app.schemas.user import UserPublic, UserWithFriendStatus
from app.services import users as users_service

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
