from sqlmodel import SQLModel

__all__ = [
    "FriendFavoriteUpdate",
]


class FriendFavoriteUpdate(SQLModel):
    is_favorite: bool
