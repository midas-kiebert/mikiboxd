import uuid

from fastapi import APIRouter, HTTPException
from fastapi import status as http_status
from fastapi.responses import HTMLResponse

from app.api.deps import (
    CurrentUser,
    SessionDep,
)
from app.core.config import settings
from app.models.auth_schemas import Message
from app.models.user import User
from app.schemas.friendship import FriendStatusSharingUpdate
from app.services import friends as friends_service
from app.services.share_preview import (
    DEFAULT_SHARE_PREVIEW_IMAGE,
    render_share_preview_html,
)

router = APIRouter(prefix="/friends", tags=["friends"])


@router.get(
    "/invite-preview/{user_id}",
    response_class=HTMLResponse,
    include_in_schema=False,
)
def get_friend_invite_preview(*, session: SessionDep, user_id: uuid.UUID) -> HTMLResponse:
    """Unauthenticated HTML page carrying per-inviter OpenGraph tags.

    Only ever hit by link-preview crawlers (WhatsApp, iMessage, Slack, ...) —
    nginx routes them here based on User-Agent instead of the SPA's static
    index.html, which is the same generic card for every invite link.
    """
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    inviter_name = user.display_name or "Someone"
    body = render_share_preview_html(
        title=f"{inviter_name} wants to be friends on MiKiNO",
        description="Accept to see what they're watching and going to.",
        image_url=DEFAULT_SHARE_PREVIEW_IMAGE,
        page_url=f"{settings.FRONTEND_HOST}/add-friend/{user_id}",
    )
    return HTMLResponse(content=body)


@router.post("/request/{receiver_id}")
def send_friend_request(
    *, session: SessionDep, current_user: CurrentUser, receiver_id: uuid.UUID
) -> Message:
    return friends_service.create_friend_request(
        session=session,
        sender_id=current_user.id,
        receiver_id=receiver_id,
    )


@router.post("/accept/{sender_id}")
def accept_friend_request(
    *, session: SessionDep, current_user: CurrentUser, sender_id: uuid.UUID
) -> Message:
    return friends_service.accept_friend_request(
        session=session,
        current_user_id=current_user.id,
        sender_id=sender_id,
    )


@router.post("/decline/{sender_id}")
def decline_friend_request(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    sender_id: uuid.UUID,
) -> Message:
    return friends_service.decline_friend_request(
        session=session,
        current_user=current_user.id,
        sender_id=sender_id,
    )


@router.delete("/cancel/{receiver_id}")
def cancel_friend_request(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    receiver_id: uuid.UUID,
) -> Message:
    return friends_service.cancel_friend_request(
        session=session,
        current_user=current_user.id,
        receiver_id=receiver_id,
    )


@router.put("/{friend_id}/status-visibility")
def set_friend_status_sharing(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    friend_id: uuid.UUID,
    payload: FriendStatusSharingUpdate,
) -> Message:
    return friends_service.set_friend_status_sharing(
        session=session,
        current_user=current_user.id,
        friend_id=friend_id,
        shares_status=payload.shares_status,
    )


@router.delete("/{friend_id}")
def remove_friend(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    friend_id: uuid.UUID,
) -> Message:
    return friends_service.remove_friend(
        session=session,
        current_user=current_user.id,
        friend_id=friend_id,
    )
