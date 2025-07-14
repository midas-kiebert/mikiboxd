from typing import Any, Sequence

from fastapi import APIRouter, HTTPException

from app import crud
from app.api.deps import (
    CurrentUser,
    SessionDep,
)
from app.models import (
    Message,
    UserPublic,
    ShowtimePublic
)

router = APIRouter(prefix="/me", tags=["me"])

@router.get("/", response_model=UserPublic)
def get_current_user(
    current_user: CurrentUser
) -> UserPublic:
    """
    Get the current user's profile.
    """
    return UserPublic.model_validate(current_user)


@router.delete("/", response_model=Message)
def delete_user_me(session: SessionDep, current_user: CurrentUser) -> Any:
    """
    Delete own user.
    """
    if current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="Super users are not allowed to delete themselves"
        )
    session.delete(current_user)
    session.commit()
    return Message(message="User deleted successfully")


@router.get("/showtimes", response_model=list[ShowtimePublic])
def get_my_showtimes(
    session: SessionDep,
    current_user: CurrentUser,
) -> Sequence[ShowtimePublic]:
    """
    Get all showtimes selected by the current user.
    """
    showtimes = crud.get_selected_showtimes_for_user(
        session=session,
        user_id=current_user.id
    )
    showtimes_public = [
        ShowtimePublic.model_validate(showtime) for showtime in showtimes
    ]
    return showtimes_public