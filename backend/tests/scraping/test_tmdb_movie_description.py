"""Regression coverage for the `Movie.description` field sourced from TMDB `overview`.

Covers `_parse_tmdb_movie_details` extracting/normalizing `overview` into
`TmdbMovieDetails.description`, and `_movie_to_tmdb_details` carrying a
persisted movie's `description` back through when a fresh TMDB refetch is
skipped in favor of local DB metadata.
"""

import pytest

from app.scraping.tmdb_lookup import _parse_tmdb_movie_details
from app.scraping.tmdb_movie_details import _movie_to_tmdb_details

_BASE_PAYLOAD: dict = {
    "id": 42,
    "title": "The Virgin Suicides",
    "original_title": "The Virgin Suicides",
    "release_date": "1999-05-19",
}


def test_parse_tmdb_movie_details_extracts_and_strips_overview() -> None:
    payload = {**_BASE_PAYLOAD, "overview": "  A story about five sisters.  "}

    details = _parse_tmdb_movie_details(payload, enriched_at=None)

    assert details is not None
    assert details.description == "A story about five sisters."


@pytest.mark.parametrize(
    "overview_value",
    [None, "", "   ", 123, ["not", "a", "string"]],
)
def test_parse_tmdb_movie_details_treats_missing_or_invalid_overview_as_none(
    overview_value: object,
) -> None:
    payload = {**_BASE_PAYLOAD, "overview": overview_value}

    details = _parse_tmdb_movie_details(payload, enriched_at=None)

    assert details is not None
    assert details.description is None


def test_parse_tmdb_movie_details_treats_absent_overview_key_as_none() -> None:
    payload = dict(_BASE_PAYLOAD)

    details = _parse_tmdb_movie_details(payload, enriched_at=None)

    assert details is not None
    assert details.description is None


def test_movie_to_tmdb_details_carries_description_through(
    movie_factory,
) -> None:
    movie = movie_factory(description="A story about five sisters.")

    details = _movie_to_tmdb_details(movie)

    assert details is not None
    assert details.description == "A story about five sisters."


def test_movie_to_tmdb_details_carries_none_description_through(
    movie_factory,
) -> None:
    movie = movie_factory(description=None)

    details = _movie_to_tmdb_details(movie)

    assert details is not None
    assert details.description is None
