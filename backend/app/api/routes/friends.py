import uuid

from fastapi import APIRouter, HTTPException

from app import crud
from app.api.deps import (
    CurrentUser,
    SessionDep,
)
from app.models import (
    UsersPublic,
)

router = APIRouter(prefix="/friends", tags=["friends"])

@router.post("/request/{receiver_id}")
def send_friend_request(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    receiver_id: uuid.UUID
):
    """
    Send a friend request to another user.
    """
    try:
        crud.send_friend_request(
            session=session,
            sender_id=current_user.id,
            receiver_id=receiver_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "Friend request sent successfully."}

@router.post("/accept/{sender_id}")
def accept_friend_request(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    sender_id: uuid.UUID
):
    """
    Accept a friend request from another user.
    """
    try:
        crud.accept_friend_request(
            session=session,
            receiver_id=current_user.id,
            sender_id=sender_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "Friend request accepted successfully."}

@router.post("/decline/{sender_id}")
def decline_friend_request(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    sender_id: uuid.UUID
):
    """
    Decline a friend request from another user.
    """
    try:
        crud.delete_friend_request(
            session=session,
            receiver_id=current_user.id,
            sender_id=sender_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "Friend request declined successfully."}


@router.delete("/cancel/{receiver_id}")
def cancel_friend_request(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    receiver_id: uuid.UUID
):
    """
    Cancel a sent friend request.
    """
    try:
        crud.delete_friend_request(
            session=session,
            sender_id=current_user.id,
            receiver_id=receiver_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "Friend request cancelled successfully."}


@router.delete("/{friend_id}")
def remove_friend(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    friend_id: uuid.UUID
):
    """
    Remove a friend from your friend list.
    """
    try:
        crud.delete_friendship(
            session=session,
            user_id=current_user.id,
            friend_id=friend_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": "Friend removed successfully."}


@router.get("/")
def get_friends(
    *,
    session: SessionDep,
    current_user: CurrentUser
) -> UsersPublic:
    """
    Get the list of friends for the current user.
    """
    friends = crud.get_friends(session=session, user_id=current_user.id)
    return UsersPublic(data=friends, count=len(friends))


@router.get("/requests/sent")
def get_sent_friend_requests(
    *,
    session: SessionDep,
    current_user: CurrentUser
) -> UsersPublic:
    """
    Get the list of sent friend requests for the current user.
    """
    requests = crud.get_sent_friend_requests(session=session, user_id=current_user.id)
    return UsersPublic(data=requests, count=len(requests))


@router.get("/requests/received")
def get_received_friend_requests(
    *,
    session: SessionDep,
    current_user: CurrentUser
) -> UsersPublic:
    """
    Get the list of received friend requests for the current user.
    """
    requests = crud.get_received_friend_requests(session=session, user_id=current_user.id)
    return UsersPublic(data=requests, count=len(requests))