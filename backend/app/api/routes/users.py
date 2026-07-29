"""User Endpoints."""

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import HTMLResponse

from app.api.deps import (
    CurrentUser,
    SessionDep,
)
from app.core.security import (
    verify_email_verification_token,
    verify_watchlist_digest_unsubscribe_token,
)
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


@router.get("/verify-email", response_class=HTMLResponse)
def verify_email(session: SessionDep, token: str) -> HTMLResponse:
    """Confirm an email address from the link mailed at registration.

    No authentication — the signed token in the link is what proves the request
    came from someone reading that mailbox, which is the whole point of it.
    Already-verified accounts are answered the same way as a fresh confirmation:
    a second click on the same link is a normal thing to do, and it has the
    outcome the user wanted either way.
    """
    email = verify_email_verification_token(token)
    if email is None:
        return HTMLResponse(
            "<p>This confirmation link is invalid or has expired. "
            "You can ask for a new one from the app.</p>",
            status_code=400,
        )
    user = users_crud.get_user_by_email(session=session, email=email)
    if user is None:
        return HTMLResponse(
            "<p>This confirmation link is invalid.</p>", status_code=400
        )
    if not user.email_verified:
        user.email_verified = True
        session.add(user)
        session.commit()
    return HTMLResponse("<p>Thanks — your email address is confirmed.</p>")


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


@router.get("/{user_id}/friend-status", response_model=UserWithFriendStatus)
def get_user_friend_status(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    user_id: UUID,
) -> UserWithFriendStatus:
    """A single user's friendship/request status relative to the current user.

    Polled by e.g. a showtime's "Invited" list so a status change made
    elsewhere (the other side accepted/declined) is noticed without
    refetching the whole showtime.
    """
    return users_service.get_user_friend_status(
        session=session,
        current_user_id=current_user.id,
        user_id=user_id,
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
