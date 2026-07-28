from sqlalchemy import exists, update
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


def relink_watched_selections_to_catalog(
    *,
    session: Session,
    letterboxd_username: str,
) -> int:
    """Attach movie ids to this user's watched rows that were stored without one.

    A row is written with `movie_id` NULL whenever the film was not in our
    catalog at sync time — either it had never been screened by a scraped
    cinema, or it had no `letterboxd_slug` yet because enrichment had not
    reached it. Both change over time, but nothing else ever revisits the row:
    `movie_id` is only ever written at insert.

    That matters because `get_watched` joins on `movie_id`, so an unlinked row
    is invisible — a film the user has seen is not treated as watched. The full
    re-walk fixes it by replacing every row, but the RSS top-up only inserts
    new slugs, so without this a newly-catalogued film would go unrecognised
    until the next full walk.

    Parameters:
        session (Session): The database session.
        letterboxd_username (str): The username of the user on Letterboxd.
    Returns:
        int: How many rows were linked to a movie.
    """
    matching_movie_id = (
        select(col(Movie.id))
        .where(col(Movie.letterboxd_slug) == col(WatchedSelection.letterboxd_slug))
        .limit(1)
        .scalar_subquery()
    )
    stmt = (
        update(WatchedSelection)
        .where(
            col(WatchedSelection.letterboxd_username) == letterboxd_username,
            col(WatchedSelection.movie_id).is_(None),
            exists(
                select(col(Movie.id)).where(
                    col(Movie.letterboxd_slug)
                    == col(WatchedSelection.letterboxd_slug)
                )
            ),
        )
        .values(movie_id=matching_movie_id)
    )
    result = session.execute(stmt)
    return result.rowcount or 0


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
