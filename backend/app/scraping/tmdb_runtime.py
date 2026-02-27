from collections.abc import Sequence
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, select

from app.api.deps import get_db_context
from app.models.tmdb_lookup_cache import TmdbLookupCache
from app.scraping import tmdb_lookup as tmdb_core
from app.utils import now_amsterdam_naive


def consume_tmdb_lookup_events() -> list[dict[str, Any]]:
    """Return and clear in-process TMDB lookup audit events."""
    return tmdb_core.consume_tmdb_lookup_events()


def upsert_tmdb_lookup_cache_entry(
    *,
    title_query: str,
    director_names: list[str],
    actor_name: str | None = None,
    year: int | None = None,
    duration_minutes: int | None = None,
    spoken_languages: Sequence[str] | None = None,
    tmdb_id: int | None,
    confidence: float | None = None,
    session: Session | None = None,
) -> tmdb_core.TmdbLookupCacheEntry:
    """Insert or update a TMDB lookup cache row and warm the in-memory cache."""
    payload = tmdb_core.build_lookup_payload(
        title_query=title_query,
        director_names=director_names,
        actor_name=actor_name,
        year=year,
        duration_minutes=duration_minutes,
        spoken_languages=spoken_languages,
    )
    payload_json = tmdb_core.payload_to_canonical_json(payload)
    payload_hash = tmdb_core.payload_hash(payload_json)
    now = now_amsterdam_naive()

    def upsert_in_session(db_session: Session) -> None:
        stmt = select(TmdbLookupCache).where(
            TmdbLookupCache.lookup_hash == payload_hash,
            TmdbLookupCache.lookup_payload == payload_json,
        )
        cached = db_session.exec(stmt).first()
        if cached is None:
            db_session.add(
                TmdbLookupCache(
                    lookup_hash=payload_hash,
                    lookup_payload=payload_json,
                    tmdb_id=tmdb_id,
                    confidence=confidence,
                    created_at=now,
                    updated_at=now,
                )
            )
        else:
            cached.tmdb_id = tmdb_id
            cached.confidence = confidence
            cached.updated_at = now
        db_session.commit()

    if session is not None:
        try:
            upsert_in_session(session)
        except IntegrityError:
            session.rollback()
            upsert_in_session(session)
    else:
        try:
            with get_db_context() as db_session:
                upsert_in_session(db_session)
        except IntegrityError:
            # A concurrent writer inserted the same lookup key; apply the override update.
            with get_db_context() as db_session:
                upsert_in_session(db_session)

    tmdb_core.set_memory_lookup_cache(
        payload_json=payload_json,
        payload_hash=payload_hash,
        lookup_result=tmdb_core.TmdbLookupResult(
            tmdb_id=tmdb_id,
            confidence=confidence,
        ),
    )
    tmdb_core.set_tmdb_cache_available(True)
    return tmdb_core.TmdbLookupCacheEntry(
        lookup_hash=payload_hash,
        lookup_payload=payload_json,
        tmdb_id=tmdb_id,
        confidence=confidence,
    )


def reset_tmdb_runtime_state() -> None:
    """Clear TMDB runtime caches and wake all single-flight waiters."""
    tmdb_core.reset_tmdb_runtime_state()


__all__ = [
    "consume_tmdb_lookup_events",
    "upsert_tmdb_lookup_cache_entry",
    "reset_tmdb_runtime_state",
]
