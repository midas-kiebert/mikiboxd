import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic.networks import EmailStr
from sqlmodel import Field, SQLModel

from app.api.deps import SessionDep, get_current_active_superuser
from app.models.auth_schemas import Message
from app.scraping.tmdb_runtime import upsert_tmdb_lookup_cache_entry
from app.utils import EmailDeliveryError, generate_test_email, send_email

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


@router.post(
    "/test-email/",
    dependencies=[Depends(get_current_active_superuser)],
    status_code=201,
)
def test_email(email_to: EmailStr) -> Message:
    """
    Test emails.
    """
    email_data = generate_test_email(email_to=email_to)
    try:
        send_email(
            email_to=email_to,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
    except EmailDeliveryError as e:
        logger.exception("Test email delivery failed for %s", email_to)
        raise HTTPException(
            status_code=502, detail=f"Could not deliver test email: {e}"
        ) from e
    return Message(message="Test email sent")


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
