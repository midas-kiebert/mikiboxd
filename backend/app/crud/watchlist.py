from sqlmodel import Session, col, func, select

from app.models.movie import Movie
from app.models.watchlist_selection import WatchlistSelection


def does_watchlist_selection_exist(
    *,
    session: Session,
    letterboxd_slug: str,
    letterboxd_username: str,
) -> bool:
    """
    Check if a user has added a movie (by Letterboxd slug) to their watchlist.

    Parameters:
        session (Session): The database session.
        letterboxd_slug (str): The Letterboxd slug of the movie to check.
        letterboxd_username (str): The username of the user on Letterboxd.
    Returns:
        bool: True if the user has added the movie to their watchlist, otherwise False.
    """
    stmt = select(WatchlistSelection).where(
        WatchlistSelection.letterboxd_slug == letterboxd_slug,
        WatchlistSelection.letterboxd_username == letterboxd_username,
    )
    result = session.exec(stmt).one_or_none() is not None
    return result


def add_watchlist_selection(
    *,
    session: Session,
    letterboxd_username: str,
    letterboxd_slug: str,
    movie_id: int | None = None,
) -> WatchlistSelection:
    """
    Add a movie to a user's watchlist.

    Parameters:
        session (Session): The database session.
        letterboxd_username (str): The username of the user on Letterboxd.
        letterboxd_slug (str): The Letterboxd slug of the movie to add.
        movie_id (int | None): The ID of the movie in our catalog, if known.
    Returns:
        WatchlistSelection: The watchlist selection that was added.
    Raises:
        IntegrityError: If the watchlist selection already exists.
        ForeignKeyViolation: If the user/movie does not exist.
    """
    selection = WatchlistSelection(
        letterboxd_username=letterboxd_username,
        letterboxd_slug=letterboxd_slug,
        movie_id=movie_id,
    )
    session.add(selection)
    session.flush()  # Raise Errors
    return selection


def delete_watchlist_selection(
    *,
    session: Session,
    letterboxd_username: str,
    letterboxd_slug: str,
) -> WatchlistSelection:
    """
    Remove a movie from a user's watchlist.

    Parameters:
        session (Session): The database session.
        letterboxd_username (str): The username of the user on Letterboxd.
        letterboxd_slug (str): The Letterboxd slug of the movie to remove.
    Returns:
        WatchlistSelection: The watchlist selection that was removed.
    """
    selection = session.exec(
        select(WatchlistSelection).where(
            WatchlistSelection.letterboxd_username == letterboxd_username,
            WatchlistSelection.letterboxd_slug == letterboxd_slug,
        )
    ).one()

    session.delete(selection)
    session.flush()
    return selection


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


def count_watchlist_selections(
    *,
    session: Session,
    letterboxd_username: str,
) -> int:
    stmt = (
        select(func.count())
        .select_from(WatchlistSelection)
        .where(col(WatchlistSelection.letterboxd_username) == letterboxd_username)
    )
    return session.exec(stmt).one()


def get_watchlist(
    *,
    session: Session,
    letterboxd_username: str,
) -> list[Movie]:
    """
    Get the movies from a user's watchlist that exist in our catalog.

    Watchlist entries for movies we don't have in our catalog (movie_id is
    None) are not represented here.
    """
    stmt = (
        select(Movie)
        .join(WatchlistSelection, col(WatchlistSelection.movie_id) == col(Movie.id))
        .where(WatchlistSelection.letterboxd_username == letterboxd_username)
    )
    movies: list[Movie] = list(session.exec(stmt).all())
    return movies
