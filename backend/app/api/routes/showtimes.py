from typing import Any

from fastapi import APIRouter

from app import crud
from app.api.deps import CurrentUser, SessionDep
from app.models import Showtime, ShowtimeCreate, ShowtimeInMoviePublic, ShowtimePublic

router = APIRouter(prefix="/showtimes", tags=["showtimes"])


@router.post("/", response_model=ShowtimePublic)
def create_showtime(*, session: SessionDep, showtime_create: ShowtimeCreate) -> Any:
    """
    Create a new movie.
    """
    db_obj = Showtime.model_validate(showtime_create)
    session.add(db_obj)
    session.commit()
    session.refresh(db_obj)
    return db_obj


@router.get("/movie/{movie_id}", response_model=list[ShowtimeInMoviePublic])
def get_all_showtimes_for_movie(
    *,
    session: SessionDep,
    movie_id: int,
) -> list[ShowtimeInMoviePublic]:
    showtimes = crud.get_all_showtimes_for_movie(
        session=session,
        movie_id=movie_id,
    )
    showtimes_public = [
        ShowtimeInMoviePublic.model_validate(showtime) for showtime in showtimes
    ]
    return showtimes_public


@router.post("/selection/{showtime_id}")
def select_showtime(
    *, session: SessionDep, showtime_id: int, current_user: CurrentUser
) -> Any:
    """
    Select a showtime for a user.
    """
    crud.add_showtime_selection(
        session=session, showtime_id=showtime_id, user_id=current_user.id
    )
    return {"message": "Showtime selected successfully."}


@router.delete("/selection/{showtime_id}")
def delete_showtime_selection(
    *, session: SessionDep, showtime_id: int, current_user: CurrentUser
) -> Any:
    """
    Delete a user's selection for a showtime.
    """
    crud.delete_showtime_selection(
        session=session, showtime_id=showtime_id, user_id=current_user.id
    )
    return {"message": "Showtime selection deleted successfully."}
