"""Showtime models."""

import datetime as dt
from typing import TYPE_CHECKING

from sqlalchemy import String, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY
from sqlmodel import Column, Field, Relationship, SQLModel

from app.utils import now_amsterdam_naive

if TYPE_CHECKING:
    from .cinema import Cinema
    from .movie import Movie


# Shared properties
class ShowtimeBase(SQLModel):
    datetime: dt.datetime = Field(index=True)
    end_datetime: dt.datetime | None = None
    ticket_link: str | None = None
    # Which room the showtime plays in, named the way the cinema names it:
    # "LAB 1", "Grote Zaal", "Cinema 3", "Parisienzaal". Only some sources know
    # it — Eye's API and the Eagerly feed carry it, and for the rest the seat
    # availability poller reads it off the ticket shop's checkout page — so a
    # scraper that cannot see it leaves this None rather than guessing.
    room: str | None = None
    subtitles: list[str] | None = Field(sa_column=Column(ARRAY(String)), default=None)
    # Exact source stream this showtime was last (re-)scraped from, e.g.
    # "cinema_scraper:kriterion" or "cineville:xxx" — same naming convention
    # as ShowtimeSourcePresence.source_stream, denormalized here for display.
    scrape_source: str | None = None
    # The TmdbLookupCache entry that resolved this showtime's movie, if any.
    # Lets an admin cache correction reassign exactly the showtimes that came
    # from that lookup, instead of every showtime on the movie — two cache
    # entries (e.g. from different cinemas' scrapers) can otherwise resolve
    # to the same movie_id, and only one of them wins Movie.tmdb_cache_id.
    tmdb_cache_id: int | None = Field(default=None, foreign_key="tmdblookupcache.id")


# Properties to receive on showtime creation
class ShowtimeCreate(ShowtimeBase):
    movie_id: int = Field(foreign_key="movie.id")
    cinema_id: int = Field(foreign_key="cinema.id")


class Showtime(ShowtimeBase, table=True):
    __table_args__ = (
        UniqueConstraint(
            "cinema_id",
            "datetime",
            "movie_id",
            name="uq_showtime_unique_fields",
        ),
    )
    id: int = Field(primary_key=True)
    # When this row was first inserted — used to detect showtimes that are
    # "new" within a lookback window (e.g. the watchlist digest), as opposed
    # to showtimes that merely became future-dated again.
    created_at: dt.datetime = Field(default_factory=now_amsterdam_naive)
    movie_id: int = Field(foreign_key="movie.id")
    movie: "Movie" = Relationship(sa_relationship_kwargs={"lazy": "joined"})
    cinema_id: int = Field(foreign_key="cinema.id")
    cinema: "Cinema" = Relationship(sa_relationship_kwargs={"lazy": "joined"})
    # Seat availability, refreshed by the availability poller (see
    # services/seat_availability.py) rather than by the scrape, and only for
    # showtimes someone has actually selected — polling every showtime would
    # mean tens of thousands of requests at a handful of ticket shops.
    seats_left: int | None = None
    # Running max of every seats_left ever read for this showtime, which stands
    # in for its capacity: a showtime is first polled weeks out while it is
    # still near-empty, so the largest reading converges on the real number.
    # Per-showtime rather than per-room on purpose — a room can be sold at
    # reduced capacity for one screening, and this needs no room modelling at
    # all to be right. A showtime first polled when it is already half sold
    # under-reads, which makes the "nearly full" test fire late, never early.
    seats_capacity: int | None = None
    seats_checked_at: dt.datetime | None = None
