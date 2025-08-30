from datetime import datetime

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, SessionDep
from app.schemas.showtime import ShowtimeLoggedIn
from app.services import showtimes as showtimes_service
from app.utils import now_amsterdam_naive

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


@router.get("/")
def get_main_page_showtimes(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    snapshot_time: datetime = Query(default_factory=now_amsterdam_naive),
    limit: int = 20,
    offset: int = 0,
) -> list[ShowtimeLoggedIn]:
    return showtimes_service.get_main_page_showtimes(
        session=session,
        current_user_id=current_user.id,
        limit=limit,
        offset=offset,
        snapshot_time=snapshot_time,
    )
