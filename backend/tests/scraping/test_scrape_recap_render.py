"""The daily recap is grouped by statistic, not by run.

Reading one number across a day's runs used to mean scrolling through several
near-identical per-run reports; each statistic now appears once, with the
combined value for the window and every run's own value under it.
"""

import json
from datetime import datetime

from app.services.scrape_recap_render import RecapRunMetrics, render_recap_html


def _run(hour: int, **overrides: object) -> RecapRunMetrics:
    return RecapRunMetrics(
        started_at=datetime(2026, 8, 3, hour, 0),
        finished_at=datetime(2026, 8, 3, hour, 12),
        **overrides,  # type: ignore[arg-type]
    )


def test_metrics_payload_round_trips() -> None:
    metrics = _run(
        3,
        new_future_showtime_count=4,
        new_future_movie_labels=["Lola (id=42456)"],
        pending_miss_counts_by_streak={1: 4, 2: 1},
        tmdb_miss_title_counts=[("weird title", 2)],
        deleted_showtime_lines=["2026-09-03T19:00:00 - LOLA @ Eye"],
        source_disagreement_lines=["2026-08-14T21:30:00 @ KINO | ..."],
        missing_cinemas=["Ketelhuis"],
        low_confidence_threshold=80.0,
    )

    restored = RecapRunMetrics.from_payload(
        json.loads(json.dumps(metrics.to_payload()))
    )

    assert restored == metrics


def test_each_statistic_lists_every_run_under_one_combined_value() -> None:
    html = render_recap_html(
        [
            _run(3, new_future_showtime_count=4, recovered_presence_count=8),
            _run(9, new_future_showtime_count=6, recovered_presence_count=1),
        ]
    )

    # Combined first, then one entry per run — and the label appears only once,
    # so the same statistic is never repeated per run further down the email.
    assert html.count("New future showtimes:") == 1
    new_showtimes_block = html.split("New future showtimes:")[1].split("</li></ul>")[0]
    assert "<b>10</b>" in new_showtimes_block
    assert "03:00 &rarr; 03:12: 4" in new_showtimes_block
    assert "09:00 &rarr; 09:12: 6" in new_showtimes_block


def test_snapshot_statistics_are_not_summed() -> None:
    html = render_recap_html(
        [
            _run(3, future_showtime_count_before=6035, future_showtime_count_after=6039),
            _run(9, future_showtime_count_before=6039, future_showtime_count_after=6035),
        ]
    )

    # "Before" is the window's first run and "after" its last — summing a gauge
    # would report 12074 future showtimes.
    before_block = html.split("Future showtimes before run:")[1].split("</li>")[0]
    after_block = html.split("Future showtimes after run:")[1].split("</li>")[0]
    assert "<b>6035</b>" in before_block
    assert "<b>6035</b>" in after_block


def test_tmdb_hit_rate_is_weighted_across_runs() -> None:
    html = render_recap_html(
        [
            _run(3, tmdb_lookup_count=100, tmdb_cache_hit_count=100),
            _run(9, tmdb_lookup_count=100, tmdb_cache_hit_count=0),
        ]
    )

    hit_rate_block = html.split("TMDB cache hit rate:")[1].split("</li></ul>")[0]
    assert "<b>50.0%</b>" in hit_rate_block


def test_single_run_recap_omits_the_per_run_breakdown() -> None:
    html = render_recap_html([_run(3, new_future_showtime_count=4)])

    assert "New future showtimes: <b>4</b>" in html
    assert "03:00 &rarr; 03:12: 4" not in html
    assert "<h3>Runs</h3>" not in html


def test_diagnostic_dumps_are_left_to_the_attachments() -> None:
    html = render_recap_html([_run(3), _run(9)])

    for removed_section in (
        "Total TMDB lookups sent",
        "Total scrape streams recorded",
        "Cinema scraper streams recorded",
        "Missing Cinema Insert Failures",
        "TMDB Cache Breakdown",
        "Scrape Run Statuses",
        "Cinema Scraper Statuses",
        "Letterboxd Failure Breakdown",
        "Low-Confidence TMDB Matches",
        "Error Stages",
        "Per-Stream Run Details",
        "Per Cinema Scraper Detail",
        "Letterboxd Failure Events",
        "TMDB ID Not Found",
        "<h3>Errors</h3>",
    ):
        assert removed_section not in html


def test_list_sections_group_their_runs_together() -> None:
    html = render_recap_html(
        [
            _run(3, deleted_showtime_lines=["morning deletion"]),
            _run(9, deleted_showtime_lines=["evening deletion"]),
        ]
    )

    section = html.split("Showtimes No Longer Found (Future Only)")[1]
    assert section.index("morning deletion") < section.index("evening deletion")
    assert html.count("Showtimes No Longer Found (Future Only)") == 1


def test_source_disagreements_are_reported_as_matcher_leads() -> None:
    html = render_recap_html(
        [
            _run(
                3,
                source_disagreement_lines=[
                    "2026-08-14T21:30:00 @ KINO | cineville: A (movie_id=1) | "
                    "cinema scraper: B (movie_id=2) | kept movie_id=2 (insert_guard)"
                ],
            ),
            _run(9),
        ]
    )

    assert "Source disagreements (TMDB match to review): <b>1</b>" in html
    assert "Source Disagreements" in html
    assert "cineville: A (movie_id=1)" in html


def test_recaps_stored_before_the_format_change_are_still_included() -> None:
    html = render_recap_html(
        [_run(9)],
        legacy_run_html=["<p>an older run</p>"],
    )

    assert "an older run" in html
    assert "Runs stored before the current recap format" in html
