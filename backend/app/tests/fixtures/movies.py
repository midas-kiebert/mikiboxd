from random import randint
from typing import Protocol

import pytest
from sqlmodel import Session

from app import crud
from app.models import Movie, MovieCreate
from app.tests.utils.utils import random_lower_string

__all__ = [
    "movie_factory",
]


class MovieFactory(Protocol):
    def __call__(
        self,
        *,
        title: str | None = None,
        id: int | None = None,
        poster_link: str | None = None,
        letterboxd_slug: str | None = None,
    ) -> Movie:
        ...


@pytest.fixture
def movie_factory(db_transaction: Session) -> MovieFactory:
    def factory(
        *,
        title: str | None = None,
        id: int | None = None,
        poster_link: str | None = None,
        letterboxd_slug: str | None = None,
    ) -> Movie:
        movie_in = MovieCreate(
            title=title or random_lower_string(),
            id=id or randint(1, 1 << 31),  # Random TMDB ID
            poster_link=poster_link,
            letterboxd_slug=letterboxd_slug,
        )
        movie = crud.create_movie(
            session=db_transaction,
            movie_create=movie_in,
        )
        return movie

    return factory
