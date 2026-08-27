import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Field, SQLModel

from app.api.deps import SessionDep, get_current_active_superuser
from app.scraping.tmdb_runtime import (
    correct_tmdb_lookup_cache_entry,
    search_tmdb_lookup_cache_entries,
    upsert_tmdb_lookup_cache_entry,
)

router = APIRouter(prefix="/utils", tags=["utils"])
logger = logging.getLogger(__name__)


class TmdbCacheOverrideRequest(SQLModel):
    title_query: str = Field(min_length=1)
    director_names: list[str] = Field(default_factory=list)
    actor_name: str | None = None
    year: int | None = None
    duration_minutes: int | None = None
    spoken_languages: list[str] | None = None
    tmdb_id: int | None = None
    confidence: float | None = None


class TmdbCacheOverrideResponse(SQLModel):
    lookup_hash: str
    lookup_payload: str
    tmdb_id: int | None
    confidence: float | None


class TmdbCacheSearchResult(SQLModel):
    id: int
    lookup_payload: str
    tmdb_id: int | None
    confidence: float | None


class TmdbCacheCorrectionRequest(SQLModel):
    cache_id: int
    tmdb_id: int | None = None
    confidence: float | None = None


class DigestFrequencyInfo(SQLModel):
    label: str
    description: str


class DigestFrequencyInfoResponse(SQLModel):
    daily: DigestFrequencyInfo
    weekly_or_urgent: DigestFrequencyInfo


@router.get("/health-check/")
async def health_check() -> bool:
    return True


@router.get("/watchlist-digest-frequency-info/")
async def get_watchlist_digest_frequency_info() -> DigestFrequencyInfoResponse:
    return DigestFrequencyInfoResponse(
        daily=DigestFrequencyInfo(
            label="Eager",
            description=(
                "Emails you the day a watchlisted movie becomes available, however "
                "far ahead it screens — so you can book the ones that sell out."
            ),
        ),
        weekly_or_urgent=DigestFrequencyInfo(
            label="Weekly",
            description=(
                "One email on Thursday morning with the watchlisted movies screening "
                "in the next seven days. Anything further out waits its turn."
            ),
        ),
    )


@router.get(
    "/tmdb-cache/search/",
    dependencies=[Depends(get_current_active_superuser)],
)
def search_tmdb_cache_entries(
    session: SessionDep,
    title: str = Query(min_length=1),
) -> list[TmdbCacheSearchResult]:
    results = search_tmdb_lookup_cache_entries(title_query=title, session=session)
    return [
        TmdbCacheSearchResult(
            id=entry.id,
            lookup_payload=entry.lookup_payload,
            tmdb_id=entry.tmdb_id,
            confidence=entry.confidence,
        )
        for entry in results
        if entry.id is not None
    ]


@router.post(
    "/tmdb-cache/correct/",
    dependencies=[Depends(get_current_active_superuser)],
)
def correct_tmdb_cache_entry(
    request: TmdbCacheCorrectionRequest,
    session: SessionDep,
) -> TmdbCacheOverrideResponse:
    try:
        result = correct_tmdb_lookup_cache_entry(
            cache_id=request.cache_id,
            tmdb_id=request.tmdb_id,
            confidence=request.confidence,
            session=session,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    return TmdbCacheOverrideResponse(
        lookup_hash=result.lookup_hash,
        lookup_payload=result.lookup_payload,
        tmdb_id=result.tmdb_id,
        confidence=result.confidence,
    )


@router.post(
    "/tmdb-cache/override/",
    dependencies=[Depends(get_current_active_superuser)],
)
def override_tmdb_cache_entry(
    request: TmdbCacheOverrideRequest,
    session: SessionDep,
) -> TmdbCacheOverrideResponse:
    result = upsert_tmdb_lookup_cache_entry(
        title_query=request.title_query,
        director_names=request.director_names,
        actor_name=request.actor_name,
        year=request.year,
        duration_minutes=request.duration_minutes,
        spoken_languages=request.spoken_languages,
        tmdb_id=request.tmdb_id,
        confidence=request.confidence,
        session=session,
    )
    return TmdbCacheOverrideResponse(
        lookup_hash=result.lookup_hash,
        lookup_payload=result.lookup_payload,
        tmdb_id=result.tmdb_id,
        confidence=result.confidence,
    )
