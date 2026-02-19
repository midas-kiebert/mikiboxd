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
    existing_showtime = showtime_factory(
        cinema=cinema,
        movie=wrong_movie,
        datetime=showtime_time,
        ticket_link=ticket_link,
    )

    reassigned_showtime = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=corrected_movie.id,
            cinema_id=cinema.id,
            datetime=showtime_time,
            ticket_link=ticket_link,
        ),
    )

    assert reassigned_showtime.id == existing_showtime.id
    assert reassigned_showtime.movie_id == corrected_movie.id

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
