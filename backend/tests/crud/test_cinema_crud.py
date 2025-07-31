import pytest
from psycopg.errors import ForeignKeyViolation
from sqlalchemy.exc import IntegrityError, NoResultFound
from sqlmodel import Session

from app.crud import cinema as cinema_crud
from app.models.cinema import Cinema, CinemaCreate
from app.models.city import City


def test_get_cinema_id_by_name_success(
    *,
    db_transaction: Session,
    cinema_factory,
):
    cinema: Cinema = cinema_factory()

    cinema_id = cinema_crud.get_cinema_id_by_name(
        session=db_transaction,
        name=cinema.name,
    )

    # Check if the returned cinema ID matches the one in the database
    assert cinema_id == cinema.id


def test_get_cinema_id_by_name_not_found(
    *,
    db_transaction: Session,
):
    with pytest.raises(NoResultFound):
        cinema_crud.get_cinema_id_by_name(
            session=db_transaction,
            name="Nonexistent Cinema",
        )


def test_upsert_cinema_inserts_new_cinema(
    *,
    db_transaction: Session,
    city_factory,
    cinema_create_factory,
):
    city: City = city_factory()

    cinema_create: CinemaCreate = cinema_create_factory(city_id=city.id)

    created_cinema: Cinema = cinema_crud.upsert_cinema(
        session=db_transaction,
        cinema=cinema_create,
    )

    # Check if the returned object is correct
    assert created_cinema.id is not None
    assert created_cinema.name == cinema_create.name
    assert created_cinema.city_id == city.id

    inserted_cinema = db_transaction.get(Cinema, created_cinema.id)

    # Check if the cinema was inserted into the database
    assert inserted_cinema is not None
    assert inserted_cinema.id == created_cinema.id
    assert inserted_cinema.name == cinema_create.name


def test_upsert_cinema_inserts_new_cinema_invalid_city(
    *, db_transaction: Session, cinema_create_factory
):
    cinema_create: CinemaCreate = cinema_create_factory(city_id=1)

    with pytest.raises(IntegrityError) as excinfo:
        cinema_crud.upsert_cinema(
            session=db_transaction,
            cinema=cinema_create,
        )

    assert isinstance(excinfo.value.orig, ForeignKeyViolation)


def test_upsert_cinema_updates_cinema(
    *,
    db_transaction: Session,
    cinema_factory,
    cinema_create_factory,
):
    cinema: Cinema = cinema_factory()

    old_badge_bg_color = cinema.badge_bg_color

    cinema_create: CinemaCreate = cinema_create_factory(
        name=cinema.name,
        city_id=cinema.city_id,
        badge_bg_color="new-color",  # Change the badge color
    )

    updated_cinema: Cinema = cinema_crud.upsert_cinema(
        session=db_transaction,
        cinema=cinema_create,
    )

    # Verify that the cinema was updated
    assert cinema.badge_bg_color != old_badge_bg_color
    assert cinema.badge_bg_color == "new-color"

    # Check that the correct object was returned (same instance as the original cinema)
    assert updated_cinema is cinema


def test_upsert_cinema_updates_cinema_invalid_city(
    *, db_transaction: Session, cinema_factory, cinema_create_factory
):
    cinema: Cinema = cinema_factory()

    cinema_create: CinemaCreate = cinema_create_factory(
        name=cinema.name,
        city_id=cinema.city_id + 1,  # Invalid city ID
    )

    with pytest.raises(IntegrityError) as excinfo:
        cinema_crud.upsert_cinema(
            session=db_transaction,
            cinema=cinema_create,
        )

    assert isinstance(excinfo.value.orig, ForeignKeyViolation)
