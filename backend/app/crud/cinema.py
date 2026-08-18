from sqlalchemy import any_
from sqlmodel import Session, col, or_, select

from app.models.cinema import Cinema, CinemaCreate


def get_cinema_id_by_key(
    *,
    session: Session,
    key: str,
) -> int:
    """
    Get the ID of a cinema by its stable key.

    This is how anything inside the backend should resolve a cinema: the key
    never changes, while the display name is free to be edited in cinemas.yaml.

    Parameters:
        session (Session): The SQLAlchemy session to use for the operation.
        key (str): The cinema's key, as defined in cinemas.yaml.
    Returns:
        int: The ID of the cinema if found.
    Raises:
        NoResultFound: If no cinema has that key.
    """
    stmt = select(Cinema.id).where(Cinema.key == key)
    cinema_id = session.exec(stmt).one()
    return cinema_id


def get_cinema_id_by_name_or_alias(
    *,
    session: Session,
    name: str,
) -> int:
    """
    Get the ID of a cinema by its display name or one of its aliases.

    Only for resolving a name that comes from *outside* — a Cineville venue
    name, say — where the key is not available. Matching aliases too means a
    display rename cannot break ingestion, as long as the source's name for the
    venue is kept in `aliases`.

    Parameters:
        session (Session): The SQLAlchemy session to use for the operation.
        name (str): The name the external source uses for the cinema.
    Returns:
        int: The ID of the cinema if found.
    Raises:
        NoResultFound: If no cinema matches by name or alias.
    """
    stmt = select(Cinema.id).where(
        or_(col(Cinema.name) == name, name == any_(col(Cinema.aliases)))
    )
    cinema_id = session.exec(stmt).one()
    return cinema_id


def upsert_cinema(*, session: Session, cinema: CinemaCreate) -> Cinema:
    """
    Upsert a cinema in the database and flush the session to ensure integrity.

    Matched on `key`, never on `name`, so that editing a cinema's display name in
    cinemas.yaml renames the existing row rather than inserting a second cinema
    and orphaning its showtimes.

    Parameters:
        session (Session): The SQLAlchemy session to use for the operation.
        cinema (CinemaCreate): The CinemaCreate model containing the cinema data.

    Returns:
        Cinema: The Cinema object that was either updated or created.

    Raises:
        IntegrityError: If there is a database integrity error, such as an invalid city_id
    """
    stmt = select(Cinema).where(Cinema.key == cinema.key)
    existing_cinema = session.exec(stmt).one_or_none()

    if existing_cinema is None:
        # A row seeded before keys existed, whose key backfill did not land on the
        # key cinemas.yaml now gives it. Adopt it instead of inserting a duplicate.
        existing_cinema = session.exec(
            select(Cinema).where(Cinema.name == cinema.name)
        ).one_or_none()

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


def get_cinemas(
    *,
    session: Session,
) -> list[Cinema]:
    """
    Get all cinemas from the database.

    Parameters:
        session (Session): The SQLAlchemy session to use for the operation.

    Returns:
        list[Cinema]: A list of Cinema objects.
    """
    stmt = select(Cinema)
    cinemas = list(session.exec(stmt).all())
    return cinemas
