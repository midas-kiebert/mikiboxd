import uuid

from fastapi import APIRouter

from app.api.deps import (
    CurrentUser,
    SessionDep,
)
from app.models.auth_schemas import Message
from app.services import friends as friends_service

router = APIRouter(prefix="/friends", tags=["friends"])


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
