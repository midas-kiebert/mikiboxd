from datetime import timedelta

from sqlmodel import Session, col, select

from app.models.showtime import Showtime
from app.models.showtime_source_presence import ShowtimeSourcePresence
from app.models.tmdb_lookup_cache import TmdbLookupCache
from app.scraping import runner
from app.scraping.tmdb_config import TMDB_LOOKUP_PAYLOAD_VERSION
from app.utils import now_amsterdam_naive


def _attach_tmdb_cache(*, session: Session, movie, version: int) -> None:
    cache = TmdbLookupCache(
        lookup_hash=f"hash-{movie.id}",
        lookup_payload=f'{{"version":{version}}}',
        tmdb_id=movie.id,
        confidence=93.0,
        created_at=now_amsterdam_naive(),
        updated_at=now_amsterdam_naive(),
    )
    session.add(cache)
    session.flush()
    movie.tmdb_cache_id = cache.id
    session.add(movie)


def _add_presence(
    *,
    session: Session,
    source_stream: str,
    source_event_key: str,
    showtime_id: int,
) -> None:
    session.add(
        ShowtimeSourcePresence(
            source_stream=source_stream,
            source_event_key=source_event_key,
            showtime_id=showtime_id,
            last_seen_at=now_amsterdam_naive(),
            missing_streak=0,
            active=True,
        )
    )


def test_delete_cineville_only_conflict_showtime(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    cinema = cinema_factory(cineville=True)
    cineville_movie = movie_factory(title="Bad Boys")
    cinema_movie = movie_factory(title="Bad Boys: Ride or Die")
    showtime_time = now_amsterdam_naive().replace(
        hour=20,
        minute=0,
        second=0,
        microsecond=0,
    ) + timedelta(days=2)

    cineville_showtime = showtime_factory(
        cinema=cinema,
        movie=cineville_movie,
        datetime=showtime_time,
        ticket_link="https://cineville.example/wrong",
    )
    cinema_showtime = showtime_factory(
        cinema=cinema,
        movie=cinema_movie,
        datetime=showtime_time,
        ticket_link="https://cinema.example/correct",
    )

    _add_presence(
        session=db_transaction,
        source_stream=f"cineville:{cinema.id}",
        source_event_key=f"event:cineville:{cineville_showtime.id}",
        showtime_id=cineville_showtime.id,
    )
    _add_presence(
        session=db_transaction,
        source_stream=f"cinema_scraper:{cinema.id}",
        source_event_key=f"event:cinema:{cinema_showtime.id}",
        showtime_id=cinema_showtime.id,
    )
    db_transaction.flush()

    deleted = runner._delete_cineville_title_conflicts(session=db_transaction)

    assert {item.showtime_id for item in deleted} == {cineville_showtime.id}
    remaining_showtime_ids = set(
        db_transaction.exec(
            select(Showtime.id).where(
                col(Showtime.id).in_([cineville_showtime.id, cinema_showtime.id])
            )
        ).all()
    )
    assert cineville_showtime.id not in remaining_showtime_ids
    assert cinema_showtime.id in remaining_showtime_ids

    deleted_presence_rows = list(
        db_transaction.exec(
            select(ShowtimeSourcePresence).where(
                ShowtimeSourcePresence.showtime_id == cineville_showtime.id
            )
        ).all()
    )
    assert deleted_presence_rows == []


def test_keep_cineville_showtime_when_titles_are_not_similar(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    cinema = cinema_factory(cineville=True)
    cineville_movie = movie_factory(title="Interstellar")
    cinema_movie = movie_factory(title="Paddington 2")
    showtime_time = now_amsterdam_naive().replace(
        hour=19,
        minute=30,
        second=0,
        microsecond=0,
    ) + timedelta(days=2)

    cineville_showtime = showtime_factory(
        cinema=cinema,
        movie=cineville_movie,
        datetime=showtime_time,
        ticket_link=None,
    )
    cinema_showtime = showtime_factory(
        cinema=cinema,
        movie=cinema_movie,
        datetime=showtime_time,
        ticket_link=None,
    )

    _add_presence(
        session=db_transaction,
        source_stream=f"cineville:{cinema.id}",
        source_event_key=f"event:cineville:{cineville_showtime.id}",
        showtime_id=cineville_showtime.id,
    )
    _add_presence(
        session=db_transaction,
        source_stream=f"cinema_scraper:{cinema.id}",
        source_event_key=f"event:cinema:{cinema_showtime.id}",
        showtime_id=cinema_showtime.id,
    )
    db_transaction.flush()

    deleted = runner._delete_cineville_title_conflicts(session=db_transaction)

    assert deleted == []
    remaining_showtime_ids = set(
        db_transaction.exec(
            select(Showtime.id).where(
                col(Showtime.id).in_([cineville_showtime.id, cinema_showtime.id])
            )
        ).all()
    )
    assert remaining_showtime_ids == {cineville_showtime.id, cinema_showtime.id}


def test_keep_showtime_when_it_also_has_cinema_scraper_source(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    cinema = cinema_factory(cineville=True)
    shared_movie = movie_factory(title="The Room")
    cinema_movie = movie_factory(title="The Room (2003)")
    showtime_time = now_amsterdam_naive().replace(
        hour=21,
        minute=0,
        second=0,
        microsecond=0,
    ) + timedelta(days=2)

    shared_showtime = showtime_factory(
        cinema=cinema,
        movie=shared_movie,
        datetime=showtime_time,
        ticket_link="https://cinema.example/shared",
    )
    cinema_showtime = showtime_factory(
        cinema=cinema,
        movie=cinema_movie,
        datetime=showtime_time,
        ticket_link="https://cinema.example/other",
    )

    _add_presence(
        session=db_transaction,
        source_stream=f"cineville:{cinema.id}",
        source_event_key=f"event:cineville:{shared_showtime.id}",
        showtime_id=shared_showtime.id,
    )
    _add_presence(
        session=db_transaction,
        source_stream=f"cinema_scraper:{cinema.id}",
        source_event_key=f"event:cinema-shared:{shared_showtime.id}",
        showtime_id=shared_showtime.id,
    )
    _add_presence(
        session=db_transaction,
        source_stream=f"cinema_scraper:{cinema.id}",
        source_event_key=f"event:cinema:{cinema_showtime.id}",
        showtime_id=cinema_showtime.id,
    )
    db_transaction.flush()

    deleted = runner._delete_cineville_title_conflicts(session=db_transaction)

    assert deleted == []
    remaining_showtime_ids = set(
        db_transaction.exec(
            select(Showtime.id).where(
                col(Showtime.id).in_([shared_showtime.id, cinema_showtime.id])
            )
        ).all()
    )
    assert remaining_showtime_ids == {shared_showtime.id, cinema_showtime.id}


def test_reassigns_stale_cinema_scraper_showtime_instead_of_deleting_cineville(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    """When the cinema scraper's match is stale (older resolver version than
    Cineville's), its row has the right screening tied to the wrong movie.
    Correct its movie_id in place and drop Cineville's now-redundant row,
    rather than deleting the cinema scraper's row outright — the row itself
    (its id, ticket_link, presence history) is still worth keeping."""
    cinema = cinema_factory(cineville=True)
    cineville_movie = movie_factory(title="All About Lily Chou-Chou")
    cinema_movie = movie_factory(title="All About \"All About Lily Chou-Chou\"")
    showtime_time = now_amsterdam_naive().replace(
        hour=20,
        minute=0,
        second=0,
        microsecond=0,
    ) + timedelta(days=2)

    _attach_tmdb_cache(
        session=db_transaction,
        movie=cinema_movie,
        version=TMDB_LOOKUP_PAYLOAD_VERSION - 1,
    )
    _attach_tmdb_cache(
        session=db_transaction, movie=cineville_movie, version=TMDB_LOOKUP_PAYLOAD_VERSION
    )

    cineville_showtime = showtime_factory(
        cinema=cinema,
        movie=cineville_movie,
        datetime=showtime_time,
        ticket_link="https://cineville.example/correct",
    )
    cinema_showtime = showtime_factory(
        cinema=cinema,
        movie=cinema_movie,
        datetime=showtime_time,
        ticket_link="https://cinema.example/stale",
    )

    _add_presence(
        session=db_transaction,
        source_stream=f"cineville:{cinema.id}",
        source_event_key=f"event:cineville:{cineville_showtime.id}",
        showtime_id=cineville_showtime.id,
    )
    _add_presence(
        session=db_transaction,
        source_stream=f"cinema_scraper:{cinema.id}",
        source_event_key=f"event:cinema:{cinema_showtime.id}",
        showtime_id=cinema_showtime.id,
    )
    db_transaction.flush()

    deleted = runner._delete_cineville_title_conflicts(session=db_transaction)

    assert {item.showtime_id for item in deleted} == {cineville_showtime.id}
    remaining = list(
        db_transaction.exec(
            select(Showtime).where(
                col(Showtime.id).in_([cineville_showtime.id, cinema_showtime.id])
            )
        ).all()
    )
    assert {showtime.id for showtime in remaining} == {cinema_showtime.id}
    assert remaining[0].movie_id == cineville_movie.id
