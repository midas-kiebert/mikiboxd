"""Shared logic for the "movie set" filters (watchlist / watched / lists).

These filters all restrict the result to a *set of movie ids*. They combine
uniformly: a movie is kept when it is in the UNION of every active *include*
set (so "watchlist + Top 500" shows movies on either) and in NONE of the
*exclude* sets (so "exclude watched" hides them). This module centralises that
logic so the showtime and movie queries stay in sync.
"""

from typing import Any
from uuid import UUID

from sqlmodel import col, or_, select

from app.inputs.movie import Filters
from app.models.letterboxd_list import LetterboxdListFilm
from app.models.watched_selection import WatchedSelection
from app.models.watchlist_selection import WatchlistSelection


def watchlist_movie_ids_subquery(letterboxd_username: str) -> Any:
    return select(col(WatchlistSelection.movie_id)).where(
        col(WatchlistSelection.letterboxd_username) == letterboxd_username,
        col(WatchlistSelection.movie_id).is_not(None),
    )


def watched_movie_ids_subquery(letterboxd_username: str) -> Any:
    return select(col(WatchedSelection.movie_id)).where(
        col(WatchedSelection.letterboxd_username) == letterboxd_username,
        col(WatchedSelection.movie_id).is_not(None),
    )


def list_movie_ids_subquery(list_ids: list[UUID]) -> Any:
    """Movie ids that appear on any of the given Letterboxd lists.

    Films whose slug we couldn't match to a catalog movie have a NULL
    ``movie_id`` and are excluded.
    """
    return select(col(LetterboxdListFilm.movie_id)).where(
        col(LetterboxdListFilm.list_id).in_(list_ids),
        col(LetterboxdListFilm.movie_id).is_not(None),
    )


def apply_movie_set_filters(
    stmt: Any,
    *,
    movie_id_col: Any,
    filters: Filters,
    letterboxd_username: str | None,
) -> tuple[Any, bool]:
    """Apply the include/exclude movie-set filters to ``stmt``.

    Returns the (possibly) modified statement and a ``force_empty`` flag: when an
    include filter is requested but its set cannot be resolved (e.g. a watchlist
    include without a linked Letterboxd account), the result must be empty.
    """
    include_subqueries: list[Any] = []
    exclude_subqueries: list[Any] = []

    if letterboxd_username is not None:
        if filters.watchlist_only:
            include_subqueries.append(watchlist_movie_ids_subquery(letterboxd_username))
        if filters.watched_only:
            include_subqueries.append(watched_movie_ids_subquery(letterboxd_username))
        if filters.watchlist_exclude:
            exclude_subqueries.append(watchlist_movie_ids_subquery(letterboxd_username))
        if filters.hide_watched:
            exclude_subqueries.append(watched_movie_ids_subquery(letterboxd_username))

    if filters.list_ids:
        include_subqueries.append(list_movie_ids_subquery(filters.list_ids))
    if filters.exclude_list_ids:
        exclude_subqueries.append(list_movie_ids_subquery(filters.exclude_list_ids))

    # An include was requested (watchlist/watched/lists) but produced no resolvable
    # set — there is nothing it could match, so the caller should return empty.
    include_requested = bool(
        filters.watchlist_only or filters.watched_only or filters.list_ids
    )
    if include_requested and not include_subqueries:
        return stmt, True

    if include_subqueries:
        stmt = stmt.where(or_(*[movie_id_col.in_(sq) for sq in include_subqueries]))
    for sq in exclude_subqueries:
        stmt = stmt.where(movie_id_col.not_in(sq))

    return stmt, False
