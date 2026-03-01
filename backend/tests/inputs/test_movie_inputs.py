from datetime import datetime, time

import pytest
from fastapi import HTTPException

from app.core.enums import TimeOfDay
from app.inputs.movie import get_filters


def test_get_filters_maps_times_of_day_to_time_ranges():
    filters = get_filters(
        snapshot_time=datetime(2025, 1, 1, 12, 0, 0),
        times_of_day=[TimeOfDay.MORNING, TimeOfDay.EVENING],
    )

    assert filters.time_ranges is not None
    assert [(tr.start, tr.end) for tr in filters.time_ranges] == [
        (time(6, 0), time(11, 59, 59)),
        (time(18, 0), time(21, 59, 59)),
    ]


def test_get_filters_merges_time_ranges_with_times_of_day():
    filters = get_filters(
        snapshot_time=datetime(2025, 1, 1, 12, 0, 0),
        time_ranges_raw=["09:30-11:00"],
        times_of_day=[TimeOfDay.AFTERNOON],
    )

    assert filters.time_ranges is not None
    assert [(tr.start, tr.end) for tr in filters.time_ranges] == [
        (time(9, 30), time(11, 0)),
        (time(12, 0), time(17, 59, 59)),
    ]


def test_get_filters_supports_open_ended_time_ranges():
    filters = get_filters(
        snapshot_time=datetime(2025, 1, 1, 12, 0, 0),
        time_ranges_raw=["09:30-", "-17:00"],
    )

    assert filters.time_ranges is not None
    assert [(tr.start, tr.end) for tr in filters.time_ranges] == [
        (time(9, 30), None),
        (None, time(17, 0)),
    ]


def test_get_filters_supports_cross_midnight_time_ranges():
    filters = get_filters(
        snapshot_time=datetime(2025, 1, 1, 12, 0, 0),
        time_ranges_raw=["22:00-02:00"],
    )

    assert filters.time_ranges is not None
    assert [(tr.start, tr.end) for tr in filters.time_ranges] == [
        (time(22, 0), time(2, 0)),
    ]


def test_get_filters_maps_night_to_cross_midnight_range():
    filters = get_filters(
        snapshot_time=datetime(2025, 1, 1, 12, 0, 0),
        times_of_day=[TimeOfDay.NIGHT],
    )

    assert filters.time_ranges is not None
    assert [(tr.start, tr.end) for tr in filters.time_ranges] == [
        (time(22, 0), time(5, 59, 59)),
    ]


def test_get_filters_accepts_runtime_bounds():
    filters = get_filters(
        snapshot_time=datetime(2025, 1, 1, 12, 0, 0),
        runtime_min=50,
        runtime_max=120,
    )

    assert filters.runtime_min == 50
    assert filters.runtime_max == 120


def test_get_filters_rejects_inverted_runtime_bounds():
    with pytest.raises(HTTPException) as exc_info:
        get_filters(
            snapshot_time=datetime(2025, 1, 1, 12, 0, 0),
            runtime_min=121,
            runtime_max=120,
        )

    assert exc_info.value.status_code == 422
