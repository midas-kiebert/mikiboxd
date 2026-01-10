from fastapi import APIRouter, Depends

from app.api.deps import CurrentUser, SessionDep
from app.inputs.movie import Filters, get_filters
from app.schemas.showtime import ShowtimeLoggedIn, ShowtimeSelectionUpdate
from app.services import showtimes as showtimes_service

router = APIRouter(prefix="/showtimes", tags=["showtimes"])


@router.put("/selection/{showtime_id}", response_model=ShowtimeLoggedIn)
def update_showtime_selection(
    *,
    session: SessionDep,
    showtime_id: int,
    payload: ShowtimeSelectionUpdate,
    current_user: CurrentUser,
    filters: Filters = Depends(get_filters),
) -> ShowtimeLoggedIn:
    return showtimes_service.update_showtime_selection(
        session=session,
        showtime_id=showtime_id,
        user_id=current_user.id,
        going_status=payload.going_status,
        filters=filters,
    )


@router.get("/")
def get_main_page_showtimes(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = 20,
    offset: int = 0,
    filters: Filters = Depends(get_filters),
) -> list[ShowtimeLoggedIn]:
    return showtimes_service.get_main_page_showtimes(
        session=session,
        current_user_id=current_user.id,
        limit=limit,
        offset=offset,
        filters=filters,
    )
