from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.schemas.showtime import ShowtimeLoggedIn
from app.services import showtimes as showtimes_service

router = APIRouter(prefix="/showtimes", tags=["showtimes"])


@router.post("/selection/{showtime_id}", response_model=ShowtimeLoggedIn)
def select_showtime(
    *,
    session: SessionDep,
    showtime_id: int,
    current_user: CurrentUser,
) -> ShowtimeLoggedIn:
    return showtimes_service.select_showtime(
        session=session, showtime_id=showtime_id, user_id=current_user.id
    )


@router.delete("/selection/{showtime_id}", response_model=ShowtimeLoggedIn)
def delete_showtime_selection(
    *, session: SessionDep, showtime_id: int, current_user: CurrentUser
) -> ShowtimeLoggedIn:
    return showtimes_service.delete_showtime_selection(
        session=session, showtime_id=showtime_id, user_id=current_user.id
    )


@router.put("/selection/{showtime_id}", response_model=ShowtimeLoggedIn)
def toggle_showtime_selection(
    *, session: SessionDep, showtime_id: int, current_user: CurrentUser
) -> ShowtimeLoggedIn:
    return showtimes_service.toggle_showtime_selection(
        session=session, showtime_id=showtime_id, user_id=current_user.id
    )
