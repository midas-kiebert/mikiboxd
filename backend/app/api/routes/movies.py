from datetime import datetime

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, SessionDep
from app.schemas.movie import MovieLoggedIn, MovieSummaryLoggedIn
from app.services import movies as movies_service
from app.utils import now_amsterdam_naive

router = APIRouter(prefix="/movies", tags=["movies"])


@router.get("/", response_model=list[MovieSummaryLoggedIn])
def read_movies(
    session: SessionDep,
    current_user: CurrentUser,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=50),
    showtime_limit: int = Query(5, ge=1, le=10),
    snapshot_time: datetime = Query(default_factory=now_amsterdam_naive),
    query: str = Query(""),
    watchlist_only: bool = Query(False),
) -> list[MovieSummaryLoggedIn]:
    print("Snapshot time:", snapshot_time)
    movies = movies_service.get_movie_summaries(
        session=session,
        user_id=current_user.id,
        limit=limit,
        offset=offset,
        showtime_limit=showtime_limit,
        snapshot_time=snapshot_time,
        query=query,
        watchlist_only=watchlist_only,
    )
    return movies


# KEEP AT THE BOTTOM
@router.get("/{id}", response_model=MovieLoggedIn)
def read_movie(
    *,
    session: SessionDep,
    id: int,
    current_user: CurrentUser,
    snapshot_time: datetime = Query(default_factory=now_amsterdam_naive),
) -> MovieLoggedIn:
    movie = movies_service.get_movie_by_id(
        session=session,
        movie_id=id,
        current_user=current_user.id,
        snapshot_time=snapshot_time,
    )

    return movie
