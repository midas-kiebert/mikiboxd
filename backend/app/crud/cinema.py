from sqlmodel import Session, select

from app.models import Cinema, CinemaCreate

__all__ = [
    "upsert_cinema",
    "get_cinema_id_by_name",
]


def upsert_cinema(*, session: Session, cinema: CinemaCreate) -> Cinema:
    stmt = select(Cinema).where(Cinema.name == cinema.name)
    existing_cinema = session.exec(stmt).first()

    if existing_cinema:
        for field, value in cinema.model_dump(exclude_unset=True).items():
            setattr(existing_cinema, field, value)
        session.add(existing_cinema)
        session.flush()
        session.commit()
        session.refresh(existing_cinema)
        return existing_cinema

    # If no existing cinema is found, create a new one
    db_item = Cinema(**cinema.model_dump(exclude_unset=True))
    session.add(db_item)
    session.flush()
    session.commit()
    session.refresh(db_item)
    return db_item


def get_cinema_id_by_name(
    *,
    session: Session,
    name: str,
) -> int | None:
    """
    Retrieve the ID of a cinema by its name and city ID.
    Returns None if no cinema is found.
    """
    stmt = select(Cinema.id).where(
        Cinema.name == name,
    )
    cinema_id = session.exec(stmt).first()
    return cinema_id
