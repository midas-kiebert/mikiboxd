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
