# app/inputs/movies.py

from datetime import date, datetime, time

from fastapi import Query
from pydantic import BaseModel

from app.utils import now_amsterdam_naive


class TimeRange(BaseModel):
    start: time
    end: time


class Filters(BaseModel):
    query: str | None = None
    snapshot_time: datetime
    watchlist_only: bool = False
    selected_cinema_ids: list[int] | None = None
    days: list[date] | None = None
    time_ranges: list[TimeRange] | None = None


def parse_time_ranges(value: str) -> TimeRange:
    start_str, end_str = value.split("-")
    start = time.fromisoformat(start_str)
    end = time.fromisoformat(end_str)
    return TimeRange(start=start, end=end)


def get_filters(
    query: str | None = Query(None),
    snapshot_time: datetime = Query(
        default_factory=now_amsterdam_naive,
        description="Only show showtimes after this moment",
    ),
    watchlist_only: bool = Query(False),
    selected_cinema_ids: list[int] | None = Query(
        None,
        description="Filter showtimes to only these cinema IDs",
    ),
    days: list[date] | None = Query(None),
    time_ranges_raw: list[str] | None = Query(None, alias="time_ranges"),
) -> Filters:
    time_ranges = (
        [parse_time_ranges(tr) for tr in time_ranges_raw]
        if time_ranges_raw is not None
        else None
    )

    return Filters(
        query=query,
        snapshot_time=snapshot_time,
        watchlist_only=watchlist_only,
        selected_cinema_ids=selected_cinema_ids,
        days=days,
        time_ranges=time_ranges,
    )
