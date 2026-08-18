"""Stored per-run scrape recap.

The scrape runs every few hours but the recap email is sent once a day. Each
run stores its rendered recap here; the daily job stitches the last 24h of rows
into one email and then deletes them.
"""

import datetime as dt

from sqlmodel import Field, SQLModel

from app.utils import now_amsterdam_naive


class ScrapeRecap(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    started_at: dt.datetime = Field(index=True)
    finished_at: dt.datetime
    subject: str
    html: str
    # This run's figures (see `RecapRunMetrics`). The daily email is rendered
    # from every run's metrics at once so each statistic can show its combined
    # value plus each run's, rather than stitching the per-run `html` blobs
    # together. `html` is still stored for the admin monitor's per-run view.
    metrics_json: str = "{}"
    # JSON array of {"filename", "mime_type", "data_b64"} for the run's
    # diagnostic attachments (TMDB lookups, scrape-run details, etc.).
    attachments_json: str = "[]"
    created_at: dt.datetime = Field(default_factory=now_amsterdam_naive, index=True)
