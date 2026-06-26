"""User Endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse

from app.api.deps import (
    CurrentUser,
    SessionDep,
)
from app.core.security import verify_watchlist_digest_unsubscribe_token
from app.crud import user as users_crud
from app.inputs.movie import Filters, get_filters
from app.models.user import UserRegister
from app.schemas.showtime import ShowtimeLoggedIn
from app.schemas.user import UserPublic, UserWithFriendStatus
from app.services import users as users_service

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/unsubscribe-watchlist-digest", response_class=HTMLResponse)
def unsubscribe_watchlist_digest(session: SessionDep, token: str) -> HTMLResponse:
    """One-click unsubscribe from watchlist digest emails, linked from the email itself.

    No authentication — the signed token in the link is what proves the
    request is for that specific user's account.
    """
    email = verify_watchlist_digest_unsubscribe_token(token)
    if email is None:
        return HTMLResponse("<p>This unsubscribe link is invalid.</p>", status_code=400)
    user = users_crud.get_user_by_email(session=session, email=email)
    if user is not None and user.notify_watchlist_digest_enabled:
        user.notify_watchlist_digest_enabled = False
        session.add(user)
        session.commit()
    return HTMLResponse("<p>You will no longer receive watchlist digest emails.</p>")


@router.get("/search", response_model=list[UserWithFriendStatus])
def search_users(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    query: str = Query(...),
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


@router.get("/{user_id}", response_model=UserPublic)
def get_user(
    session: SessionDep,
    user_id: UUID,
) -> UserPublic:
    """Get a user by their ID."""
    return users_service.get_user(
        session=session,
        user_id=user_id,
    )


@router.get("/{user_id}/showtimes", response_model=list[ShowtimeLoggedIn])
def get_user_selected_showtimes(
    session: SessionDep,
    current_user: CurrentUser,
    user_id: UUID,
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    filters: Filters = Depends(get_filters),
) -> list[ShowtimeLoggedIn]:
    return users_service.get_selected_showtimes(
        session=session,
        user_id=user_id,
        limit=limit,
        offset=offset,
        current_user_id=current_user.id,
        filters=filters,
    )
