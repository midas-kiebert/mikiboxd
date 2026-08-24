"""How many seats a cinema's room holds, learned from seat availability readings."""

from datetime import datetime

from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class CinemaRoomCapacity(SQLModel, table=True):
    """The largest seat count ever seen in one room of one cinema.

    A room's capacity is the same fact for every screening in it, so learning it
    once and sharing it is what makes the estimate converge at all: most
    showtimes are only ever read a handful of times, far too few for a
    per-showtime running max to reach the real total, while a busy room is read
    hundreds of times a week across all its screenings.

    The cost is screenings sold at reduced capacity, which now read emptier than
    they are rather than the room reading fuller than it is. That is the safer
    direction of the two, and `Showtime.seats_level_floor` stops it from ever
    walking a level back down.

    Keyed by the room name exactly as that cinema's scraper writes
    `Showtime.room` — the same key the manual overrides in
    `configs/seat_capacity_overrides.yaml` use. Rooms whose name no source knows
    (Studio/K, Cineville) simply never get a row, and those showtimes fall back
    to their own running max.
    """

    cinema_id: int = Field(
        foreign_key="cinema.id", ondelete="CASCADE", primary_key=True
    )
    room: str = Field(primary_key=True, max_length=255)
    seats_capacity: int
    updated_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
