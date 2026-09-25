"""Film-festival support: the upsert preservation rules for festival fields,
and the two helpers that let a festival scraper and Cineville land on the same
row (`resolve_cineville_festival_cinema`, `adopt_placeholder_showtime`).
"""

from datetime import timedelta

from sqlmodel import Session, select

from app.core.enums import CinemaKind
from app.models.showtime import Showtime, ShowtimeCreate
from app.services import festivals as festivals_service
from app.services import showtimes as showtimes_service
from app.utils import now_amsterdam_naive


def _slot(days: int = 3, hour: int = 20):
    return now_amsterdam_naive().replace(
        hour=hour, minute=0, second=0, microsecond=0
    ) + timedelta(days=days)


def _festival(cinema_factory):
    return cinema_factory(kind=CinemaKind.FESTIVAL, cineville=True)


# --------------------------------------------------------------------------
# _apply_upsert_update: festival fields and ticket link preservation
# --------------------------------------------------------------------------


def test_upsert_keeps_festival_ticket_link_when_incoming_link_is_none(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    """Cineville's festival events carry no ticket link; they must not blank
    the link the festival scraper set."""
    festival = _festival(cinema_factory)
    cinema = cinema_factory()
    movie = movie_factory()
    slot = _slot()
    ticket_link = "https://www.liff.nl/tickets/?film=abc123"
    existing = showtime_factory(
        cinema=cinema,
        movie=movie,
        datetime=slot,
        ticket_link=ticket_link,
        festival_id=festival.id,
        cineville_pass=False,
    )

    updated = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=cinema.id,
            datetime=slot,
            ticket_link=None,
        ),
    )

    assert updated is not None
    assert updated.id == existing.id
    assert updated.ticket_link == ticket_link
    # A source that says nothing about the festival leaves what was set.
    assert updated.festival_id == festival.id
    assert updated.cineville_pass is False


def test_upsert_still_blanks_ticket_link_for_non_festival_showtime(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    cinema = cinema_factory()
    movie = movie_factory()
    slot = _slot()
    existing = showtime_factory(
        cinema=cinema,
        movie=movie,
        datetime=slot,
        ticket_link="https://tickets.example.com/regular",
    )

    updated = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=cinema.id,
            datetime=slot,
            ticket_link=None,
        ),
    )

    assert updated is not None
    assert updated.id == existing.id
    assert updated.ticket_link is None
    assert updated.festival_id is None
    assert updated.cineville_pass is None


def test_upsert_replaces_festival_ticket_link_when_incoming_link_is_set(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    festival = _festival(cinema_factory)
    cinema = cinema_factory()
    movie = movie_factory()
    slot = _slot()
    showtime_factory(
        cinema=cinema,
        movie=movie,
        datetime=slot,
        ticket_link="https://www.liff.nl/tickets/?film=old",
        festival_id=festival.id,
    )

    updated = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=cinema.id,
            datetime=slot,
            ticket_link="https://www.liff.nl/tickets/?film=new",
        ),
    )

    assert updated is not None
    assert updated.ticket_link == "https://www.liff.nl/tickets/?film=new"


def test_upsert_sets_festival_fields_when_incoming_values_are_given(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    festival = _festival(cinema_factory)
    cinema = cinema_factory()
    movie = movie_factory()
    slot = _slot()
    ticket_link = "https://tickets.example.com/cinema-own"
    existing = showtime_factory(
        cinema=cinema,
        movie=movie,
        datetime=slot,
        ticket_link=ticket_link,
    )
    assert existing.festival_id is None
    assert existing.cineville_pass is None

    updated = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=cinema.id,
            datetime=slot,
            ticket_link=ticket_link,
            festival_id=festival.id,
            cineville_pass=True,
        ),
    )

    assert updated is not None
    assert updated.id == existing.id
    assert updated.festival_id == festival.id
    assert updated.cineville_pass is True


def test_upsert_overwrites_cineville_pass_with_explicit_false(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    """False is a value, not an absence: the festival scraper saying the pass
    does not cover a screening must stick."""
    festival = _festival(cinema_factory)
    cinema = cinema_factory()
    movie = movie_factory()
    slot = _slot()
    ticket_link = "https://www.liff.nl/tickets/?film=xyz"
    showtime_factory(
        cinema=cinema,
        movie=movie,
        datetime=slot,
        ticket_link=ticket_link,
        festival_id=festival.id,
        cineville_pass=True,
    )

    updated = showtimes_service.upsert_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=cinema.id,
            datetime=slot,
            ticket_link=ticket_link,
            festival_id=festival.id,
            cineville_pass=False,
        ),
    )

    assert updated is not None
    assert updated.cineville_pass is False


# --------------------------------------------------------------------------
# resolve_cineville_festival_cinema
# --------------------------------------------------------------------------


def test_resolve_matches_festival_showtime_by_movie_id(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    festival = _festival(cinema_factory)
    real_cinema = cinema_factory()
    movie = movie_factory(title="Mouse")
    slot = _slot()
    showtime_factory(
        cinema=real_cinema, movie=movie, datetime=slot, festival_id=festival.id
    )

    resolved = festivals_service.resolve_cineville_festival_cinema(
        session=db_transaction,
        festival_id=festival.id,
        start=slot,
        movie_id=movie.id,
        movie_title="A completely unrelated title",
    )

    assert resolved == real_cinema.id


def test_resolve_falls_back_to_near_identical_title(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    """The two sources can resolve the same screening to different films."""
    festival = _festival(cinema_factory)
    real_cinema = cinema_factory()
    scraper_movie = movie_factory(title="The Quiet Girl")
    cineville_movie = movie_factory(title="The Quiet Girl")
    slot = _slot()
    showtime_factory(
        cinema=real_cinema,
        movie=scraper_movie,
        datetime=slot,
        festival_id=festival.id,
    )

    resolved = festivals_service.resolve_cineville_festival_cinema(
        session=db_transaction,
        festival_id=festival.id,
        start=slot,
        movie_id=cineville_movie.id,
        movie_title=cineville_movie.title,
    )

    assert resolved == real_cinema.id


def test_resolve_prefers_movie_id_match_over_title_match(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    festival = _festival(cinema_factory)
    title_match_cinema = cinema_factory()
    id_match_cinema = cinema_factory()
    lookalike = movie_factory(title="Mouse")
    movie = movie_factory(title="Something Else Entirely")
    slot = _slot()
    showtime_factory(
        cinema=title_match_cinema,
        movie=lookalike,
        datetime=slot,
        festival_id=festival.id,
    )
    showtime_factory(
        cinema=id_match_cinema, movie=movie, datetime=slot, festival_id=festival.id
    )

    resolved = festivals_service.resolve_cineville_festival_cinema(
        session=db_transaction,
        festival_id=festival.id,
        start=slot,
        movie_id=movie.id,
        movie_title="Mouse",
    )

    assert resolved == id_match_cinema.id


def test_resolve_returns_none_when_title_does_not_match(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    festival = _festival(cinema_factory)
    real_cinema = cinema_factory()
    scraper_movie = movie_factory(title="Totally Different Movie")
    other_movie = movie_factory(title="Unrelated Documentary About Bees")
    slot = _slot()
    showtime_factory(
        cinema=real_cinema,
        movie=scraper_movie,
        datetime=slot,
        festival_id=festival.id,
    )

    resolved = festivals_service.resolve_cineville_festival_cinema(
        session=db_transaction,
        festival_id=festival.id,
        start=slot,
        movie_id=other_movie.id,
        movie_title=other_movie.title,
    )

    assert resolved is None


def test_resolve_requires_exact_start_time(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    festival = _festival(cinema_factory)
    real_cinema = cinema_factory()
    movie = movie_factory()
    slot = _slot()
    showtime_factory(
        cinema=real_cinema,
        movie=movie,
        datetime=slot + timedelta(minutes=15),
        festival_id=festival.id,
    )

    resolved = festivals_service.resolve_cineville_festival_cinema(
        session=db_transaction,
        festival_id=festival.id,
        start=slot,
        movie_id=movie.id,
        movie_title=movie.title,
    )

    assert resolved is None


def test_resolve_ignores_showtimes_not_part_of_the_festival(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    festival = _festival(cinema_factory)
    other_festival = _festival(cinema_factory)
    real_cinema = cinema_factory()
    other_cinema = cinema_factory()
    movie = movie_factory()
    slot = _slot()
    # The cinema's own listing, no festival.
    showtime_factory(cinema=real_cinema, movie=movie, datetime=slot)
    # Part of a different festival.
    showtime_factory(
        cinema=other_cinema,
        movie=movie,
        datetime=slot,
        festival_id=other_festival.id,
    )

    resolved = festivals_service.resolve_cineville_festival_cinema(
        session=db_transaction,
        festival_id=festival.id,
        start=slot,
        movie_id=movie.id,
        movie_title=movie.title,
    )

    assert resolved is None


def test_resolve_ignores_rows_at_the_festival_cinema_itself(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    """Cineville's own placeholder at the festival must not resolve to itself."""
    festival = _festival(cinema_factory)
    movie = movie_factory()
    slot = _slot()
    showtime_factory(
        cinema=festival, movie=movie, datetime=slot, festival_id=festival.id
    )

    resolved = festivals_service.resolve_cineville_festival_cinema(
        session=db_transaction,
        festival_id=festival.id,
        start=slot,
        movie_id=movie.id,
        movie_title=movie.title,
    )

    assert resolved is None


# --------------------------------------------------------------------------
# adopt_placeholder_showtime
# --------------------------------------------------------------------------


def test_adopt_moves_placeholder_to_real_cinema_and_clears_room(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    festival = _festival(cinema_factory)
    real_cinema = cinema_factory()
    movie = movie_factory()
    slot = _slot()
    placeholder = showtime_factory(
        cinema=festival,
        movie=movie,
        datetime=slot,
        festival_id=festival.id,
        cineville_pass=True,
        room="Some Venue",
        room_key="some-venue",
    )
    placeholder_id = placeholder.id

    festivals_service.adopt_placeholder_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=real_cinema.id,
            datetime=slot,
            festival_id=festival.id,
        ),
    )

    moved = db_transaction.get(Showtime, placeholder_id)
    assert moved is not None
    assert moved.cinema_id == real_cinema.id
    assert moved.room is None
    assert moved.room_key is None
    assert moved.festival_id == festival.id
    left_at_festival = db_transaction.exec(
        select(Showtime).where(Showtime.cinema_id == festival.id)
    ).all()
    assert list(left_at_festival) == []


def test_adopt_then_upsert_keeps_the_same_row(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    """The scraper's upsert after adoption lands on the moved row, so anything
    attached to the placeholder (selections) survives."""
    festival = _festival(cinema_factory)
    real_cinema = cinema_factory()
    movie = movie_factory()
    slot = _slot()
    placeholder = showtime_factory(
        cinema=festival,
        movie=movie,
        datetime=slot,
        festival_id=festival.id,
        cineville_pass=True,
        ticket_link=None,
    )
    placeholder_id = placeholder.id
    showtime_create = ShowtimeCreate(
        movie_id=movie.id,
        cinema_id=real_cinema.id,
        datetime=slot,
        ticket_link="https://www.liff.nl/tickets/?film=k1",
        festival_id=festival.id,
        cineville_pass=False,
    )

    festivals_service.adopt_placeholder_showtime(
        session=db_transaction, showtime_create=showtime_create
    )
    upserted = showtimes_service.upsert_showtime(
        session=db_transaction, showtime_create=showtime_create
    )

    assert upserted is not None
    assert upserted.id == placeholder_id
    assert upserted.cinema_id == real_cinema.id
    assert upserted.ticket_link == "https://www.liff.nl/tickets/?film=k1"
    assert upserted.cineville_pass is False
    rows = db_transaction.exec(
        select(Showtime).where(
            Showtime.movie_id == movie.id, Showtime.datetime == slot
        )
    ).all()
    assert len(rows) == 1


def test_adopt_is_noop_when_real_cinema_already_has_the_screening(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    festival = _festival(cinema_factory)
    real_cinema = cinema_factory()
    movie = movie_factory()
    slot = _slot()
    placeholder = showtime_factory(
        cinema=festival,
        movie=movie,
        datetime=slot,
        festival_id=festival.id,
        room="Some Venue",
    )
    already_there = showtime_factory(
        cinema=real_cinema, movie=movie, datetime=slot, festival_id=festival.id
    )
    placeholder_id = placeholder.id

    festivals_service.adopt_placeholder_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=real_cinema.id,
            datetime=slot,
            festival_id=festival.id,
        ),
    )

    unchanged = db_transaction.get(Showtime, placeholder_id)
    assert unchanged is not None
    assert unchanged.cinema_id == festival.id
    assert unchanged.room == "Some Venue"
    assert db_transaction.get(Showtime, already_there.id) is not None


def test_adopt_is_noop_when_target_is_the_festival_itself(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    """An unknown location stays at the festival row: nothing to move."""
    festival = _festival(cinema_factory)
    movie = movie_factory()
    slot = _slot()
    placeholder = showtime_factory(
        cinema=festival,
        movie=movie,
        datetime=slot,
        festival_id=festival.id,
        room="New Venue",
        room_key="new-venue",
    )
    placeholder_id = placeholder.id

    festivals_service.adopt_placeholder_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=festival.id,
            datetime=slot,
            festival_id=festival.id,
        ),
    )

    unchanged = db_transaction.get(Showtime, placeholder_id)
    assert unchanged is not None
    assert unchanged.cinema_id == festival.id
    assert unchanged.room == "New Venue"
    assert unchanged.room_key == "new-venue"


def test_adopt_is_noop_without_festival_id(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    festival = _festival(cinema_factory)
    real_cinema = cinema_factory()
    movie = movie_factory()
    slot = _slot()
    placeholder = showtime_factory(
        cinema=festival, movie=movie, datetime=slot, festival_id=festival.id
    )
    placeholder_id = placeholder.id

    festivals_service.adopt_placeholder_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=real_cinema.id,
            datetime=slot,
            festival_id=None,
        ),
    )

    unchanged = db_transaction.get(Showtime, placeholder_id)
    assert unchanged is not None
    assert unchanged.cinema_id == festival.id


def test_adopt_leaves_placeholders_for_other_movies_or_times_alone(
    *,
    db_transaction: Session,
    cinema_factory,
    movie_factory,
    showtime_factory,
):
    festival = _festival(cinema_factory)
    real_cinema = cinema_factory()
    movie = movie_factory()
    other_movie = movie_factory()
    slot = _slot()
    other_movie_row = showtime_factory(
        cinema=festival, movie=other_movie, datetime=slot, festival_id=festival.id
    )
    other_time_row = showtime_factory(
        cinema=festival,
        movie=movie,
        datetime=slot + timedelta(hours=3),
        festival_id=festival.id,
    )

    festivals_service.adopt_placeholder_showtime(
        session=db_transaction,
        showtime_create=ShowtimeCreate(
            movie_id=movie.id,
            cinema_id=real_cinema.id,
            datetime=slot,
            festival_id=festival.id,
        ),
    )

    assert db_transaction.get(Showtime, other_movie_row.id).cinema_id == festival.id
    assert db_transaction.get(Showtime, other_time_row.id).cinema_id == festival.id
