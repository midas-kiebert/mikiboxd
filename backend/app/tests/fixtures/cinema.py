from typing import Protocol

import pytest
from sqlmodel import Session

from app import crud
from app.models import Cinema, CinemaCreate
from app.tests.utils.utils import random_lower_string

__all__ = [
    "cinema_factory",
]


class CinemaFactory(Protocol):
    def __call__(
        self,
        *,
        name: str | None = None,
        city_id: int,
        badge_bg_color: str | None = None,
        badge_text_color: str | None = None,
        url: str | None = None,
    ) -> Cinema:
        ...


@pytest.fixture
def cinema_factory(db_transaction: Session) -> CinemaFactory:
    def factory(
        *,
        name: str | None = None,
        city_id: int,
        badge_bg_color: str | None = None,
        badge_text_color: str | None = None,
        url: str | None = None,
    ) -> Cinema:
        cinema_in = CinemaCreate(
            name=name or random_lower_string(),
            city_id=city_id,
            badge_bg_color=badge_bg_color,
            badge_text_color=badge_text_color,
            url=url,
        )
        cinema = crud.upsert_cinema(session=db_transaction, cinema=cinema_in)
        return cinema

    return factory
