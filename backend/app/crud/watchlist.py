from sqlmodel import Session, col, select

from app.models.movie import Movie
from app.models.watchlist_selection import WatchlistSelection


def does_watchlist_selection_exist(
    *,
    session: Session,
    movie_id: int,
    letterboxd_username: str,
) -> bool:
    """
    Check if a user has added a movie to their watchlist.

    Parameters:
        session (Session): The database session.
        movie_id (int): The ID of the movie to check.
        letterboxd_username (str): The username of the user on Letterboxd.
    Returns:
        bool: True if the user has added the movie to their watchlist, otherwise False.
    """
    stmt = select(WatchlistSelection).where(
        WatchlistSelection.movie_id == movie_id,
        WatchlistSelection.letterboxd_username == letterboxd_username,
    )
    result = session.exec(stmt).one_or_none() is not None
    return result


def add_watchlist_selection(
    *,
    session: Session,
    letterboxd_username: str,
    movie_id: int,
) -> Movie:
    """
    Add a movie to a user's watchlist.

    Parameters:
        session (Session): The database session.
        letterboxd_username (str): The username of the user on Letterboxd.
        movie_id (int): The ID of the movie to add.
    Returns:
        Movie: The movie object that was added to the watchlist.
    Raises:
        IntegrityError: If the watchlist selection already exists.
        ForeignKeyViolation: If the movie/user does not exist.
    """

    selection = WatchlistSelection(
        letterboxd_username=letterboxd_username, movie_id=movie_id
    )
    session.add(selection)
    movie = session.get_one(Movie, movie_id)
    session.flush()  # Raise Errors
    return movie


def delete_watchlist_selection(
    *,
    session: Session,
    letterboxd_username: str,
    movie_id: int,
) -> Movie:
    """
    Remove a movie from a user's watchlist.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user.
        movie_id (int): The ID of the movie to remove.
    Returns:
        Movie: The movie object that was removed from the watchlist.
    """
    selection = session.exec(
        select(WatchlistSelection).where(
            WatchlistSelection.letterboxd_username == letterboxd_username,
            WatchlistSelection.movie_id == movie_id,
        )
    ).one()

    session.delete(selection)

    movie = session.get_one(Movie, movie_id)
    session.flush()
    return movie


def get_watchlist_selections(
    *,
    session: Session,
    letterboxd_username: str,
) -> list[WatchlistSelection]:
    stmt = select(WatchlistSelection).where(
        WatchlistSelection.letterboxd_username == letterboxd_username
    )
    selections: list[WatchlistSelection] = list(session.exec(stmt).all())
    return selections


def get_watchlist(
    *,
    session: Session,
    letterboxd_username: str,
) -> list[Movie]:
    stmt = (
        select(Movie)
        .join(WatchlistSelection, col(WatchlistSelection.movie_id) == col(Movie.id))
        .where(WatchlistSelection.letterboxd_username == letterboxd_username)
    )
    movies: list[Movie] = list(session.exec(stmt).all())
    return movies
