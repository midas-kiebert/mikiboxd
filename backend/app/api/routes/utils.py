import logging

from fastapi import APIRouter, Depends
from sqlmodel import Field, SQLModel

from app.api.deps import SessionDep, get_current_active_superuser
from app.scraping.tmdb_runtime import upsert_tmdb_lookup_cache_entry

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


@router.get("/health-check/")
async def health_check() -> bool:
    return True


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
