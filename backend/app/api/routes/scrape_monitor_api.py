"""Read-only scrape-monitor endpoints for machine consumers.

Same data as the /admin/scrape/* routes, gated by a static API key
(verify_scrape_monitor_api_key) instead of a superuser JWT, so an unattended
agent can poll scrape-run/recap health without holding a login session.
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi import status as http_status

from app.api.deps import SessionDep, verify_scrape_monitor_api_key
from app.schemas.scrape_monitor import (
    ScrapeMonitorResponse,
    ScrapeRecapDetail,
    ScrapeRecapView,
)
from app.services import scrape_monitor as scrape_monitor_service

router = APIRouter(
    prefix="/monitor/scrape",
    tags=["scrape-monitor"],
    dependencies=[Depends(verify_scrape_monitor_api_key)],
)


@router.get("/runs", response_model=ScrapeMonitorResponse)
def get_scrape_runs(*, session: SessionDep, hours: int = 48) -> ScrapeMonitorResponse:
    """Per-stream scrape-run history with deltas + anomaly flags (JSON = script/LLM friendly)."""
    return scrape_monitor_service.get_scrape_runs(session=session, window_hours=hours)


@router.get("/recaps", response_model=list[ScrapeRecapView])
def list_scrape_recaps(
    *, session: SessionDep, limit: int = 20
) -> list[ScrapeRecapView]:
    return scrape_monitor_service.list_recaps(session=session, limit=limit)


@router.get("/recaps/{recap_id}", response_model=ScrapeRecapDetail)
def get_scrape_recap(*, session: SessionDep, recap_id: int) -> ScrapeRecapDetail:
    recap = scrape_monitor_service.get_recap(session=session, recap_id=recap_id)
    if recap is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Recap not found"
        )
    return recap


@router.get("/recaps/{recap_id}/attachments/{filename}")
def get_scrape_recap_attachment(
    *, session: SessionDep, recap_id: int, filename: str
) -> Response:
    """Raw attachment bytes (the machine-readable per-run traces: TMDB lookups, run details)."""
    result = scrape_monitor_service.get_recap_attachment(
        session=session, recap_id=recap_id, filename=filename
    )
    if result is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Attachment not found"
        )
    data, mime_type = result
    return Response(content=data, media_type=mime_type)
