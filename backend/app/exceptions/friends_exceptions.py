from uuid import UUID

from fastapi import status

from .base import AppError


class FriendRequestNotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND

    def __init__(self, sender_id: UUID, receiver_id: UUID):
        detail = f"Friend request not found. User with id {sender_id} has not requested friendship with user {receiver_id}."
        super().__init__(detail)


class FriendshipNotFoundError(AppError):
    status_code = status.HTTP_404_NOT_FOUND

    def __init__(self, user_id: UUID, friend_id: UUID):
        detail = f"Friendship not found. User with id {user_id} is not friends with user with id {friend_id}."
        super().__init__(detail)


class FriendshipAlreadyExistsError(AppError):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, user_id: UUID, friend_id: UUID):
        detail = f"Friendship already exists. User with id {user_id} is already friends with user with id {friend_id}."
        super().__init__(detail)


class FriendRequestAlreadyExistsError(AppError):
    status_code = status.HTTP_409_CONFLICT

    def __init__(self, sender_id: UUID, receiver_id: UUID):
        detail = f"Friend request already exists. User with id {sender_id} has already requested friendship with user {receiver_id}."
        super().__init__(detail)
