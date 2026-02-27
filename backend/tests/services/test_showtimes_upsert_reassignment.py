from datetime import timedelta

from sqlmodel import Session, select

from app.models.showtime import Showtime, ShowtimeCreate
from app.services import showtimes as showtimes_service
from app.utils import now_amsterdam_naive


def test_upsert_showtime_reassigns_movie_id_for_unique_candidate(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    cinema = cinema_factory()
    wrong_movie = movie_factory()
    corrected_movie = movie_factory()
    showtime_time = now_amsterdam_naive().replace(
        hour=20,
        minute=0,
        second=0,
        microsecond=0,
    ) + timedelta(days=2)
    ticket_link = "https://tickets.example.com/event-123"
    original_end_time = showtime_time + timedelta(minutes=95)
    updated_end_time = showtime_time + timedelta(minutes=110)
    existing_showtime = showtime_factory(
        cinema=cinema,
        movie=wrong_movie,
        datetime=showtime_time,
        ticket_link=ticket_link,
        end_datetime=original_end_time,
        subtitles=["nl"],
    )

    reassigned_showtime = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=corrected_movie.id,
            cinema_id=cinema.id,
            datetime=showtime_time,
            ticket_link=ticket_link,
            end_datetime=updated_end_time,
            subtitles=["en", "nl"],
        ),
    )

    assert reassigned_showtime.id == existing_showtime.id
    assert reassigned_showtime.movie_id == corrected_movie.id
    assert reassigned_showtime.end_datetime == updated_end_time
    assert reassigned_showtime.subtitles == ["en", "nl"]

    rows = list(
        db_transaction.exec(
            select(Showtime).where(
                Showtime.cinema_id == cinema.id,
                Showtime.ticket_link == ticket_link,
            )
        ).all()
    )
    assert len(rows) == 1
    assert rows[0].id == existing_showtime.id
    assert rows[0].end_datetime == updated_end_time
    assert rows[0].subtitles == ["en", "nl"]


def test_upsert_showtime_skips_movie_reassignment_when_candidate_is_ambiguous(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    cinema = cinema_factory()
    wrong_movie_a = movie_factory()
    wrong_movie_b = movie_factory()
    corrected_movie = movie_factory()
    base_time = now_amsterdam_naive().replace(
        hour=18,
        minute=0,
        second=0,
        microsecond=0,
    ) + timedelta(days=2)
    first_existing = showtime_factory(
        cinema=cinema,
        movie=wrong_movie_a,
        datetime=base_time,
        ticket_link=None,
    )
    second_existing = showtime_factory(
        cinema=cinema,
        movie=wrong_movie_b,
        datetime=base_time + timedelta(minutes=20),
        ticket_link=None,
    )

    inserted_showtime = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=corrected_movie.id,
            cinema_id=cinema.id,
            datetime=base_time + timedelta(minutes=5),
            ticket_link=None,
        ),
    )

    assert inserted_showtime.id not in {first_existing.id, second_existing.id}

    rows = list(
        db_transaction.exec(
            select(Showtime).where(Showtime.cinema_id == cinema.id)
        ).all()
    )
    assert len(rows) == 3


def test_upsert_showtime_preserves_metadata_when_payload_lacks_it(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    cinema = cinema_factory()
    movie = movie_factory()
    showtime_time = now_amsterdam_naive().replace(
        hour=17,
        minute=0,
        second=0,
        microsecond=0,
    ) + timedelta(days=3)
    original_end_time = showtime_time + timedelta(minutes=120)
    ticket_link = "https://tickets.example.com/event-keep-metadata"
    existing_showtime = showtime_factory(
        cinema=cinema,
        movie=movie,
        datetime=showtime_time,
        end_datetime=original_end_time,
        ticket_link=ticket_link,
        subtitles=["en"],
    )

    updated_showtime = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=cinema.id,
            datetime=showtime_time + timedelta(minutes=10),
            ticket_link=ticket_link,
            end_datetime=None,
            subtitles=None,
        ),
    )

    assert updated_showtime.id == existing_showtime.id
    assert updated_showtime.end_datetime == original_end_time
    assert updated_showtime.subtitles == ["en"]


def test_upsert_showtime_falls_back_to_movie_duration_for_missing_end_datetime(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
):
    cinema = cinema_factory()
    movie = movie_factory(duration=103)
    start_time = now_amsterdam_naive().replace(
        hour=19,
        minute=15,
        second=0,
        microsecond=0,
    ) + timedelta(days=2)

    showtime = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=cinema.id,
            datetime=start_time,
            ticket_link=None,
            end_datetime=None,
            subtitles=None,
        ),
    )

    assert showtime.end_datetime == start_time + timedelta(minutes=118)


def test_upsert_showtime_falls_back_when_existing_showtime_has_no_end_datetime(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    cinema = cinema_factory()
    movie = movie_factory(duration=88)
    original_time = now_amsterdam_naive().replace(
        hour=21,
        minute=0,
        second=0,
        microsecond=0,
    ) + timedelta(days=3)
    ticket_link = "https://tickets.example.com/event-fallback-end"
    existing_showtime = showtime_factory(
        cinema=cinema,
        movie=movie,
        datetime=original_time,
        ticket_link=ticket_link,
        end_datetime=None,
    )

    updated_start = original_time + timedelta(minutes=10)
    updated_showtime = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=cinema.id,
            datetime=updated_start,
            ticket_link=ticket_link,
            end_datetime=None,
            subtitles=None,
        ),
    )

    assert updated_showtime.id == existing_showtime.id
    assert updated_showtime.end_datetime == updated_start + timedelta(minutes=103)


def test_upsert_showtime_falls_back_on_exact_existing_match_without_end_datetime(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    cinema = cinema_factory()
    movie = movie_factory(duration=75)
    start_time = now_amsterdam_naive().replace(
        hour=20,
        minute=0,
        second=0,
        microsecond=0,
    ) + timedelta(days=3)
    ticket_link = "https://tickets.example.com/exact-match-fallback"
    existing_showtime = showtime_factory(
        cinema=cinema,
        movie=movie,
        datetime=start_time,
        ticket_link=ticket_link,
        end_datetime=None,
    )

    updated_showtime = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=cinema.id,
            datetime=start_time,
            ticket_link=ticket_link,
            end_datetime=None,
            subtitles=None,
        ),
    )

    assert updated_showtime.id == existing_showtime.id
    assert updated_showtime.end_datetime == start_time + timedelta(minutes=90)
