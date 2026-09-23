"""Admin view of TMDB lookups where several films matched a listing equally well."""

import datetime as dt

from pydantic import BaseModel


class TmdbAmbiguityCandidate(BaseModel):
    tmdb_id: int
    title: str
    release_year: int | None


class TmdbAmbiguityView(BaseModel):
    cache_id: int
    title_query: str | None
    # What the listing gave the matcher to go on — usually the reason it tied.
    director_names: list[str]
    actor_names: list[str]
    year: int | None
    duration_minutes: int | None
    quality: str
    candidates: list[TmdbAmbiguityCandidate]
    # The tie-break signals that picked `matched_tmdb_id`; empty when none did
    # and the lookup found no match.
    resolved_by: list[str]
    matched_tmdb_id: int | None
    is_manual_override: bool
    created_at: dt.datetime
    reviewed_at: dt.datetime | None


class TmdbAmbiguityReviewUpdate(BaseModel):
    reviewed: bool
