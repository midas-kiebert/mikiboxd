from sqlmodel import Session, select

from app.models.cinema import Cinema, CinemaCreate


def get_cinema_id_by_name(
    *,
    session: Session,
    name: str,
) -> int:
    """
    Get the ID of a cinema by its name.
    Parameters:
        session (Session): The SQLAlchemy session to use for the operation.
        name (str): The name of the cinema.
    Returns:
        int: The ID of the cinema if found.
    """
    stmt = select(Cinema.id).where(Cinema.name == name)
    cinema_id = session.exec(stmt).one()
    return cinema_id


def upsert_cinema(*, session: Session, cinema: CinemaCreate) -> Cinema:
    """
    Upsert a cinema in the database and flush the session to ensure integrity.

    Parameters:
        session (Session): The SQLAlchemy session to use for the operation.
        cinema (CinemaCreate): The CinemaCreate model containing the cinema data.

    Returns:
        Cinema: The Cinema object that was either updated or created.

    Raises:
        IntegrityError: If there is a database integrity error, such as an invalid city_id
    """
    stmt = select(Cinema).where(Cinema.name == cinema.name)
    existing_cinema = session.exec(stmt).one_or_none()

    if existing_cinema:
        for field, value in cinema.model_dump().items():
            setattr(existing_cinema, field, value)
        session.flush()  # Check for integrity issues
        return existing_cinema

    # If no existing cinema is found, create a new one
    db_item = Cinema(**cinema.model_dump())
    session.add(db_item)
    session.flush()  # Make sure the ID is generated, check integrity
    return db_item
