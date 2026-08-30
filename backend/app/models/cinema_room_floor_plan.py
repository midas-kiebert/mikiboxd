"""A room's seat layout, ingested once from its ticketing platform."""

from datetime import datetime

from sqlalchemy import Column
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.core.enums import ScreenSide
from app.utils import now_amsterdam_naive


class CinemaRoomFloorPlan(SQLModel, table=True):
    """One room's seat geometry, for rendering a floor-plan seat picker.

    Keyed the same way as `CinemaRoomCapacity`: by the room name exactly as
    that cinema's scraper writes `Showtime.room`. Floor plans essentially
    never change, so this is populated once by
    `backend/scripts/ingest-seat-floor-plans.py` rather than kept fresh by a
    poller — re-run that script by hand if a covered cinema renovates a room.

    Each entry in `seats` is `{row_name, seat_name, position_left,
    position_top, width, height, seat_selectable}`, trimmed from the
    ticketing platform's response down to the fields a floor plan needs;
    live-request-scoped fields (ticket/lock ids, current status) are never
    stored here since they'd only ever be stale.

    `screen_side` is which end of that geometry the screen is at, and it has
    to be stored per room because it cannot be worked out from the seats.
    Row 1 is not reliably the row nearest the screen — Filmhuis Alkmaar
    numbers from the back — and only one platform states it outright
    (Tricket's seat map draws the screen line itself). Everywhere else it
    defaults to `top` and is corrected by hand in
    `app/configs/seat_screen_side_overrides.yaml`.
    """

    cinema_id: int = Field(
        foreign_key="cinema.id", ondelete="CASCADE", primary_key=True
    )
    room: str = Field(primary_key=True, max_length=255)
    seats: list[dict] = Field(sa_column=Column(JSONB, nullable=False))
    screen_side: ScreenSide = Field(
        default=ScreenSide.TOP, max_length=10, nullable=False
    )
    fetched_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
