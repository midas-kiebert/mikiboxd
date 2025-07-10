from sqlalchemy import UniqueConstraint
from sqlmodel import Field, SQLModel, Relationship
from datetime import datetime

from typing import TYPE_CHECKING, Optional, Sequence
if TYPE_CHECKING:
    from .movie import Movie, MoviePublic
    from .user import UserPublic  # Avoid circular import issues
    from .cinema import Cinema, CinemaPublic



# Shared properties
class ShowtimeBase(SQLModel):
    id: Optional[int] = Field(default=None, primary_key=True, description="Showtime ID")
    datetime: datetime
    theatre: str = Field(description="Theatre name", default="")
    ticket_link: str | None = Field(description="Link to purchase tickets", default=None)


# Properties to receive on showtime creation
class ShowtimeCreate(ShowtimeBase):
    movie_id: int = Field(foreign_key="movie.id", description="TMDB ID of the movie")
    cinema_id: int = Field(foreign_key="cinema.id", description="ID of the cinema")

class Showtime(ShowtimeBase, table=True):
    __table_args__ = (
        UniqueConstraint(
            'cinema_id',
            'datetime',
            'theatre',
            'movie_id',
            name='uq_showtime_unique_fields'
        )
    ,)
    movie_id: int = Field(foreign_key="movie.id", description="TMDB ID of the movie")
    movie: Optional["Movie"] = Relationship(back_populates="showtimes", sa_relationship_kwargs={"lazy": "joined"})
    cinema_id: int = Field(foreign_key="cinema.id", description="ID of the cinema")
    cinema: "Cinema" = Relationship(back_populates="showtimes", sa_relationship_kwargs={"lazy": "joined"})


class ShowtimePublic(ShowtimeBase):
    id: int = Field(description="Showtime ID")
    movie: "MoviePublic" = Field(description="Movie details associated with the showtime")
    cinema: "CinemaPublic" = Field(description="Cinema details where the showtime is held")
    friends_going: Optional[Sequence["UserPublic"]] = Field(default=None, description="List of friends going to this showtime")


# For responses inside of a MoviePublic model
class ShowtimeInMoviePublic(ShowtimeBase):
    id: int = Field(description="Showtime ID")
    cinema: "CinemaPublic" = Field(description="Cinema details where the showtime is held")
    friends_going: Optional[Sequence["UserPublic"]] = Field(default=None, description="List of friends going to this showtime")