from typing import Any

from app.scraping import runner


def test_tmdb_low_confidence_lookups_filters_and_sorts() -> None:
    lookups: list[dict[str, Any]] = [
        {
            "timestamp": "2026-02-25T12:00:00",
            "tmdb_id": 3,
            "confidence": 82.0,
        },
        {
            "timestamp": "2026-02-25T11:00:00",
            "tmdb_id": 1,
            "confidence": 42.5,
        },
        {
            "timestamp": "2026-02-25T11:30:00",
            "tmdb_id": 2,
            "confidence": 55.0,
        },
        {
            "timestamp": "2026-02-25T12:30:00",
            "tmdb_id": None,
            "confidence": 10.0,
        },
    ]

    filtered = runner._tmdb_low_confidence_lookups(lookups, threshold=70.0)

    assert [item["tmdb_id"] for item in filtered] == [1, 2]
    assert [item["confidence"] for item in filtered] == [42.5, 55.0]


def test_tmdb_low_confidence_threshold_is_80() -> None:
    assert runner.TMDB_LOW_CONFIDENCE_THRESHOLD == 80.0
