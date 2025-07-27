from datetime import datetime
from typing import TYPE_CHECKING, Optional

from sqlmodel import Field, Relationship, SQLModel

if TYPE_CHECKING:
    from .cinema import CinemaPublic
    from .showtime import Showtime, ShowtimeInMoviePublic
    from .user import UserPublic


# Shared properties
class MovieBase(SQLModel):
    id: int = Field(
        unique=True, index=True, primary_key=True, description="TMDB ID of the movie"
    )
    title: str = Field(description="Title of the movie")
    poster_link: Optional[str] = Field(
        default=None, description="Link to the movie poster"
    )
    letterboxd_slug: Optional[str] = Field(
        default=None, description="Letterboxd slug for the movie"
    )


# Properties to receive on movie creation
class MovieCreate(MovieBase):
    pass


# Properties to receive on movie update
class MovieUpdate(SQLModel):
    title: str | None = Field(default=None, description="Title of the movie")
    poster_link: str | None = Field(
        default=None, description="Link to the movie poster"
    )
    letterboxd_slug: Optional[str] = Field(
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
    showtimes: list["ShowtimeInMoviePublic"] = Field(
        default=[], description="List of showtimes associated with the movie"
    )
    cinemas: list["CinemaPublic"] = Field(
        default=[], description="List of cinemas where the movie is showing"
    )
    last_showtime_datetime: datetime | None = Field(
        default=None,
        description="Datetime of the last showtime for the movie",
    )
    total_showtimes: int | None = Field(
        default=None,
        description="Total number of showtimes for the movie",
    )
    friends_going: list["UserPublic"] = Field(
        default=[],
        description="List of friends who are going to see the movie",
    )
    going: bool = Field(
        default=False,
        description="Whether the current user is going to see the movie",
    )


class MoviePublic(MovieBase):
    showtimes: list["ShowtimeInMoviePublic"] = Field(
        default=[], description="List of all showtimes associated with the movie"
    )
