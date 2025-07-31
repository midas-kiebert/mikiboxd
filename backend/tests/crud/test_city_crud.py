from sqlmodel import Session

from app.crud import city as city_crud
from app.models.city import City, CityCreate


def test_create_city_inserts_new_city(
    *,
    db_transaction: Session,
    city_create_factory,
):
    city_create: CityCreate = city_create_factory()

    created_city: City = city_crud.create_city(
        session=db_transaction,
        city=city_create,
    )

    # Check if the returned object is correct
    assert created_city.id == city_create.id
    assert created_city.name == city_create.name

    inserted_city = db_transaction.get(City, created_city.id)

    # Check if the city was inserted into the database
    assert inserted_city is not None
    assert inserted_city.id == created_city.id
    assert inserted_city.name == city_create.name


def test_create_city_already_exists(
    *,
    db_transaction: Session,
    city_create_factory,
    city_factory,
):
    city: City = city_factory()
    city_create: CityCreate = city_create_factory(
        id=city.id,
        name=city.name + " Updated",  # Ensure the name is different
    )

    created_city: City = city_crud.create_city(session=db_transaction, city=city_create)

    # Check if the returned object is the same as the existing city
    assert created_city.id == city.id
    assert created_city.name == city.name
    assert created_city.name != city_create.name

    inserted_city = db_transaction.get(City, created_city.id)

    # Check if the city was not duplicated in the database
    assert inserted_city is city
