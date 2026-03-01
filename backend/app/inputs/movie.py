# app/inputs/movies.py

from datetime import date, datetime, time
from typing import Annotated

from fastapi import HTTPException, Query
from pydantic import BaseModel

from app.core.enums import GoingStatus, TimeOfDay
from app.utils import now_amsterdam_naive


class TimeRange(BaseModel):
    start: time | None
    end: time | None


class Filters(BaseModel):
    query: str | None = None
    snapshot_time: datetime
    watchlist_only: bool = False
    selected_cinema_ids: list[int] | None = None
    days: list[date] | None = None
    time_ranges: list[TimeRange] | None = None
    runtime_min: int | None = None
    runtime_max: int | None = None
    selected_statuses: list[GoingStatus] | None = None


def parse_time_ranges(value: str) -> TimeRange:
    start_str, end_str = value.split("-", 1)
    start = time.fromisoformat(start_str) if start_str else None
    end = time.fromisoformat(end_str) if end_str else None
    if start is None and end is None:
        raise ValueError("At least one side of time range must be set")
    return TimeRange(start=start, end=end)


def time_range_from_time_of_day(value: TimeOfDay) -> TimeRange:
    if value == TimeOfDay.MORNING:
        return TimeRange(start=time(6, 0), end=time(11, 59, 59))
    if value == TimeOfDay.AFTERNOON:
        return TimeRange(start=time(12, 0), end=time(17, 59, 59))
    if value == TimeOfDay.EVENING:
        return TimeRange(start=time(18, 0), end=time(21, 59, 59))
    return TimeRange(start=time(22, 0), end=time(5, 59, 59))


def get_filters(
    query: Annotated[str | None, Query()] = None,
    snapshot_time: Annotated[
        datetime | None,
        Query(description="Only show showtimes after this moment"),
    ] = None,
    watchlist_only: Annotated[bool, Query()] = False,
    selected_cinema_ids: Annotated[
        list[int] | None,
        Query(description="Filter showtimes to only these cinema IDs"),
    ] = None,
    days: Annotated[list[date] | None, Query()] = None,
    time_ranges_raw: Annotated[
        list[str] | None,
        Query(alias="time_ranges"),
    ] = None,
    times_of_day: Annotated[
        list[TimeOfDay] | None,
        Query(
            alias="times_of_day",
            description="Preset time windows (MORNING/AFTERNOON/EVENING/NIGHT)",
        ),
    ] = None,
    selected_statuses: Annotated[
        list[GoingStatus] | None,
        Query(
            alias="selected_statuses",
            description="Filter by selection statuses (GOING/INTERESTED)",
        ),
    ] = None,
    runtime_min: Annotated[
        int | None,
        Query(
            ge=20,
            le=240,
            alias="runtime_min",
            description="Minimum movie runtime in minutes",
        ),
    ] = None,
    runtime_max: Annotated[
        int | None,
        Query(
            ge=20,
            le=240,
            alias="runtime_max",
            description="Maximum movie runtime in minutes",
        ),
    ] = None,
) -> Filters:
    if snapshot_time is None:
        snapshot_time = now_amsterdam_naive()

    if (
        runtime_min is not None
        and runtime_max is not None
        and runtime_min > runtime_max
    ):
        raise HTTPException(
            status_code=422,
            detail="runtime_min must be less than or equal to runtime_max",
        )

    time_ranges: list[TimeRange] = []
    if time_ranges_raw is not None:
        time_ranges.extend(parse_time_ranges(tr) for tr in time_ranges_raw)
    if times_of_day is not None:
        time_ranges.extend(time_range_from_time_of_day(value) for value in times_of_day)

    return Filters(
        query=query,
        snapshot_time=snapshot_time,
        watchlist_only=watchlist_only,
        selected_cinema_ids=selected_cinema_ids,
        days=days,
        time_ranges=time_ranges or None,
        runtime_min=runtime_min,
        runtime_max=runtime_max,
        selected_statuses=selected_statuses,
    )
