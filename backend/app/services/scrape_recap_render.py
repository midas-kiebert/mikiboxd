"""Rendering the scrape recap, per run and for the daily digest email.

The scrape runs several times a day but only one recap is emailed, so the email
covers several runs at once. It is organised **by statistic, not by run**: each
number appears once, with the combined value for the window and every run's own
value directly underneath it. Reading one metric across the day is then a glance
instead of a scroll through several near-identical run reports.

Only the numbers and the short lists worth skimming live in the email body. The
long diagnostic dumps — every TMDB lookup, per-stream run rows, Letterboxd
failure events, raw errors — ship as JSON attachments instead.

Each run stores its own :class:`RecapRunMetrics` (see ``ScrapeRecap``); the daily
job loads them all and renders one document from the list.
"""

from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import datetime
from html import escape
from typing import Any

# How many of a run's list entries survive into the email body. The full set is
# always in that run's JSON attachment.
MAX_NEW_MOVIE_LINES = 50
MAX_TMDB_MISS_TITLE_LINES = 25


@dataclass(frozen=True)
class RecapRunMetrics:
    """One scrape run's recap figures, as stored on its ``ScrapeRecap`` row."""

    started_at: datetime
    finished_at: datetime
    new_future_showtime_count: int = 0
    new_future_movie_labels: list[str] = field(default_factory=list)
    future_showtime_count_before: int = 0
    future_showtime_count_after: int = 0
    future_movie_count_before: int = 0
    future_movie_count_after: int = 0
    recovered_presence_count: int = 0
    missing_streak_to_deactivate: int = 3
    pending_miss_counts_by_streak: dict[int, int] = field(default_factory=dict)
    pending_miss_lines: list[str] = field(default_factory=list)
    tmdb_lookup_count: int = 0
    tmdb_cache_hit_count: int = 0
    tmdb_miss_count: int = 0
    tmdb_miss_title_counts: list[tuple[str, int]] = field(default_factory=list)
    low_confidence_count: int = 0
    low_confidence_threshold: float = 0.0
    deleted_showtime_lines: list[str] = field(default_factory=list)
    conflict_deleted_count: int = 0
    # Screenings Cineville and the cinema's own scraper resolved to different
    # TMDB ids — each one is a TMDB match that is wrong on one side, so they are
    # the leads worth acting on when improving the matcher.
    source_disagreement_lines: list[str] = field(default_factory=list)
    error_count: int = 0
    letterboxd_failure_count: int = 0
    missing_cinemas: list[str] = field(default_factory=list)

    def to_payload(self) -> dict[str, Any]:
        return {
            "started_at": self.started_at.isoformat(),
            "finished_at": self.finished_at.isoformat(),
            "new_future_showtime_count": self.new_future_showtime_count,
            "new_future_movie_labels": self.new_future_movie_labels,
            "future_showtime_count_before": self.future_showtime_count_before,
            "future_showtime_count_after": self.future_showtime_count_after,
            "future_movie_count_before": self.future_movie_count_before,
            "future_movie_count_after": self.future_movie_count_after,
            "recovered_presence_count": self.recovered_presence_count,
            "missing_streak_to_deactivate": self.missing_streak_to_deactivate,
            "pending_miss_counts_by_streak": {
                str(streak): count
                for streak, count in self.pending_miss_counts_by_streak.items()
            },
            "pending_miss_lines": self.pending_miss_lines,
            "tmdb_lookup_count": self.tmdb_lookup_count,
            "tmdb_cache_hit_count": self.tmdb_cache_hit_count,
            "tmdb_miss_count": self.tmdb_miss_count,
            "tmdb_miss_title_counts": [
                [title, count] for title, count in self.tmdb_miss_title_counts
            ],
            "low_confidence_count": self.low_confidence_count,
            "low_confidence_threshold": self.low_confidence_threshold,
            "deleted_showtime_lines": self.deleted_showtime_lines,
            "conflict_deleted_count": self.conflict_deleted_count,
            "source_disagreement_lines": self.source_disagreement_lines,
            "error_count": self.error_count,
            "letterboxd_failure_count": self.letterboxd_failure_count,
            "missing_cinemas": self.missing_cinemas,
        }

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "RecapRunMetrics":
        return cls(
            started_at=datetime.fromisoformat(payload["started_at"]),
            finished_at=datetime.fromisoformat(payload["finished_at"]),
            new_future_showtime_count=int(payload.get("new_future_showtime_count", 0)),
            new_future_movie_labels=[
                str(label) for label in payload.get("new_future_movie_labels", [])
            ],
            future_showtime_count_before=int(
                payload.get("future_showtime_count_before", 0)
            ),
            future_showtime_count_after=int(
                payload.get("future_showtime_count_after", 0)
            ),
            future_movie_count_before=int(payload.get("future_movie_count_before", 0)),
            future_movie_count_after=int(payload.get("future_movie_count_after", 0)),
            recovered_presence_count=int(payload.get("recovered_presence_count", 0)),
            missing_streak_to_deactivate=int(
                payload.get("missing_streak_to_deactivate", 3)
            ),
            pending_miss_counts_by_streak={
                int(streak): int(count)
                for streak, count in (
                    payload.get("pending_miss_counts_by_streak") or {}
                ).items()
            },
            pending_miss_lines=[
                str(line) for line in payload.get("pending_miss_lines", [])
            ],
            tmdb_lookup_count=int(payload.get("tmdb_lookup_count", 0)),
            tmdb_cache_hit_count=int(payload.get("tmdb_cache_hit_count", 0)),
            tmdb_miss_count=int(payload.get("tmdb_miss_count", 0)),
            tmdb_miss_title_counts=[
                (str(entry[0]), int(entry[1]))
                for entry in payload.get("tmdb_miss_title_counts", [])
                if len(entry) == 2
            ],
            low_confidence_count=int(payload.get("low_confidence_count", 0)),
            low_confidence_threshold=float(
                payload.get("low_confidence_threshold", 0.0)
            ),
            deleted_showtime_lines=[
                str(line) for line in payload.get("deleted_showtime_lines", [])
            ],
            conflict_deleted_count=int(payload.get("conflict_deleted_count", 0)),
            source_disagreement_lines=[
                str(line) for line in payload.get("source_disagreement_lines", [])
            ],
            error_count=int(payload.get("error_count", 0)),
            letterboxd_failure_count=int(payload.get("letterboxd_failure_count", 0)),
            missing_cinemas=[
                str(cinema) for cinema in payload.get("missing_cinemas", [])
            ],
        )


@dataclass(frozen=True)
class _Metric:
    label: str
    combined: str
    per_run: list[str]


def _run_label(run: RecapRunMetrics) -> str:
    return f"{run.started_at:%H:%M} &rarr; {run.finished_at:%H:%M}"


def _sum_metric(
    *,
    label: str,
    runs: Sequence[RecapRunMetrics],
    value: Callable[[RecapRunMetrics], int],
) -> _Metric:
    return _Metric(
        label=label,
        combined=str(sum(value(run) for run in runs)),
        per_run=[str(value(run)) for run in runs],
    )


def _snapshot_metric(
    *,
    label: str,
    runs: Sequence[RecapRunMetrics],
    value: Callable[[RecapRunMetrics], int],
    combined_run: RecapRunMetrics,
) -> _Metric:
    """A gauge rather than a total: combined is one run's reading, not a sum.

    "Future showtimes before run" is the window's first run; anything measured
    after the fact ("after run", pending misses) is the last run's.
    """
    return _Metric(
        label=label,
        combined=str(value(combined_run)),
        per_run=[str(value(run)) for run in runs],
    )


def _tmdb_hit_rate(run: RecapRunMetrics) -> float:
    if run.tmdb_lookup_count <= 0:
        return 0.0
    return (run.tmdb_cache_hit_count / run.tmdb_lookup_count) * 100.0


def _tmdb_hit_rate_metric(runs: Sequence[RecapRunMetrics]) -> _Metric:
    total_lookups = sum(run.tmdb_lookup_count for run in runs)
    total_hits = sum(run.tmdb_cache_hit_count for run in runs)
    combined = (total_hits / total_lookups) * 100.0 if total_lookups else 0.0
    return _Metric(
        label="TMDB cache hit rate",
        combined=f"{combined:.1f}%",
        per_run=[f"{_tmdb_hit_rate(run):.1f}%" for run in runs],
    )


def _pending_miss_count(streak: int) -> Callable[[RecapRunMetrics], int]:
    def count(run: RecapRunMetrics) -> int:
        return run.pending_miss_counts_by_streak.get(streak, 0)

    return count


def _pending_miss_metrics(
    *,
    runs: Sequence[RecapRunMetrics],
    last_run: RecapRunMetrics,
) -> list[_Metric]:
    deactivate_at = last_run.missing_streak_to_deactivate
    return [
        _snapshot_metric(
            label=f"Missed {streak}x ({deactivate_at - streak} more from deletion)",
            runs=runs,
            value=_pending_miss_count(streak),
            combined_run=last_run,
        )
        for streak in range(1, max(deactivate_at, 1))
    ]


def _build_metrics(runs: Sequence[RecapRunMetrics]) -> list[_Metric]:
    first_run = runs[0]
    last_run = runs[-1]
    low_confidence_threshold = last_run.low_confidence_threshold
    return [
        _sum_metric(
            label="New future showtimes",
            runs=runs,
            value=lambda run: run.new_future_showtime_count,
        ),
        _sum_metric(
            label="New movies among future showtimes",
            runs=runs,
            value=lambda run: len(run.new_future_movie_labels),
        ),
        _snapshot_metric(
            label="Future showtimes before run",
            runs=runs,
            value=lambda run: run.future_showtime_count_before,
            combined_run=first_run,
        ),
        _snapshot_metric(
            label="Future showtimes after run",
            runs=runs,
            value=lambda run: run.future_showtime_count_after,
            combined_run=last_run,
        ),
        _snapshot_metric(
            label="Future movies before run",
            runs=runs,
            value=lambda run: run.future_movie_count_before,
            combined_run=first_run,
        ),
        _snapshot_metric(
            label="Future movies after run",
            runs=runs,
            value=lambda run: run.future_movie_count_after,
            combined_run=last_run,
        ),
        _sum_metric(
            label="Previously missing, now seen again",
            runs=runs,
            value=lambda run: run.recovered_presence_count,
        ),
        *_pending_miss_metrics(runs=runs, last_run=last_run),
        _tmdb_hit_rate_metric(runs),
        _sum_metric(
            label="TMDB ID not found count",
            runs=runs,
            value=lambda run: run.tmdb_miss_count,
        ),
        _sum_metric(
            label=(
                "Low-confidence TMDB matches " f"(&lt; {low_confidence_threshold:.1f})"
            ),
            runs=runs,
            value=lambda run: run.low_confidence_count,
        ),
        _sum_metric(
            label="Future showtimes deleted (no longer found)",
            runs=runs,
            value=lambda run: len(run.deleted_showtime_lines),
        ),
        _sum_metric(
            label="Duplicate-title showtimes removed",
            runs=runs,
            value=lambda run: run.conflict_deleted_count,
        ),
        _sum_metric(
            label="Source disagreements (TMDB match to review)",
            runs=runs,
            value=lambda run: len(run.source_disagreement_lines),
        ),
        _sum_metric(
            label="Error count",
            runs=runs,
            value=lambda run: run.error_count,
        ),
        _sum_metric(
            label="Letterboxd failure count",
            runs=runs,
            value=lambda run: run.letterboxd_failure_count,
        ),
        _sum_metric(
            label="Missing cinemas count",
            runs=runs,
            value=lambda run: len(run.missing_cinemas),
        ),
    ]


def _render_metric(
    *,
    metric: _Metric,
    runs: Sequence[RecapRunMetrics],
    show_per_run: bool,
) -> str:
    header = f"{metric.label}: <b>{escape(metric.combined)}</b>"
    if not show_per_run:
        return f"<li>{header}</li>"
    per_run_items = "".join(
        f"<li>{_run_label(run)}: {escape(value)}</li>"
        for run, value in zip(runs, metric.per_run, strict=True)
    )
    return f"<li>{header}<ul>{per_run_items}</ul></li>"


def _render_list_section(
    *,
    title: str,
    runs: Sequence[RecapRunMetrics],
    lines: Callable[[RecapRunMetrics], list[str]],
    show_per_run: bool,
) -> str:
    if not show_per_run:
        items = (
            "".join(f"<li>{escape(line)}</li>" for line in lines(runs[0]))
            or "<li>None</li>"
        )
        return f"<h3>{escape(title)}</h3><ul>{items}</ul>"

    blocks: list[str] = []
    for run in runs:
        items = (
            "".join(f"<li>{escape(line)}</li>" for line in lines(run))
            or "<li>None</li>"
        )
        blocks.append(f"<h4>{_run_label(run)}</h4><ul>{items}</ul>")
    return f"<h3>{escape(title)}</h3>{''.join(blocks)}"


def _tmdb_miss_title_lines(run: RecapRunMetrics) -> list[str]:
    return [
        f"{title}: {count}"
        for title, count in run.tmdb_miss_title_counts[:MAX_TMDB_MISS_TITLE_LINES]
    ]


def render_recap_html(
    runs: Sequence[RecapRunMetrics],
    *,
    legacy_run_html: Sequence[str] = (),
) -> str:
    """One recap document covering ``runs``, grouped by statistic.

    With a single run the per-run breakdown is dropped: the combined column
    would just repeat every number. ``legacy_run_html`` carries recaps stored
    before this format existed, appended verbatim at the end so a deploy in the
    middle of a window does not silently drop that day's earlier runs.
    """
    if not runs:
        return "".join(legacy_run_html)

    show_per_run = len(runs) > 1
    window_start = runs[0].started_at
    window_end = runs[-1].finished_at

    metric_items = "".join(
        _render_metric(metric=metric, runs=runs, show_per_run=show_per_run)
        for metric in _build_metrics(runs)
    )
    run_index = ""
    if show_per_run:
        run_items = "".join(f"<li>{_run_label(run)}</li>" for run in runs)
        run_index = f"<h3>Runs</h3><ol>{run_items}</ol>"
    list_sections = "".join(
        (
            _render_list_section(
                title="New Movies In Future Showtimes",
                runs=runs,
                lines=lambda run: run.new_future_movie_labels[:MAX_NEW_MOVIE_LINES],
                show_per_run=show_per_run,
            ),
            _render_list_section(
                title=(
                    "Source Disagreements — Cineville vs cinema scraper "
                    "(each one is a TMDB match to review)"
                ),
                runs=runs,
                lines=lambda run: run.source_disagreement_lines,
                show_per_run=show_per_run,
            ),
            _render_list_section(
                title="Showtimes No Longer Found (Future Only)",
                runs=runs,
                lines=lambda run: run.deleted_showtime_lines,
                show_per_run=show_per_run,
            ),
            _render_list_section(
                title="Pending Misses (Upcoming Showtimes)",
                runs=runs,
                lines=lambda run: run.pending_miss_lines,
                show_per_run=show_per_run,
            ),
            _render_list_section(
                title="Missing Cinemas",
                runs=runs,
                lines=lambda run: run.missing_cinemas,
                show_per_run=show_per_run,
            ),
            _render_list_section(
                title="TMDB Miss Titles (Top)",
                runs=runs,
                lines=_tmdb_miss_title_lines,
                show_per_run=show_per_run,
            ),
        )
    )
    legacy_section = ""
    if legacy_run_html:
        legacy_section = (
            "<h2>Runs stored before the current recap format</h2>"
            f"{''.join(legacy_run_html)}"
        )

    return f"""
    <h2>Scrape Recap</h2>
    <p>Window: <code>{escape(window_start.isoformat())}</code> &rarr;
       <code>{escape(window_end.isoformat())}</code></p>
    <p>Runs: <b>{len(runs)}</b></p>
    {run_index}
    <h3>Run Metrics</h3>
    <ul>{metric_items}</ul>
    {list_sections}
    <p>Low-confidence TMDB matches, TMDB misses, error stages and raw errors,
       per-stream and per-cinema run details, and Letterboxd failure events are
       in the JSON attachments.</p>
    {legacy_section}
    """
