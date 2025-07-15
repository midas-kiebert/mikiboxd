from sqlmodel import Session

from app.models import City, CityCreate

__all__ = [
    "upsert_city",
]


def upsert_city(*, session: Session, city: CityCreate) -> City:
    db_item = City(**city.model_dump(exclude_unset=True))
    merged = session.merge(db_item)
    session.flush()
    session.commit()
    return merged
