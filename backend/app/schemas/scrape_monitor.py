"""Admin scrape-monitor response schemas.

Surfaces the per-stream scrape-run history (with deltas + anomaly flags) and the
stored per-run recaps, so unexpected behaviour — a source suddenly finding far
fewer showtimes, a degraded run, or deletions — is easy to trace. The JSON is
directly parseable by scripts/LLMs; the admin page renders the same data.
"""

import datetime as dt

from pydantic import BaseModel, computed_field


class ScrapeRunView(BaseModel):
    id: int
    source_stream: str
    source_label: str
    status: str
    started_at: dt.datetime
    finished_at: dt.datetime | None
    duration_seconds: float | None
    observed_showtime_count: int | None
    previous_observed_count: int | None
    delta: int | None
    error: str | None
    # Anomaly flags — any True means "worth a look".
    is_failed: bool
    is_degraded: bool
    is_zero_observed: bool
    is_big_drop: bool

    @computed_field  # type: ignore[prop-decorator]
    @property
    def is_anomaly(self) -> bool:
        return (
            self.is_failed
            or self.is_degraded
            or self.is_zero_observed
            or self.is_big_drop
        )


class ScrapeMonitorSummary(BaseModel):
    window_hours: int
    generated_at: dt.datetime
    total_runs: int
    failed_runs: int
    degraded_runs: int
    anomaly_runs: int
    streams_with_anomalies: list[str]


class ScrapeMonitorResponse(BaseModel):
    summary: ScrapeMonitorSummary
    runs: list[ScrapeRunView]


class ScrapeRecapView(BaseModel):
    id: int
    started_at: dt.datetime
    finished_at: dt.datetime
    subject: str
    created_at: dt.datetime


class ScrapeRecapAttachment(BaseModel):
    filename: str
    mime_type: str
    size_bytes: int


class ScrapeRecapDetail(ScrapeRecapView):
    html: str
    attachments: list[ScrapeRecapAttachment]
