import datetime as dt
from enum import Enum

from sqlalchemy import Enum as SAEnum
from sqlmodel import Column, Field, SQLModel

__all__ = [
    "ScrapeRunStatus",
    "ScrapeRun",
]


class ScrapeRunStatus(str, Enum):
    SUCCESS = "success"
    FAILED = "failed"
    DEGRADED = "degraded"


class ScrapeRun(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    source_stream: str = Field(index=True)
    status: ScrapeRunStatus = Field(
        sa_column=Column(
            SAEnum(
                ScrapeRunStatus,
                native_enum=False,
                name="scraperunstatus",
            ),
            nullable=False,
        )
    )
    started_at: dt.datetime = Field(index=True)
    finished_at: dt.datetime | None = None
    observed_showtime_count: int | None = None
    error: str | None = None
