from sqlmodel import Field, SQLModel, Relationship
from sqlalchemy.orm import foreign
from sqlalchemy import and_, func
from datetime import datetime
from zoneinfo import ZoneInfo

from .showtime import Showtime, ShowtimeInMoviePublic


# Shared properties
class MovieBase(SQLModel):
    id: int = Field(unique=True, index=True, primary_key=True, description="TMDB ID of the movie")
    title: str = Field(description="Title of the movie")
    poster_link: str | None = Field(default=None, description="Link to the movie poster")
    letterboxd_slug: str | None = Field(default=None, description="Letterboxd slug for the movie")

# Properties to receive on movie creation
class MovieCreate(MovieBase):
    pass

# Properties to receive on movie update
class MovieUpdate(SQLModel):
    title: str | None = Field(default=None, description="Title of the movie")
    poster_link: str | None = Field(default=None, description="Link to the movie poster")
    letterboxd_slug: str | None = Field(default=None, description="Letterboxd slug for the movie")


# Database model, database table inferred from class name
class Movie(MovieBase, table=True):
    showtimes: list["Showtime"] = Relationship(
        back_populates="movie",
        cascade_delete=True,
        sa_relationship_kwargs={"lazy": "noload"}
    )


class MovieSummaryPublic(MovieBase):
    showtimes: list["ShowtimeInMoviePublic"] = Field(default=[], description="List of showtimes associated with the movie")

class MoviePublic(MovieBase):
    showtimes_with_friends: list["ShowtimeInMoviePublic"] = Field(default=[], description="List of showtimes associated with the movie where friends are going")
    showtime_without_friends: list["ShowtimeInMoviePublic"] = Field(default=[], description="List of showtimes associated with the movie without friends going")