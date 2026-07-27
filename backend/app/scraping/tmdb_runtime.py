import json
from collections.abc import Sequence
from typing import Any

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.api.deps import get_db_context
from app.models.tmdb_lookup_cache import TmdbLookupCache
from app.scraping import tmdb_lookup as tmdb_core
from app.scraping.tmdb_normalization import _normalize_title_search_query
from app.services import movies as movies_service
from app.utils import now_amsterdam_naive


def consume_tmdb_lookup_events() -> list[dict[str, Any]]:
    """Return and clear in-process TMDB lookup audit events."""
    return tmdb_core.consume_tmdb_lookup_events()


def _title_query_from_payload(lookup_payload: str) -> str | None:
    """Recover a row's normalized title from its stored payload.

    Only needed for rows written before `title_query` became a column; the
    migration backfills the same value, so this is the belt to its braces.
    """
    try:
        payload = json.loads(lookup_payload)
    except (TypeError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    value = payload.get("title_query")
    return value if isinstance(value, str) and value else None


def _propagate_correction_to_sibling_entries(
    *,
    db_session: Session,
    corrected_cache_id: int,
    title_query: str | None,
    old_tmdb_id: int,
    new_tmdb_id: int,
) -> None:
    """Apply a correction to the other cache rows for the same film.

    One film routinely owns several cache rows: the key hashes the whole lookup
    payload, and the cast list, runtime and spoken languages in it come from the
    cinema's listing, so any of them changing mints a new row. Correcting one
    row therefore left the drifted siblings still pointing at the wrong id, and
    the next scrape hit one of *those* — a cache hit, so nothing re-resolved and
    nothing was overwritten, yet the film came back wrong. That is what made a
    fixed film look like it had reverted.

    Only rows that agree with the corrected one — same normalized title, same
    (wrong) TMDB id — are touched, and each is flagged as an override so an
    automated run cannot undo it. Rows an admin has separately decided on are
    left alone by the `old_tmdb_id` match.
    """
    if title_query is None or old_tmdb_id == new_tmdb_id:
        return
    siblings = db_session.exec(
        select(TmdbLookupCache).where(
            col(TmdbLookupCache.title_query) == title_query,
            col(TmdbLookupCache.tmdb_id) == old_tmdb_id,
            col(TmdbLookupCache.id) != corrected_cache_id,
        )
    ).all()
    for sibling in siblings:
        sibling_id = sibling.id
        if sibling_id is None:
            continue
        sibling.tmdb_id = new_tmdb_id
        sibling.is_manual_override = True
        sibling.updated_at = now_amsterdam_naive()
        db_session.commit()
        movies_service.reassign_movies_for_cache_correction(
            session=db_session,
            cache_id=sibling_id,
            old_tmdb_id=old_tmdb_id,
            new_tmdb_id=new_tmdb_id,
        )
        db_session.commit()


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
    normalized_title_query = str(payload.get("title_query", title_query))
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
                    title_query=normalized_title_query,
                    tmdb_id=tmdb_id,
                    confidence=confidence,
                    # A human said so, so no later scraper run may undo it.
                    is_manual_override=True,
                    created_at=now,
                    updated_at=now,
                )
            )
            db_session.commit()
            return

        old_tmdb_id = cached.tmdb_id
        cache_id = cached.id
        cached.tmdb_id = tmdb_id
        cached.confidence = confidence
        cached.title_query = normalized_title_query
        cached.is_manual_override = True
        cached.updated_at = now
        db_session.commit()

        # A real correction (not first-time population): fix every movie
        # this cache entry already produced, immediately.
        if (
            cache_id is not None
            and old_tmdb_id is not None
            and tmdb_id is not None
            and old_tmdb_id != tmdb_id
        ):
            movies_service.reassign_movies_for_cache_correction(
                session=db_session,
                cache_id=cache_id,
                old_tmdb_id=old_tmdb_id,
                new_tmdb_id=tmdb_id,
            )
            db_session.commit()
            _propagate_correction_to_sibling_entries(
                db_session=db_session,
                corrected_cache_id=cache_id,
                title_query=normalized_title_query,
                old_tmdb_id=old_tmdb_id,
                new_tmdb_id=tmdb_id,
            )

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


def search_tmdb_lookup_cache_entries(
    *,
    title_query: str,
    session: Session | None = None,
    limit: int = 20,
) -> list[TmdbLookupCache]:
    """Find cached lookup entries whose payload mentions the given title.

    Used by the admin correction UI so an entry can be picked by id instead
    of reconstructing its exact lookup payload (which is what the entry's
    own lookup_hash is keyed on).
    """
    normalized = _normalize_title_search_query(title_query)
    stmt = (
        select(TmdbLookupCache)
        .where(col(TmdbLookupCache.lookup_payload).ilike(f"%{normalized}%"))
        .order_by(col(TmdbLookupCache.updated_at).desc())
        .limit(limit)
    )

    def run(db_session: Session) -> list[TmdbLookupCache]:
        return list(db_session.exec(stmt).all())

    if session is not None:
        return run(session)
    with get_db_context() as db_session:
        return run(db_session)


def correct_tmdb_lookup_cache_entry(
    *,
    cache_id: int,
    tmdb_id: int | None,
    confidence: float | None = None,
    session: Session | None = None,
) -> tmdb_core.TmdbLookupCacheEntry:
    """Correct an existing lookup-cache row by id and immediately reassign
    every movie/showtime it already produced onto the corrected TMDB id.

    Unlike `upsert_tmdb_lookup_cache_entry`, this never reconstructs or
    matches a lookup_hash, so it can't silently miss the target row and
    insert a disconnected duplicate the way a payload-guessing correction
    can.
    """
    now = now_amsterdam_naive()

    def correct_in_session(db_session: Session) -> tmdb_core.TmdbLookupCacheEntry:
        cached = db_session.get(TmdbLookupCache, cache_id)
        if cached is None:
            raise ValueError(f"TMDB lookup cache entry {cache_id} not found")

        old_tmdb_id = cached.tmdb_id
        cached.tmdb_id = tmdb_id
        cached.confidence = confidence
        # Flagged so no later automated lookup overwrites this row, and so a
        # scrape whose payload has drifted (a reordered cast list, a runtime
        # that has since been filled in) can still find the decision by title
        # instead of resolving the film from scratch and getting it wrong again.
        cached.is_manual_override = True
        if cached.title_query is None:
            cached.title_query = _title_query_from_payload(cached.lookup_payload)
        cached.updated_at = now
        db_session.commit()

        if old_tmdb_id is not None and tmdb_id is not None and old_tmdb_id != tmdb_id:
            movies_service.reassign_movies_for_cache_correction(
                session=db_session,
                cache_id=cache_id,
                old_tmdb_id=old_tmdb_id,
                new_tmdb_id=tmdb_id,
            )
            db_session.commit()
            _propagate_correction_to_sibling_entries(
                db_session=db_session,
                corrected_cache_id=cache_id,
                title_query=cached.title_query,
                old_tmdb_id=old_tmdb_id,
                new_tmdb_id=tmdb_id,
            )

        tmdb_core.set_memory_lookup_cache(
            payload_json=cached.lookup_payload,
            payload_hash=cached.lookup_hash,
            lookup_result=tmdb_core.TmdbLookupResult(
                tmdb_id=tmdb_id, confidence=confidence
            ),
        )
        tmdb_core.set_tmdb_cache_available(True)
        return tmdb_core.TmdbLookupCacheEntry(
            lookup_hash=cached.lookup_hash,
            lookup_payload=cached.lookup_payload,
            tmdb_id=tmdb_id,
            confidence=confidence,
        )

    if session is not None:
        return correct_in_session(session)
    with get_db_context() as db_session:
        return correct_in_session(db_session)


def reset_tmdb_runtime_state() -> None:
    """Clear TMDB runtime caches and wake all single-flight waiters."""
    tmdb_core.reset_tmdb_runtime_state()


__all__ = [
    "consume_tmdb_lookup_events",
    "upsert_tmdb_lookup_cache_entry",
    "search_tmdb_lookup_cache_entries",
    "correct_tmdb_lookup_cache_entry",
    "reset_tmdb_runtime_state",
]
