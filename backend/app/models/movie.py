from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship, SQLModel
from pydantic import Field as PydanticField

if TYPE_CHECKING:
    from .showtime import Showtime, ShowtimeInMoviePublic


# Shared properties
class MovieBase(SQLModel):
    id: int = Field(
        unique=True, index=True, primary_key=True, description="TMDB ID of the movie"
    )
    title: str = PydanticField(description="Title of the movie")
    poster_link: Optional[str] = PydanticField(
        default=None, description="Link to the movie poster"
    )
    letterboxd_slug: Optional[str] = PydanticField(
        default=None, description="Letterboxd slug for the movie"
    )


# Properties to receive on movie creation
class MovieCreate(MovieBase):
    pass


# Properties to receive on movie update
class MovieUpdate(SQLModel):
    title: str | None = PydanticField(default=None, description="Title of the movie")
    poster_link: str | None = PydanticField(
        default=None, description="Link to the movie poster"
    )
    letterboxd_slug: Optional[str] = PydanticField(
        default=None, description="Letterboxd slug for the movie"
    )


# Database model, database table inferred from class name
class Movie(MovieBase, table=True):
    showtimes: list["Showtime"] = Relationship(
        back_populates="movie",
        cascade_delete=True,
        sa_relationship_kwargs={"lazy": "noload"},
    )


class MovieSummaryPublic(MovieBase):
    showtimes: list["ShowtimeInMoviePublic"] = PydanticField(
        default=[], description="List of showtimes associated with the movie"
    )


class MoviePublic(MovieBase):
    showtimes_with_friends: list["ShowtimeInMoviePublic"] = PydanticField(
        default=[],
        description="List of showtimes associated with the movie where friends are going",
    )
    showtime_without_friends: list["ShowtimeInMoviePublic"] = PydanticField(
        default=[],
        description="List of showtimes associated with the movie without friends going",
    )
