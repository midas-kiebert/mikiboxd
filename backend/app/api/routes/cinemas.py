from fastapi import APIRouter

from app.api.deps import (
    SessionDep,
)
from app.schemas.cinema import CinemaPublic
from app.services import cinemas as cinemas_service

router = APIRouter(prefix="/cinemas", tags=["cinemas"])


@router.get("/", response_model=list[CinemaPublic])
def get_all_cinemas(
    session: SessionDep,
) -> list[CinemaPublic]:
    return cinemas_service.get_all_cinemas(session=session)
