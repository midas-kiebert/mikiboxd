from sqlmodel import Session, col, select

from app.models.movie import Movie
from app.models.watched_selection import WatchedSelection


def does_watched_selection_exist(
    *,
    session: Session,
    letterboxd_slug: str,
    letterboxd_username: str,
) -> bool:
    """
    Check if a user has marked a movie (by Letterboxd slug) as watched.

    Parameters:
        session (Session): The database session.
        letterboxd_slug (str): The Letterboxd slug of the movie to check.
        letterboxd_username (str): The username of the user on Letterboxd.
    Returns:
        bool: True if the user has marked the movie as watched, otherwise False.
    """
    stmt = select(WatchedSelection).where(
        WatchedSelection.letterboxd_slug == letterboxd_slug,
        WatchedSelection.letterboxd_username == letterboxd_username,
    )
    result = session.exec(stmt).one_or_none() is not None
    return result


def add_watched_selection(
    *,
    session: Session,
    letterboxd_username: str,
    letterboxd_slug: str,
    movie_id: int | None = None,
) -> WatchedSelection:
    """
    Mark a movie as watched for a user.

    Parameters:
        session (Session): The database session.
        letterboxd_username (str): The username of the user on Letterboxd.
        letterboxd_slug (str): The Letterboxd slug of the movie.
        movie_id (int | None): The ID of the movie in our catalog, if known.
    Returns:
        WatchedSelection: The watched selection that was added.
    Raises:
        IntegrityError: If the watched selection already exists.
        ForeignKeyViolation: If the user/movie does not exist.
    """
    selection = WatchedSelection(
        letterboxd_username=letterboxd_username,
        letterboxd_slug=letterboxd_slug,
        movie_id=movie_id,
    )
    session.add(selection)
    session.flush()  # Raise Errors
    return selection


def delete_watched_selection(
    *,
    session: Session,
    letterboxd_username: str,
    letterboxd_slug: str,
) -> WatchedSelection:
    """
    Remove a movie from a user's watched list.

    Parameters:
        session (Session): The database session.
        letterboxd_username (str): The username of the user on Letterboxd.
        letterboxd_slug (str): The Letterboxd slug of the movie to remove.
    Returns:
        WatchedSelection: The watched selection that was removed.
    """
    selection = session.exec(
        select(WatchedSelection).where(
            WatchedSelection.letterboxd_username == letterboxd_username,
            WatchedSelection.letterboxd_slug == letterboxd_slug,
        )
    ).one()

    session.delete(selection)
    session.flush()
    return selection


def get_watched_selections(
    *,
    session: Session,
    letterboxd_username: str,
) -> list[WatchedSelection]:
    stmt = select(WatchedSelection).where(
        WatchedSelection.letterboxd_username == letterboxd_username
    )
    selections: list[WatchedSelection] = list(session.exec(stmt).all())
    return selections


def get_watched(
    *,
    session: Session,
    letterboxd_username: str,
) -> list[Movie]:
    """
    Get the movies from a user's watched list that exist in our catalog.

    Watched entries for movies we don't have in our catalog (movie_id is
    None) are not represented here.
    """
    stmt = (
        select(Movie)
        .join(WatchedSelection, col(WatchedSelection.movie_id) == col(Movie.id))
        .where(WatchedSelection.letterboxd_username == letterboxd_username)
    )
    movies: list[Movie] = list(session.exec(stmt).all())
    return movies
