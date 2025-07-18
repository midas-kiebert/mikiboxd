from datetime import datetime, timedelta
from random import randint
from typing import Protocol

import pytest
from sqlmodel import Session

from app import crud
from app.models import Showtime, ShowtimeCreate
from app.tests.utils.utils import random_lower_string

__all__ = [
    "showtime_factory",
]


class ShowtimeFactory(Protocol):
    def __call__(
        self,
        *,
        id: int | None = None,
        dt: datetime | None = None,
        theatre: str | None = None,
        ticket_link: str | None = None,
        movie_id: int,
        cinema_id: int,
    ) -> Showtime:
        ...


@pytest.fixture
def showtime_factory(db_transaction: Session) -> ShowtimeFactory:
    def factory(
        *,
        id: int | None = None,
        dt: datetime | None = None,
        theatre: str | None = None,
        ticket_link: str | None = None,
        movie_id: int,
        cinema_id: int,
    ) -> Showtime:
        # default time tomorrow at 8 PM
        showtime_in = ShowtimeCreate(
            id=id or randint(1, 1 << 31),  # Random ID
            datetime=dt or datetime.now() + timedelta(days=1),
            theatre=theatre or random_lower_string(),
            ticket_link=ticket_link or random_lower_string(),
            movie_id=movie_id,
            cinema_id=cinema_id,
        )
        showtime = crud.create_showtime(
            session=db_transaction,
            showtime_create=showtime_in,
        )
        return showtime

    return factory
