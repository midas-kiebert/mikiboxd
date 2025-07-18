from random import randint
from typing import Protocol

import pytest
from sqlmodel import Session

from app import crud
from app.models import City, CityCreate
from app.tests.utils.utils import random_lower_string

__all__ = [
    "city_factory",
]


class CityFactory(Protocol):
    def __call__(
        self,
        *,
        id: int | None = None,
        name: str | None = None,
    ) -> City:
        ...


@pytest.fixture
def city_factory(db_transaction: Session) -> CityFactory:
    def factory(
        *,
        id: int | None = None,
        name: str | None = None,
    ) -> City:
        city_in = CityCreate(
            id=id or randint(1, 1 << 31),  # Random ID
            name=name or random_lower_string(),
        )
        city = crud.upsert_city(
            session=db_transaction,
            city=city_in,
        )
        return city

    return factory
