from typing import TYPE_CHECKING

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from .city import City

__all__ = [
    "CinemaBase",
    "CinemaCreate",
    "Cinema",
]


class CinemaBase(SQLModel):
    name: str = Field(description="Name of the cinema")
    cineville: bool
    badge_bg_color: str
    badge_text_color: str
    url: str


class CinemaCreate(CinemaBase):
    city_id: int = Field(description="ID of the city where the cinema is located")


class Cinema(CinemaBase, table=True):
    id: int = Field(
        primary_key=True,
        unique=True,
        index=True,
    )
    city_id: int = Field(foreign_key="city.id")
    city: "City" = Relationship(sa_relationship_kwargs={"lazy": "joined"})
