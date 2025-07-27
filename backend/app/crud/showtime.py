from collections.abc import Sequence
from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app import crud
from app.models import (
    Showtime,
    ShowtimeCreate,
    ShowtimeInMoviePublic,
    ShowtimePublic,
    ShowtimeSelection,
    User,
    UserPublic,
)
from app.models.utils import column

__all__ = [
    "add_showtime_selection",
    "create_showtime",
    "delete_showtime_selection",
    "get_all_showtimes_for_movie",
    "get_selected_showtimes_for_user",
    "get_first_n_showtimes",
    "get_showtime_by_id",
    "toggle_showtime_selection",
]


def is_going(*, session: Session, showtime_id: int, user_id: UUID) -> bool:
    """
    Check if a user is going to a specific showtime.
    """
    stmt = select(ShowtimeSelection).where(
        ShowtimeSelection.showtime_id == showtime_id,
        ShowtimeSelection.user_id == user_id,
    )
    result = session.exec(stmt).first() is not None
    print(
        "is_going result:",
        result,
        "for user_id:",
        user_id,
        "and showtime_id:",
        showtime_id,
    )
    return result


def get_showtime_by_id(
    *,
    session: Session,
    showtime_id: int,
    current_user: UUID | None = None,
) -> ShowtimePublic | None:
    """
    Retrieve a showtime by its ID.
    """
    stmt = select(Showtime).where(Showtime.id == showtime_id)
    showtime = session.exec(stmt).first()
    if showtime is None:
        return None
    showtime_public = ShowtimePublic.model_validate(showtime)
    if current_user is None:
        return showtime_public
    showtime_public.going = is_going(
        session=session, user_id=current_user, showtime_id=showtime_id
    )
    return showtime_public


def create_showtime(*, session: Session, showtime_create: ShowtimeCreate) -> Showtime:
    db_obj = Showtime.model_validate(showtime_create)
    session.add(db_obj)
    try:
        session.commit()
        session.refresh(db_obj)
    except IntegrityError:
        session.rollback()
    return db_obj


def get_all_showtimes_for_movie(
    *,
    session: Session,
    movie_id: int,
    current_user: UUID,
) -> list[ShowtimeInMoviePublic]:
    """
    Retrieve all showtimes for a specific movie
    """

    friends = crud.get_friends(session=session, user_id=current_user)
    friend_ids = {friend.id for friend in friends}

    stmt = (
        select(Showtime)
        .where(Showtime.movie_id == movie_id)
        .where(
            Showtime.datetime
            >= datetime.now(tz=ZoneInfo("Europe/Amsterdam")).replace(tzinfo=None)
        )
        .order_by(column(Showtime.datetime))
    )
    showtimes = session.exec(stmt).all()
    showtimes_public = [
        ShowtimeInMoviePublic.model_validate(showtime) for showtime in showtimes
    ]
    for showtime in showtimes_public:
        friends_going_stmt = (
            select(User)
            .join(ShowtimeSelection, col(ShowtimeSelection.user_id) == col(User.id))
            .where(ShowtimeSelection.showtime_id == showtime.id)
            .where(col(User.id).in_(friend_ids))
        )
        friends_going = session.exec(friends_going_stmt).all()
        showtime.friends_going = [
            UserPublic.model_validate(friend) for friend in friends_going
        ]
        user_going_stmt = select(ShowtimeSelection).where(
            ShowtimeSelection.showtime_id == showtime.id,
            ShowtimeSelection.user_id == current_user,
        )
        going = session.exec(user_going_stmt).first()
        showtime.going = going is not None
    return showtimes_public


def get_selected_showtimes_for_user(
    *,
    session: Session,
    user_id: UUID,
) -> Sequence[Showtime]:
    stmt = (
        select(Showtime)
        .join(
            ShowtimeSelection,
            column(Showtime.id) == column(ShowtimeSelection.showtime_id),
        )
        .where(ShowtimeSelection.user_id == user_id)
        .where(
            Showtime.datetime
            >= datetime.now(tz=ZoneInfo("Europe/Amsterdam")).replace(tzinfo=None)
        )
        .order_by(column(Showtime.datetime))
    )
    showtimes = session.exec(stmt).all()
    if not showtimes:
        return []
    return showtimes


# def get_split_showtimes_for_movie(
#     *,
#     session: Session,
#     movie_id: int,
#     current_user: UUID,
# ) -> tuple[list[ShowtimeInMoviePublic], list[ShowtimeInMoviePublic]]:
#     """
#     Retrieve all showtimes for a specific movie, split by if friends are going or not
#     """
#     stmt = (
#         select(Showtime)
#         .where(Showtime.movie_id == movie_id)
#         .where(
#             Showtime.datetime
#             >= datetime.now(tz=ZoneInfo("Europe/Amsterdam")).replace(tzinfo=None)
#         )
#         .order_by(column(Showtime.datetime))
#     )
#     showtimes = session.exec(stmt).all()

#     friends = crud.get_friends(session=session, user_id=current_user)
#     friend_ids = {friend.id for friend in friends}

#     showtimes_with_friends: list[ShowtimeInMoviePublic] = []
#     showtimes_without_friends: list[ShowtimeInMoviePublic] = []
#     for showtime in showtimes:
#         showtime_public = ShowtimeInMoviePublic.model_validate(showtime)
#         friends_going_stmt = (
#             select(User)
#             .join(
#                 ShowtimeSelection, column(ShowtimeSelection.user_id) == column(User.id)
#             )
#             .where(ShowtimeSelection.showtime_id == showtime.id)
#             .where(column(User.id).in_(friend_ids))
#         )
#         friends_going = session.exec(friends_going_stmt).all()
#         showtime_public.friends_going = [
#             UserPublic.model_validate(friend) for friend in friends_going
#         ]
#         if showtime_public.friends_going:
#             showtimes_with_friends.append(showtime_public)
#         else:
#             showtimes_without_friends.append(showtime_public)

#     return showtimes_with_friends, showtimes_without_friends


def get_first_n_showtimes(
    *,
    session: Session,
    movie_id: int,
    n: int = 5,
) -> list[ShowtimeInMoviePublic]:
    """
    Retrieve the first N showtimes for a movie.
    """
    now = datetime.now(tz=ZoneInfo("Europe/Amsterdam")).replace(tzinfo=None)
    stmt = (
        select(Showtime)
        .where(Showtime.movie_id == movie_id)
        .where(Showtime.datetime >= now)
        .order_by(column(Showtime.datetime))
        .limit(n)
    )
    showtimes = list(session.exec(stmt).all())
    showtimes_in_movie = [
        ShowtimeInMoviePublic.model_validate(showtime) for showtime in showtimes
    ]
    return showtimes_in_movie


def add_showtime_selection(
    *, session: Session, user_id: UUID, showtime_id: int
) -> None:
    """
    Add a selection for a showtime by a user.
    """
    selection = ShowtimeSelection(user_id=user_id, showtime_id=showtime_id)
    session.add(selection)
    try:
        session.commit()
        session.refresh(selection)
    except IntegrityError:
        session.rollback()
        raise ValueError("Selection already exists or invalid data.")


def delete_showtime_selection(
    *, session: Session, user_id: UUID, showtime_id: int
) -> None:
    """
    Delete a selection for a showtime by a user.
    """
    selection = session.exec(
        select(ShowtimeSelection).where(
            (ShowtimeSelection.user_id == user_id)
            & (ShowtimeSelection.showtime_id == showtime_id)
        )
    ).first()
    if not selection:
        raise ValueError("Selection does not exist.")

    session.delete(selection)

    try:
        session.commit()
    except IntegrityError:
        session.rollback()
        raise ValueError("Failed to delete selection.")


def toggle_showtime_selection(
    *,
    session: Session,
    user_id: UUID,
    showtime_id: int,
) -> ShowtimePublic:
    """
    Toggle a user's selection for a showtime.
    If the selection exists, it will be deleted; otherwise, it will be created.
    """
    try:
        add_showtime_selection(
            session=session, user_id=user_id, showtime_id=showtime_id
        )
    except ValueError:
        delete_showtime_selection(
            session=session, user_id=user_id, showtime_id=showtime_id
        )

    showtime = get_showtime_by_id(
        session=session, showtime_id=showtime_id, current_user=user_id
    )
    if not showtime:
        raise ValueError("Showtime not found.")
    print(showtime)
    return showtime
