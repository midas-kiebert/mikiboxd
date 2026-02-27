from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any

from app.scraping.tmdb_normalization import _normalize_language_code


@dataclass
class PreEnrichmentTmdbMovieCandidate:
    id: int
    title: str
    original_title: str | None
    release_year: int | None
    original_language: str | None
    popularity: float
    source_buckets: set[str] = field(default_factory=set)


def dedupe_ids(items: Sequence[str]) -> list[str]:
    """Deduplicate identifier sequences while preserving first-seen ordering."""
    return list(dict.fromkeys(str(item) for item in items))


def _parse_release_year(payload: dict[str, Any]) -> int | None:
    release_date = payload.get("release_date")
    if not isinstance(release_date, str) or len(release_date) < 4:
        return None
    year_text = release_date[:4]
    if not year_text.isdigit():
        return None
    return int(year_text)


def parse_movie_candidate(
    payload: dict[str, Any],
    *,
    source_bucket: str,
) -> PreEnrichmentTmdbMovieCandidate | None:
    """Parse a TMDB movie payload into a typed candidate with source-bucket metadata."""
    movie_id_raw = payload.get("id")
    if movie_id_raw is None:
        return None
    try:
        movie_id = int(movie_id_raw)
    except (TypeError, ValueError):
        return None

    title_raw = payload.get("title")
    title = title_raw.strip() if isinstance(title_raw, str) else ""
    if not title:
        return None

    original_title_raw = payload.get("original_title")
    original_title = (
        original_title_raw.strip()
        if isinstance(original_title_raw, str) and original_title_raw.strip()
        else None
    )

    original_language_raw = payload.get("original_language")
    original_language = (
        _normalize_language_code(original_language_raw)
        if isinstance(original_language_raw, str)
        else None
    )

    popularity_raw = payload.get("popularity", 0.0)
    try:
        popularity = float(popularity_raw)
    except (TypeError, ValueError):
        popularity = 0.0

    return PreEnrichmentTmdbMovieCandidate(
        id=movie_id,
        title=title,
        original_title=original_title,
        release_year=_parse_release_year(payload),
        original_language=original_language,
        popularity=popularity,
        source_buckets={source_bucket},
    )


def parse_movie_candidates(
    payloads: Sequence[dict[str, Any]],
    *,
    source_bucket: str,
) -> list[PreEnrichmentTmdbMovieCandidate]:
    """Parse and deduplicate a list of TMDB movie payloads into typed candidates."""
    parsed: list[PreEnrichmentTmdbMovieCandidate] = []
    for payload in payloads:
        candidate = parse_movie_candidate(payload, source_bucket=source_bucket)
        if candidate is None:
            continue
        parsed.append(candidate)
    return merge_candidate_movies(parsed)


def merge_candidate_movies(
    *candidate_lists: Sequence[PreEnrichmentTmdbMovieCandidate],
) -> list[PreEnrichmentTmdbMovieCandidate]:
    """Merge candidate lists by ID and union all source buckets."""
    merged_by_id: dict[int, PreEnrichmentTmdbMovieCandidate] = {}
    ordered_ids: list[int] = []

    for candidate_list in candidate_lists:
        for candidate in candidate_list:
            existing = merged_by_id.get(candidate.id)
            if existing is None:
                merged_by_id[candidate.id] = candidate
                ordered_ids.append(candidate.id)
                continue
            existing.source_buckets.update(candidate.source_buckets)

    return [merged_by_id[movie_id] for movie_id in ordered_ids]


def extract_ids(items: Any) -> list[str]:
    """Extract integer-like movie or person IDs from a heterogeneous list payload."""
    if not isinstance(items, list):
        return []
    ids: list[str] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        item_id = item.get("id")
        if item_id is None:
            continue
        try:
            ids.append(str(int(item_id)))
        except (TypeError, ValueError):
            continue
    return ids


# Backward-compatible alias during migration.
TmdbMovieCandidate = PreEnrichmentTmdbMovieCandidate
