from sqlmodel import SQLModel

__all__ = [
    "FriendStatusSharingUpdate",
]


class FriendStatusSharingUpdate(SQLModel):
    # True (default) shows your status to this friend under ALL_FRIENDS; False
    # opts out, so they only see your status when invited.
    shares_status: bool
