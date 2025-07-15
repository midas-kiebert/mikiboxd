from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import Movie, MovieCreate, MoviePublic, MovieSummaryPublic

router = APIRouter(prefix="/movies", tags=["movies"])


@router.post("/", response_model=MoviePublic)
def create_movie(*, session: SessionDep, movie_in: MovieCreate) -> Any:
    """
    Create a new movie.
    """
    db_obj = Movie.model_validate(movie_in)
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj


@router.get("/", response_model=list[MovieSummaryPublic])
def read_movies(
    session: SessionDep,
    offset: int = Query(0, ge=0, description="Number of items to skip"),
    limit: int = Query(20, ge=1, le=50, description="Max number of items to return"),
    showtime_limit: int = Query(
        5, ge=1, le=10, description="Max number of showtimes per movie"
    ),
    snapshot_time: datetime = Query(default_factory=datetime.utcnow),
    query: str | None = Query(
        None, description="Search query for movie titles, optional"
    ),
) -> Any:
    snapshot_time_local = snapshot_time.astimezone(
        ZoneInfo("Europe/Amsterdam")
    ).replace(tzinfo=None)
    movies = crud.get_movies(
        session=session,
        limit=limit,
        offset=offset,
        showtime_limit=showtime_limit,
        snapshot_time=snapshot_time_local,
        query=query,
    )
    return movies


# KEEP AT THE BOTTOM
@router.get("/{id}", response_model=MoviePublic)
def read_movie(*, session: SessionDep, id: int, current_user: CurrentUser) -> Any:
    """
    Get movie by TMDB ID.
    """
    movie = crud.get_movie_by_id(
        session=session,
        id=id,
        user_id=current_user.id,  # Assuming user_id is not needed for this endpoint
    )
    return movie
