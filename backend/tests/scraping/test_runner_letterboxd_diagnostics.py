from typing import Any

from app.scraping import runner


def test_letterboxd_403_diagnostics_counts_events() -> None:
    failures: list[dict[str, Any]] = [
        {
            "event_type": "http_403_observed",
            "tmdb_id": 1,
            "status_code": 403,
            "reason": "http_403_probable_automated_block",
            "response_meta": {"cf_ray": "ray-1"},
        },
        {
            "event_type": "http_403_streak_block",
            "tmdb_id": 2,
            "status_code": 403,
            "reason": "http_403_streak_block",
            "response_meta": {"cf_ray": "ray-2"},
        },
        {
            "event_type": "session_refresh_error",
            "reason": "RuntimeError: boom",
        },
        {
            "event_type": "session_refresh_http_error",
            "status_code": 503,
        },
        {
            "event_type": "cooldown_skip",
            "reason": "http_403_streak_block",
        },
    ]

    diagnostics = runner._letterboxd_403_diagnostics(failures)

    assert diagnostics.observed_403_events == 2
    assert diagnostics.unique_tmdb_ids == 2
    assert diagnostics.probable_automated_block_events == 2
    assert diagnostics.cooldown_events == 2
    assert diagnostics.session_refresh_errors == 1
    assert diagnostics.session_refresh_http_errors == 1
    assert diagnostics.unique_cf_rays == 2
    assert diagnostics.sample_cf_rays == ["ray-1", "ray-2"]


def test_render_letterboxd_failure_item_includes_response_meta() -> None:
    item = runner._render_letterboxd_failure_item(
        {
            "timestamp": "2026-02-21T02:02:37.346266Z",
            "event_type": "http_403_observed",
            "tmdb_id": 655424,
            "status_code": 403,
            "reason": "http_403_probable_automated_block",
            "url": "https://letterboxd.com/tmdb/655424/",
            "block_remaining_seconds": 900,
            "response_meta": {
                "cf_ray": "9d15ba620aa79fc6-AMS",
                "server": "cloudflare",
                "consecutive_403_count": 2,
                "attempt": 2,
                "attempts_total": 3,
            },
        }
    )

    assert "http_403_observed" in item
    assert "cf_ray=9d15ba620aa79fc6-AMS" in item
    assert "consecutive_403=2" in item
    assert "attempt=2/3" in item
    assert "cooldown_remaining=900s" in item


def test_tmdb_low_confidence_lookups_filters_and_sorts() -> None:
    lookups = [
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


def test_render_low_confidence_tmdb_item_is_concise() -> None:
    item = {
        "timestamp": "2026-02-25T22:00:00",
        "tmdb_id": 422,
        "confidence": 79.4,
        "cache_source": "network",
        "decision": {
            "status": "accepted",
            "reason": "selected_best_candidate",
            "good_option_count": 3,
            "second_good_margin": 1.234,
        },
        "payload": {
            "version": 10,
            "title_query": "otto e mezzo",
            "title_variants": ["otto e mezzo"],
            "director_names": ["Federico Fellini"],
            "actor_names": [
                "Marcello Mastroianni",
                "Claudia Cardinale",
                "Anouk Aimee",
            ],
            "year": 1963,
            "duration_minutes": 138,
            "spoken_languages": ["it"],
        },
    }

    html = runner._render_low_confidence_tmdb_item(item)

    assert "confidence=<b>79.4</b>" in html
    assert "https://www.themoviedb.org/movie/422" in html
    assert "reason=best candidate selected" in html
    assert "query=otto e mezzo" in html
    assert "directors=Federico Fellini" in html
    assert "actors=Marcello Mastroianni, Claudia Cardinale, Anouk Aimee" in html
    assert "languages=it" in html
    assert "payload=" not in html
    assert "decision=" not in html


def test_tmdb_low_confidence_threshold_is_80() -> None:
    assert runner.TMDB_LOW_CONFIDENCE_THRESHOLD == 80.0


def test_render_tmdb_miss_item_is_concise() -> None:
    item = {
        "timestamp": "2026-02-25T23:42:10.678118",
        "cache_source": "network",
        "tmdb_id": None,
        "decision": {
            "status": "rejected",
            "reason": "ambiguous_good_options",
            "good_option_count": 18,
            "second_good_margin": 1.002,
        },
        "payload": {
            "version": 10,
            "title_query": "youth",
            "title_variants": ["youth"],
            "director_names": ["Wang Bing"],
            "actor_names": [],
            "year": 2023,
            "duration_minutes": 215,
            "spoken_languages": ["zh"],
        },
    }

    html = runner._render_tmdb_miss_item(item)

    assert "title=youth" in html
    assert "reason=ambiguous between good options" in html
    assert "query=youth" in html
    assert "directors=Wang Bing" in html
    assert "actors=-" in html
    assert "year=2023" in html
    assert "duration=215" in html
    assert "languages=zh" in html
    assert "payload=" not in html
    assert "decision=" not in html
