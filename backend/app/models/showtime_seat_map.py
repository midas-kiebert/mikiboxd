"""Which individual seats were taken at one showtime's last reading."""

from datetime import datetime

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class ShowtimeSeatMap(SQLModel, table=True):
    """The per-seat half of a seat availability reading.

    Every Eagerly reading already hands back each seat's state alongside the
    free/total counts, so this costs no extra request — it is the same
    response, written down instead of thrown away. That is what lets the seat
    picker be served from the database: drawing one used to re-read the
    cinema's booking system on every sheet open, which put the busiest screen
    in the app outside the polling cadence that exists to keep that traffic
    bounded.

    Kept off `Showtime` deliberately. A room's worth of taken seats is a few
    kilobytes, `Showtime` is selected in full by every catalogue query, and
    exactly one endpoint ever wants this — so it lives where only that endpoint
    pays for it.

    `taken` is `[[row_name, seat_name], ...]`, matching the keys in
    `CinemaRoomFloorPlan.seats`; a seat absent from it was free at
    `checked_at`. Only rows for platforms that report per-seat state exist at
    all — a showtime whose platform only gives a count simply has no row, which
    reads as "unknown", never as "nothing taken".

    `checked_at` mirrors the `Showtime.seats_checked_at` of the reading it came
    from, held here too so the seat map carries its own age rather than
    borrowing one from a row that may have been written by a later reading of a
    platform that says less.
    """

    showtime_id: int = Field(
        foreign_key="showtime.id", ondelete="CASCADE", primary_key=True
    )
    taken: list[list[str]] = Field(sa_column=Column(JSONB, nullable=False))
    checked_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
