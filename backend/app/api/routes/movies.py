"""Movie endpoints.

These are browse endpoints: what is playing is public, so they answer without a
token as well as with one, and annotate the result with the requester's own
data only when there is a requester. See `app.core.viewer`.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status
from fastapi.responses import HTMLResponse

from app.api.deps import OPTIONAL_AUTH_OPENAPI_EXTRA, CurrentViewer, SessionDep
from app.core.config import settings
from app.inputs.movie import Filters, get_filters
from app.models.movie import Movie
from app.schemas.movie import MoviePublic, MovieSummaryPublic
from app.schemas.showtime import ShowtimeInMoviePublic
from app.services import movies as movies_service
from app.services.share_preview import (
    DEFAULT_SHARE_PREVIEW_IMAGE,
    render_share_preview_html,
)

router = APIRouter(prefix="/movies", tags=["movies"])


@router.get("/count", openapi_extra=OPTIONAL_AUTH_OPENAPI_EXTRA)
def count_movies(
    session: SessionDep,
    viewer: CurrentViewer,
    filters: Filters = Depends(get_filters),
) -> int:
    return movies_service.count_movie_summaries(
        session=session,
        user_id=viewer,
        filters=filters,
    )


@router.get(
    "/",
    response_model=list[MovieSummaryPublic],
    openapi_extra=OPTIONAL_AUTH_OPENAPI_EXTRA,
)
def read_movies(
    session: SessionDep,
    viewer: CurrentViewer,
    offset: int = Query(0, ge=0),
    limit: int = Query(10, ge=1, le=50),
    showtime_limit: int = Query(5, ge=1, le=10),
    filters: Filters = Depends(get_filters),
) -> list[MovieSummaryPublic]:
    movies = movies_service.get_movie_summaries(
        session=session,
        user_id=viewer,
        limit=limit,
        offset=offset,
        showtime_limit=showtime_limit,
        filters=filters,
    )
    return movies


@router.get(
    "/{id}/showtimes",
    response_model=list[ShowtimeInMoviePublic],
    openapi_extra=OPTIONAL_AUTH_OPENAPI_EXTRA,
)
def read_movie_showtimes(
    *,
    session: SessionDep,
    id: int,
    viewer: CurrentViewer,
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    filters: Filters = Depends(get_filters),
) -> list[ShowtimeInMoviePublic]:
    return movies_service.get_movie_showtimes(
        session=session,
        movie_id=id,
        current_user=viewer,
        limit=limit,
        offset=offset,
        filters=filters,
    )


@router.get(
    "/{id}/share-preview",
    response_class=HTMLResponse,
    include_in_schema=False,
)
def get_movie_share_preview(*, session: SessionDep, id: int) -> HTMLResponse:
    """Unauthenticated HTML page carrying per-movie OpenGraph tags.

    Only ever hit by link-preview crawlers (WhatsApp, iMessage, Slack, ...) —
    nginx routes them here based on User-Agent instead of the SPA's static
    index.html, which can't vary per movie. Real visitors never see this
    page; nginx sends them straight to the SPA.
    """
    movie = session.get(Movie, id)
    if movie is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Movie not found"
        )

    body = render_share_preview_html(
        title=movie.title,
        description="Check it out on MiKiNO.",
        image_url=movie.poster_link or DEFAULT_SHARE_PREVIEW_IMAGE,
        page_url=f"{settings.FRONTEND_HOST}/movie/{id}",
    )
    return HTMLResponse(content=body)


# KEEP AT THE BOTTOM
@router.get(
    "/{id}", response_model=MoviePublic, openapi_extra=OPTIONAL_AUTH_OPENAPI_EXTRA
)
def read_movie(
    *,
    session: SessionDep,
    id: int,
    viewer: CurrentViewer,
    showtime_limit: int | None = Query(None, ge=0, le=200),
    filters: Filters = Depends(get_filters),
) -> MoviePublic:
    movie = movies_service.get_movie_by_id(
        session=session,
        movie_id=id,
        current_user=viewer,
        showtime_limit=showtime_limit,
        filters=filters,
    )

    return movie
