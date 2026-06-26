"""Superuser-only admin endpoints: usage analytics and moderation tools.

Every route here requires get_current_active_superuser — see the existing
/utils/tmdb-cache/override/ endpoint for the same gating pattern.
"""

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status

from app.api.deps import SessionDep, get_current_active_superuser
from app.core.enums import ShowtimeReportStatus
from app.crud import movie as movie_crud
from app.crud import showtime as showtime_crud
from app.crud import showtime_report as showtime_report_crud
from app.models.auth_schemas import Message
from app.models.movie import MovieUpdate
from app.schemas.admin import AdminMoviePublic, AdminShowtimePublic, AdminShowtimeUpdate
from app.schemas.analytics_dashboard import AnalyticsOverview
from app.schemas.showtime_report import ShowtimeReportAdminView, ShowtimeReportUpdate
from app.services import analytics_dashboard as analytics_dashboard_service
from app.utils import now_amsterdam_naive

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(get_current_active_superuser)],
)


@router.get("/analytics/overview", response_model=AnalyticsOverview)
def get_analytics_overview(
    *, session: SessionDep, window_days: int = 30
) -> AnalyticsOverview:
    return analytics_dashboard_service.get_overview(
        session=session, window_days=window_days
    )


@router.get("/movies", response_model=list[AdminMoviePublic])
def search_movies(*, session: SessionDep, q: str, limit: int = 25) -> list[AdminMoviePublic]:
    movies = movie_crud.search_movies_for_admin(session=session, query=q, limit=limit)
    return [AdminMoviePublic.model_validate(movie) for movie in movies]


@router.patch("/movies/{movie_id}", response_model=AdminMoviePublic)
def update_movie(
    *, session: SessionDep, movie_id: int, payload: MovieUpdate
) -> AdminMoviePublic:
    movie = movie_crud.get_movie_by_id(session=session, id=movie_id)
    if movie is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Movie not found"
        )
    movie_crud.update_movie(db_movie=movie, movie_update=payload)
    session.commit()
    return AdminMoviePublic.model_validate(movie)


def _to_admin_showtime_public(showtime) -> AdminShowtimePublic:
    return AdminShowtimePublic(
        id=showtime.id,
        datetime=showtime.datetime,
        end_datetime=showtime.end_datetime,
        ticket_link=showtime.ticket_link,
        subtitles=showtime.subtitles,
        movie_id=showtime.movie_id,
        movie_title=showtime.movie.title,
        cinema_id=showtime.cinema_id,
        cinema_name=showtime.cinema.name,
    )


@router.get("/showtimes", response_model=list[AdminShowtimePublic])
def search_showtimes(
    *,
    session: SessionDep,
    cinema_id: int | None = None,
    movie_id: int | None = None,
    from_datetime: dt.datetime | None = None,
    to_datetime: dt.datetime | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[AdminShowtimePublic]:
    showtimes = showtime_crud.search_showtimes_for_admin(
        session=session,
        cinema_id=cinema_id,
        movie_id=movie_id,
        from_datetime=from_datetime,
        to_datetime=to_datetime,
        limit=limit,
        offset=offset,
    )
    return [_to_admin_showtime_public(showtime) for showtime in showtimes]


@router.patch("/showtimes/{showtime_id}", response_model=AdminShowtimePublic)
def update_showtime(
    *, session: SessionDep, showtime_id: int, payload: AdminShowtimeUpdate
) -> AdminShowtimePublic:
    showtime = showtime_crud.get_showtime_by_id(session=session, showtime_id=showtime_id)
    if showtime is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Showtime not found"
        )
    update_data = payload.model_dump(exclude_unset=True)
    showtime_crud.update_showtime(showtime=showtime, update_data=update_data)
    session.commit()
    return _to_admin_showtime_public(showtime)


@router.delete("/showtimes/{showtime_id}", response_model=Message)
def delete_showtime(*, session: SessionDep, showtime_id: int) -> Message:
    showtime = showtime_crud.get_showtime_by_id(session=session, showtime_id=showtime_id)
    if showtime is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Showtime not found"
        )
    showtime_crud.delete_showtime(session=session, showtime=showtime)
    session.commit()
    return Message(message="Showtime deleted successfully")


@router.get("/showtime-reports", response_model=list[ShowtimeReportAdminView])
def list_showtime_reports(
    *, session: SessionDep, status: ShowtimeReportStatus | None = None
) -> list[ShowtimeReportAdminView]:
    rows = showtime_report_crud.list_reports(session=session, status=status)
    return [
        ShowtimeReportAdminView(
            id=report.id,
            showtime_id=report.showtime_id,
            movie_title=movie.title,
            cinema_name=cinema.name,
            showtime_datetime=showtime.datetime,
            reporter_id=reporter.id,
            reporter_email=reporter.email,
            reason=report.reason,
            message=report.message,
            status=report.status,
            created_at=report.created_at,
            resolved_at=report.resolved_at,
        )
        for report, showtime, movie, cinema, reporter in rows
    ]


@router.patch("/showtime-reports/{report_id}", response_model=Message)
def update_showtime_report(
    *, session: SessionDep, report_id: int, payload: ShowtimeReportUpdate
) -> Message:
    report = showtime_report_crud.get_report_by_id(session=session, report_id=report_id)
    if report is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Report not found"
        )
    resolved_at = (
        now_amsterdam_naive()
        if payload.status != ShowtimeReportStatus.OPEN
        else None
    )
    showtime_report_crud.update_status(
        report=report, status=payload.status, resolved_at=resolved_at
    )
    session.commit()
    return Message(message="Report updated successfully")
