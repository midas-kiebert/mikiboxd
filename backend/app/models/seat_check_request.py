"""One hand-requested seat reading, kept long enough to budget the next ones."""

from datetime import datetime

from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class SeatCheckRequest(SQLModel, table=True):
    """Someone pressed "check" on a screening and a live read was let through.

    Stored rather than counted in memory because the backend runs several
    uvicorn workers: an in-process counter would give each worker its own
    budget and multiply the real rate at a cinema's ticket shop by the worker
    count. The rows double as the per-screening cooldown — a screening that was
    asked about minutes ago is not asked about again, whether or not that read
    produced a number. Rows older than the budget window are useless and are
    pruned as new ones are written.
    """

    id: int | None = Field(default=None, primary_key=True)
    showtime_id: int = Field(foreign_key="showtime.id", ondelete="CASCADE", index=True)
    # The ticket link's netloc at the time, which is what the per-shop budget
    # counts — several cinemas can sell from one shop.
    host: str = Field(index=True)
    requested_at: datetime = Field(default_factory=now_amsterdam_naive, index=True)
