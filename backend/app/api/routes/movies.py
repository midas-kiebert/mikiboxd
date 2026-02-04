from fastapi import APIRouter, Depends, Query

from app.api.deps import CurrentUser, SessionDep
from app.inputs.movie import Filters, get_filters
from app.schemas.movie import MovieLoggedIn, MovieSummaryLoggedIn
from app.schemas.showtime import ShowtimeInMovieLoggedIn
from app.services import movies as movies_service

router = APIRouter(prefix="/movies", tags=["movies"])


@router.get("/", response_model=list[MovieSummaryLoggedIn])
def read_movies(
    session: SessionDep,
    current_user: CurrentUser,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=50),
    showtime_limit: int = Query(5, ge=1, le=10),
    filters: Filters = Depends(get_filters),
) -> list[MovieSummaryLoggedIn]:
    movies = movies_service.get_movie_summaries(
        session=session,
        user_id=current_user.id,
        limit=limit,
        offset=offset,
        showtime_limit=showtime_limit,
        filters=filters,
    )
    return movies


@router.get("/{id}/showtimes", response_model=list[ShowtimeInMovieLoggedIn])
def read_movie_showtimes(
    *,
    session: SessionDep,
    id: int,
    current_user: CurrentUser,
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0),
    filters: Filters = Depends(get_filters),
) -> list[ShowtimeInMovieLoggedIn]:
    return movies_service.get_movie_showtimes(
        session=session,
        movie_id=id,
        current_user=current_user.id,
        limit=limit,
        offset=offset,
        filters=filters,
    )


# KEEP AT THE BOTTOM
@router.get("/{id}", response_model=MovieLoggedIn)
def read_movie(
    *,
    session: SessionDep,
    id: int,
    current_user: CurrentUser,
    showtime_limit: int | None = Query(None, ge=0, le=200),
    filters: Filters = Depends(get_filters),
) -> MovieLoggedIn:
    movie = movies_service.get_movie_by_id(
        session=session,
        movie_id=id,
        current_user=current_user.id,
        showtime_limit=showtime_limit,
        filters=filters,
    )

    return movie
