"""TMDB lookups where several films matched a listing equally well.

The matcher flags these on the lookup-cache row it writes
(`TmdbLookupCache.ambiguity_json`, see `app.scraping.tmdb.TmdbAmbiguity`). Each
one shows the listing alone could not tell the films apart — the
Fahrenheit 9/11 / Fahrenheit 11/9 case — so the admin dashboard lists them until
they are marked reviewed, or corrected through the TMDB cache tool.
"""

import json
from typing import Any

from sqlmodel import Session, col, select

from app.models.tmdb_lookup_cache import TmdbLookupCache
from app.schemas.tmdb_ambiguity import TmdbAmbiguityCandidate, TmdbAmbiguityView
from app.utils import now_amsterdam_naive

MAX_LIST_LIMIT = 200


def _parse_json_object(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except ValueError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value]


def _optional_int(value: object) -> int | None:
    return value if isinstance(value, int) else None


def _to_view(cached: TmdbLookupCache) -> TmdbAmbiguityView | None:
    ambiguity = _parse_json_object(cached.ambiguity_json)
    if cached.id is None or not ambiguity:
        return None
    payload = _parse_json_object(cached.lookup_payload)
    candidates = [
        TmdbAmbiguityCandidate(
            tmdb_id=candidate["tmdb_id"],
            title=str(candidate.get("title", "")),
            release_year=_optional_int(candidate.get("release_year")),
        )
        for candidate in ambiguity.get("candidates", [])
        if isinstance(candidate, dict) and isinstance(candidate.get("tmdb_id"), int)
    ]
    return TmdbAmbiguityView(
        cache_id=cached.id,
        title_query=cached.title_query or payload.get("title_query"),
        director_names=_string_list(payload.get("director_names")),
        actor_names=_string_list(payload.get("actor_names")),
        year=_optional_int(payload.get("year")),
        duration_minutes=_optional_int(payload.get("duration_minutes")),
        quality=str(ambiguity.get("quality", "")),
        candidates=candidates,
        resolved_by=_string_list(ambiguity.get("resolved_by")),
        matched_tmdb_id=cached.tmdb_id,
        is_manual_override=cached.is_manual_override,
        created_at=cached.created_at,
        reviewed_at=cached.ambiguity_reviewed_at,
    )


def list_ambiguities(
    *,
    session: Session,
    include_reviewed: bool,
    limit: int,
) -> list[TmdbAmbiguityView]:
    stmt = select(TmdbLookupCache).where(
        col(TmdbLookupCache.ambiguity_json).is_not(None)
    )
    if not include_reviewed:
        stmt = stmt.where(col(TmdbLookupCache.ambiguity_reviewed_at).is_(None))
    rows = session.exec(
        stmt.order_by(col(TmdbLookupCache.created_at).desc()).limit(
            max(1, min(limit, MAX_LIST_LIMIT))
        )
    ).all()
    return [view for row in rows if (view := _to_view(row)) is not None]


def set_reviewed(
    *,
    session: Session,
    cache_id: int,
    reviewed: bool,
) -> TmdbAmbiguityView | None:
    cached = session.get(TmdbLookupCache, cache_id)
    if cached is None or cached.ambiguity_json is None:
        return None
    cached.ambiguity_reviewed_at = now_amsterdam_naive() if reviewed else None
    session.add(cached)
    return _to_view(cached)
