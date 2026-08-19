"""Short opaque codes behind shared `/ping/{showtime_id}/{token}` invite links."""

from datetime import datetime
from uuid import UUID

from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class ShowtimePingLink(SQLModel, table=True):
    """Maps a short random code back to who minted it and for which showtime.

    A lookup table rather than a signed/self-verifying token: keeping the
    code short is the point (long links lose their WhatsApp/iMessage rich
    preview and show as raw text instead), and it leaves room for the code
    to double as a QR payload later. `receive_ping_from_link` treats a
    missing row the same as a tampered token — both mean "not a link this
    server actually minted".
    """

    token: str = Field(primary_key=True, max_length=32)
    showtime_id: int = Field(
        foreign_key="showtime.id",
        nullable=False,
        ondelete="CASCADE",
        index=True,
    )
    sender_id: UUID = Field(
        foreign_key="user.id",
        nullable=False,
        ondelete="CASCADE",
        index=True,
    )
    created_at: datetime = Field(default_factory=now_amsterdam_naive, nullable=False)
