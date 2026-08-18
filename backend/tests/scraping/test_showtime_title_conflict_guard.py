"""The insert-time guard that stops the Cineville duplicate being re-created.

Cineville and a cinema's own scraper regularly resolve the same screening to two
different TMDB ids, which produced two showtime rows for one screening. The
cleanup pass deleted the Cineville row every run and Cineville re-created it on
the next run, so the same handful of screenings appeared in the recap's
"Showtimes No Longer Found" list on every single scrape.
"""

from collections.abc import Generator
from datetime import datetime, timedelta

import pytest
from sqlalchemy import func
from sqlmodel import Session, select

from app.models.showtime import Showtime, ShowtimeCreate
from app.models.showtime_source_presence import ShowtimeSourcePresence
from app.models.tmdb_lookup_cache import TmdbLookupCache
from app.scraping.tmdb_config import TMDB_LOOKUP_PAYLOAD_VERSION
from app.services import showtimes as showtimes_service
from app.services.showtime_title_conflict import consume_source_disagreements
from app.utils import now_amsterdam_naive


def _add_presence(
    *,
    session: Session,
    source_stream: str,
    showtime_id: int,
    active: bool = True,
) -> None:
    session.add(
        ShowtimeSourcePresence(
            source_stream=source_stream,
            source_event_key=f"{source_stream}:{showtime_id}",
            showtime_id=showtime_id,
            last_seen_at=now_amsterdam_naive(),
            missing_streak=0,
            active=active,
        )
    )


def _slot_time() -> datetime:
    return now_amsterdam_naive().replace(
        hour=19, minute=0, second=0, microsecond=0
    ) + timedelta(days=3)


@pytest.fixture(autouse=True)
def _clear_recorded_disagreements() -> Generator[None, None, None]:
    """The disagreement collector is module-level state shared across a run."""
    consume_source_disagreements()
    yield
    consume_source_disagreements()


def test_cineville_yields_to_conflicting_cinema_scraper_showtime(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    cinema = cinema_factory(cineville=True)
    cinema_movie = movie_factory(title="All About Lily Chou-Chou")
    cineville_movie = movie_factory(title="All About 'All About Lily Chou-Chou'")
    slot = _slot_time()

    cinema_showtime = showtime_factory(
        cinema=cinema,
        movie=cinema_movie,
        datetime=slot,
        ticket_link="https://cinema.example/correct",
    )
    _add_presence(
        session=db_transaction,
        source_stream=f"cinema_scraper:{cinema.id}",
        showtime_id=cinema_showtime.id,
    )
    db_transaction.flush()

    result = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=cineville_movie.id,
            cinema_id=cinema.id,
            datetime=slot,
            ticket_link="https://cineville.example/duplicate",
        ),
        commit=False,
        yield_to_conflicting_showtime=True,
    )

    assert result is not None
    assert result.id == cinema_showtime.id
    # No second row for the same screening, so nothing for the conflict cleanup
    # to delete on the next run.
    showtime_count = db_transaction.exec(
        select(func.count())
        .select_from(Showtime)
        .where(Showtime.cinema_id == cinema.id, Showtime.datetime == slot)
    ).one()
    assert showtime_count == 1

    # Yielding hides the mismatch from the site, so the recap has to say the two
    # sources disagreed — one of the two TMDB matches is wrong.
    disagreements = consume_source_disagreements()
    assert len(disagreements) == 1
    assert disagreements[0].cineville_movie_id == cineville_movie.id
    assert disagreements[0].cinema_scraper_movie_id == cinema_movie.id
    assert disagreements[0].cinema_id == cinema.id


def _attach_tmdb_cache(
    *, session: Session, movie, version: int, is_manual_override: bool = False
) -> None:
    cache = TmdbLookupCache(
        lookup_hash=f"hash-{movie.id}",
        lookup_payload=f'{{"version":{version}}}',
        tmdb_id=movie.id,
        confidence=93.0,
        is_manual_override=is_manual_override,
        created_at=now_amsterdam_naive(),
        updated_at=now_amsterdam_naive(),
    )
    session.add(cache)
    session.flush()
    movie.tmdb_cache_id = cache.id
    session.add(movie)


def test_cineville_wins_when_cinema_scraper_match_is_stale(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    """A resolver-version bump can fix a bad match going forward without
    touching the Movie row a cinema scraper already created under the old
    algorithm. When that happens the "cinema scraper always wins" default is
    backwards: cineville's fresher match should be kept instead."""
    cinema = cinema_factory(cineville=True)
    cinema_movie = movie_factory(title="All About \"All About Lily Chou-Chou\"")
    cineville_movie = movie_factory(title="All About Lily Chou-Chou")
    slot = _slot_time()

    _attach_tmdb_cache(
        session=db_transaction,
        movie=cinema_movie,
        version=TMDB_LOOKUP_PAYLOAD_VERSION - 1,
    )
    _attach_tmdb_cache(
        session=db_transaction, movie=cineville_movie, version=TMDB_LOOKUP_PAYLOAD_VERSION
    )

    cinema_showtime = showtime_factory(
        cinema=cinema,
        movie=cinema_movie,
        datetime=slot,
        ticket_link="https://cinema.example/stale",
    )
    _add_presence(
        session=db_transaction,
        source_stream=f"cinema_scraper:{cinema.id}",
        showtime_id=cinema_showtime.id,
    )
    db_transaction.flush()

    result = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=cineville_movie.id,
            cinema_id=cinema.id,
            datetime=slot,
            ticket_link="https://cineville.example/fresh",
        ),
        commit=False,
        yield_to_conflicting_showtime=True,
    )

    assert result is not None
    # Same row, same id, ticket_link and history preserved — just the correct
    # movie_id — not a second row created alongside the stale one.
    assert result.id == cinema_showtime.id
    assert result.movie_id == cineville_movie.id

    remaining = set(
        db_transaction.exec(
            select(Showtime.id).where(
                Showtime.cinema_id == cinema.id, Showtime.datetime == slot
            )
        ).all()
    )
    assert remaining == {cinema_showtime.id}

    disagreements = consume_source_disagreements()
    assert len(disagreements) == 1
    assert disagreements[0].kept_movie_id == cineville_movie.id


def test_cinema_scraper_still_wins_when_its_match_is_manually_overridden(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    """A stale payload version never overrides an admin's manual correction."""
    cinema = cinema_factory(cineville=True)
    cinema_movie = movie_factory(title="All About \"All About Lily Chou-Chou\"")
    cineville_movie = movie_factory(title="All About Lily Chou-Chou")
    slot = _slot_time()

    _attach_tmdb_cache(
        session=db_transaction,
        movie=cinema_movie,
        version=TMDB_LOOKUP_PAYLOAD_VERSION - 1,
        is_manual_override=True,
    )
    _attach_tmdb_cache(
        session=db_transaction, movie=cineville_movie, version=TMDB_LOOKUP_PAYLOAD_VERSION
    )

    cinema_showtime = showtime_factory(
        cinema=cinema,
        movie=cinema_movie,
        datetime=slot,
        ticket_link="https://cinema.example/manual",
    )
    _add_presence(
        session=db_transaction,
        source_stream=f"cinema_scraper:{cinema.id}",
        showtime_id=cinema_showtime.id,
    )
    db_transaction.flush()

    result = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=cineville_movie.id,
            cinema_id=cinema.id,
            datetime=slot,
            ticket_link="https://cineville.example/fresh",
        ),
        commit=False,
        yield_to_conflicting_showtime=True,
    )

    assert result is not None
    assert result.id == cinema_showtime.id


def test_cineville_still_inserts_when_titles_are_unrelated(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    cinema = cinema_factory(cineville=True)
    cinema_movie = movie_factory(title="Paddington 2")
    cineville_movie = movie_factory(title="Interstellar")
    slot = _slot_time()

    cinema_showtime = showtime_factory(
        cinema=cinema,
        movie=cinema_movie,
        datetime=slot,
        ticket_link="https://cinema.example/paddington",
    )
    _add_presence(
        session=db_transaction,
        source_stream=f"cinema_scraper:{cinema.id}",
        showtime_id=cinema_showtime.id,
    )
    db_transaction.flush()

    result = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=cineville_movie.id,
            cinema_id=cinema.id,
            datetime=slot,
            ticket_link="https://cineville.example/interstellar",
        ),
        commit=False,
        yield_to_conflicting_showtime=True,
    )

    assert result is not None
    assert result.id != cinema_showtime.id
    assert result.movie_id == cineville_movie.id
    assert consume_source_disagreements() == []


def test_cineville_does_not_yield_to_another_cineville_showtime(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    """Only the cinema's own site outranks Cineville; a Cineville-only occupant
    is exactly the row the cleanup would remove, so yielding to it would keep
    the wrong match alive."""
    cinema = cinema_factory(cineville=True)
    occupant_movie = movie_factory(title="LOLA")
    incoming_movie = movie_factory(title="Lola")
    slot = _slot_time()

    occupant = showtime_factory(
        cinema=cinema,
        movie=occupant_movie,
        datetime=slot,
        ticket_link="https://cineville.example/occupant",
    )
    _add_presence(
        session=db_transaction,
        source_stream=f"cineville:{cinema.id}",
        showtime_id=occupant.id,
    )
    db_transaction.flush()

    result = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=incoming_movie.id,
            cinema_id=cinema.id,
            datetime=slot,
            ticket_link="https://cineville.example/incoming",
        ),
        commit=False,
        yield_to_conflicting_showtime=True,
    )

    assert result is not None
    assert result.id != occupant.id


def test_cinema_scraper_upsert_is_unaffected_by_the_guard(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    """The guard is opt-in: without the flag a conflicting occupant is ignored,
    so a cinema scraper still gets its own row for its own match."""
    cinema = cinema_factory(cineville=True)
    occupant_movie = movie_factory(title="All About Lily Chou-Chou")
    incoming_movie = movie_factory(title="All About 'All About Lily Chou-Chou'")
    slot = _slot_time()

    occupant = showtime_factory(
        cinema=cinema,
        movie=occupant_movie,
        datetime=slot,
        ticket_link="https://cinema.example/occupant",
    )
    _add_presence(
        session=db_transaction,
        source_stream=f"cinema_scraper:{cinema.id}",
        showtime_id=occupant.id,
    )
    db_transaction.flush()

    result = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=incoming_movie.id,
            cinema_id=cinema.id,
            datetime=slot,
            ticket_link="https://cinema.example/incoming",
        ),
        commit=False,
    )

    assert result is not None
    assert result.movie_id == incoming_movie.id
    remaining = set(
        db_transaction.exec(
            select(Showtime.id).where(
                Showtime.cinema_id == cinema.id, Showtime.datetime == slot
            )
        ).all()
    )
    assert occupant.id in remaining
