from sqlmodel import Session

from app.models.city import (
    City,
    CityCreate,
)


def create_city(
    *,
    session: Session,
    city: CityCreate,
) -> City:
    """
    Create a new city or return the existing one if it already exists.
    If a city with the same ID already exists, it will return that city.
    This function does not check for name uniqueness, only ID uniqueness.

    Parameters:
        session (Session): The SQLAlchemy session to use for the operation.
        city (CityCreate): The CityCreate model containing the city data.
    Returns:
        City: The City object that was either created or already exists.
    """
    existing_city = session.get(City, city.id)
    if existing_city is not None:
        return existing_city

    new_city = City(**city.model_dump())
    session.add(new_city)
    return new_city
