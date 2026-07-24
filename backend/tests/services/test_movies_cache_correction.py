"""Regression coverage for the TMDB cache-override cascade.

When an admin corrects a `TmdbLookupCache` row's `tmdb_id`,
`reassign_movies_for_cache_correction` must move every showtime off the
stale movie onto a freshly upserted movie at the corrected id, and
unlist (never delete) the stale movie.
"""

from datetime import timedelta

from sqlmodel import Session, select

from app.models.movie import Movie
from app.models.showtime import Showtime
from app.models.tmdb_lookup_cache import TmdbLookupCache
from app.scraping.tmdb import TmdbMovieDetails
from app.services import movies as movies_services
from app.utils import now_amsterdam_naive

_cache_row_counter = 0


def _make_cache_row(*, db_transaction: Session, tmdb_id: int | None = None) -> TmdbLookupCache:
    global _cache_row_counter
    _cache_row_counter += 1
    now = now_amsterdam_naive()
    cache = TmdbLookupCache(
        lookup_hash=f"hash-{_cache_row_counter}",
        lookup_payload=f"payload-{_cache_row_counter}",
        tmdb_id=tmdb_id,
        created_at=now,
        updated_at=now,
    )
    db_transaction.add(cache)
    db_transaction.flush()
    return cache


def _tmdb_details(*, title: str = "Corrected Title") -> TmdbMovieDetails:
    return TmdbMovieDetails(
        title=title,
        original_title=None,
        release_year=2020,
        directors=["Some Director"],
        poster_url=None,
        original_language="en",
        spoken_languages=["en"],
        runtime_minutes=110,
        enriched_at=now_amsterdam_naive(),
    )


def test_reassign_movies_for_cache_correction_moves_showtimes_and_unlists_old_movie(
    *,
    db_transaction: Session,
    mocker,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    cache = _make_cache_row(db_transaction=db_transaction)
    old_movie = movie_factory(tmdb_cache_id=cache.id, currently_listed=True)
    new_tmdb_id = old_movie.id + 100_000
    cinema = cinema_factory()
    showtime = showtime_factory(cinema=cinema, movie=old_movie)

    mocker.patch(
        "app.services.movies.get_tmdb_movie_details",
        return_value=_tmdb_details(),
    )

    movies_services.reassign_movies_for_cache_correction(
        session=db_transaction,
        cache_id=cache.id,
        old_tmdb_id=old_movie.id,
        new_tmdb_id=new_tmdb_id,
    )

    new_movie = db_transaction.get(Movie, new_tmdb_id)
    assert new_movie is not None
    assert new_movie.title == "Corrected Title"

    db_transaction.refresh(showtime)
    assert showtime.movie_id == new_tmdb_id

    db_transaction.refresh(old_movie)
    assert old_movie.currently_listed is False


def test_reassign_movies_for_cache_correction_skips_conflicting_showtime(
    *,
    db_transaction: Session,
    mocker,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    cache = _make_cache_row(db_transaction=db_transaction)
    old_movie = movie_factory(tmdb_cache_id=cache.id, currently_listed=True)
    new_movie = movie_factory()
    new_tmdb_id = new_movie.id
    cinema = cinema_factory()
    showtime_time = now_amsterdam_naive() + timedelta(days=2)

    # A showtime already exists on the *new* movie at the same
    # (cinema, datetime) as one of the old movie's showtimes — that one must
    # be left behind (not crash, not silently overwritten).
    conflicting_showtime = showtime_factory(
        cinema=cinema, movie=new_movie, datetime=showtime_time
    )
    stale_conflicting_showtime = showtime_factory(
        cinema=cinema, movie=old_movie, datetime=showtime_time
    )
    movable_showtime = showtime_factory(
        cinema=cinema, movie=old_movie, datetime=showtime_time + timedelta(hours=1)
    )

    mocker.patch(
        "app.services.movies.get_tmdb_movie_details",
        return_value=_tmdb_details(),
    )

    movies_services.reassign_movies_for_cache_correction(
        session=db_transaction,
        cache_id=cache.id,
        old_tmdb_id=old_movie.id,
        new_tmdb_id=new_tmdb_id,
    )

    db_transaction.refresh(stale_conflicting_showtime)
    db_transaction.refresh(movable_showtime)
    db_transaction.refresh(conflicting_showtime)

    # The conflicting row stays on the old movie id rather than erroring out...
    assert stale_conflicting_showtime.movie_id == old_movie.id
    # ...while the non-conflicting showtime is reassigned as usual.
    assert movable_showtime.movie_id == new_tmdb_id
    assert conflicting_showtime.movie_id == new_tmdb_id

    db_transaction.refresh(old_movie)
    # Unlisted regardless of the partial reassignment.
    assert old_movie.currently_listed is False

    remaining_old_showtimes = list(
        db_transaction.exec(
            select(Showtime).where(Showtime.movie_id == old_movie.id)
        ).all()
    )
    assert [s.id for s in remaining_old_showtimes] == [stale_conflicting_showtime.id]


def test_reassign_movies_for_cache_correction_is_noop_when_ids_match(
    *,
    db_transaction: Session,
    mocker,
    movie_factory,
):
    cache = _make_cache_row(db_transaction=db_transaction)
    movie = movie_factory(tmdb_cache_id=cache.id)
    get_details = mocker.patch("app.services.movies.get_tmdb_movie_details")

    movies_services.reassign_movies_for_cache_correction(
        session=db_transaction,
        cache_id=cache.id,
        old_tmdb_id=movie.id,
        new_tmdb_id=movie.id,
    )

    get_details.assert_not_called()


def test_reassign_movies_for_cache_correction_is_noop_when_cache_id_mismatched(
    *,
    db_transaction: Session,
    mocker,
    movie_factory,
    showtime_factory,
):
    """A stale/superseded cache correction (the movie has since been
    reassigned again, so its `tmdb_cache_id` no longer matches) must not
    re-trigger a reassignment."""
    first_cache = _make_cache_row(db_transaction=db_transaction)
    second_cache = _make_cache_row(db_transaction=db_transaction)
    old_movie = movie_factory(tmdb_cache_id=second_cache.id, currently_listed=True)
    showtime = showtime_factory(movie=old_movie)
    get_details = mocker.patch("app.services.movies.get_tmdb_movie_details")

    movies_services.reassign_movies_for_cache_correction(
        session=db_transaction,
        cache_id=first_cache.id,
        old_tmdb_id=old_movie.id,
        new_tmdb_id=old_movie.id + 100_000,
    )

    get_details.assert_not_called()
    db_transaction.refresh(old_movie)
    db_transaction.refresh(showtime)
    assert old_movie.currently_listed is True
    assert showtime.movie_id == old_movie.id
