from sqlmodel import SQLModel, Field, Relationship

from typing import TYPE_CHECKING, List, Optional
if TYPE_CHECKING:
    from .city import City, CityPublic
    from .showtime import Showtime


class CinemaBase(SQLModel):
    name: str = Field(description="Name of the cinema")
    cineville: bool = Field(default=False, description="Is this cinema a Cineville cinema?")
    badge_bg_color: Optional[str] = Field(default=None, description="Background color for the cinema badge")
    badge_text_color: Optional[str] = Field(default=None, description="Text color for the cinema badge")
    url: Optional[str] = Field(default=None, description="URL for the cinema's website or page")

class CinemaCreate(CinemaBase):
    city_id: int = Field(description="ID of the city where the cinema is located")


class Cinema(CinemaBase, table=True):
    id: int = Field(default=None, primary_key=True, unique=True, index=True, description="Unique identifier for the cinema")
    city_id: int = Field(foreign_key="city.id", description="ID of the city where the cinema is located")
    city: "City" = Relationship(back_populates="cinemas", sa_relationship_kwargs={"lazy": "joined"})
    showtimes: List["Showtime"] = Relationship(back_populates="cinema", sa_relationship_kwargs={"lazy": "noload"})

class CinemaPublic(CinemaBase):
    id: int = Field(description="Unique identifier for the cinema")
    city: "CityPublic" = Field(description="City where the cinema is located", default=None)
