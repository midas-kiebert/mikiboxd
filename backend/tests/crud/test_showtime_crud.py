from collections.abc import Callable
from datetime import time, timedelta

import pytest
from psycopg.errors import ForeignKeyViolation, UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.core.enums import GoingStatus, Language
from app.crud import friendship as friendship_crud
from app.crud import showtime as showtime_crud
from app.crud import user as user_crud
from app.inputs.movie import Filters, TimeRange
from app.models.cinema import Cinema
from app.models.letterboxd_list import LetterboxdList, LetterboxdListFilm
from app.models.movie import Movie
from app.models.showtime import Showtime, ShowtimeCreate
from app.models.user import User
from app.models.watched_selection import WatchedSelection
from app.models.watchlist_selection import WatchlistSelection
from app.utils import now_amsterdam_naive


def test_get_showtime_by_id_success(*, db_transaction: Session, showtime_factory):
    showtime: Showtime = showtime_factory()

    retrieved_showtime = showtime_crud.get_showtime_by_id(
        session=db_transaction,
        showtime_id=showtime.id,
    )

    # Check if the returned object matches the one in the database
    assert retrieved_showtime is showtime


def test_get_showtime_by_id_not_found(
    *,
    db_transaction: Session,
):
    retrieved_showtime = showtime_crud.get_showtime_by_id(
        session=db_transaction,
        showtime_id=1,  # Assuming this ID does not exist
    )

    # Check if the returned object is None when the showtime does not exist
    assert retrieved_showtime is None


def test_create_showtime_success(
    *,
    db_transaction: Session,
    showtime_create_factory,
    movie_factory,
    cinema_factory,
):
    movie: Movie = movie_factory()
    cinema: Cinema = cinema_factory()
    showtime_create: ShowtimeCreate = showtime_create_factory(
        movie_id=movie.id,
        cinema_id=cinema.id,  # Assuming cinema_id is optional for this test
    )

    created_showtime = showtime_crud.create_showtime(
        session=db_transaction,
        showtime_create=showtime_create,
    )

    # Check if the returned object is correct
    assert created_showtime.id is not None
    assert created_showtime.cinema_id == showtime_create.cinema_id
    assert created_showtime.movie_id == showtime_create.movie_id
    assert created_showtime.datetime == showtime_create.datetime

    inserted_showtime = db_transaction.get(Showtime, created_showtime.id)

    assert inserted_showtime is created_showtime


def test_create_showtime_already_exists(
    *,
    db_transaction: Session,
    showtime_create_factory,
    showtime_factory,
):
    existing_showtime: Showtime = showtime_factory()
    showtime_create: ShowtimeCreate = showtime_create_factory(
        datetime=existing_showtime.datetime,
        movie_id=existing_showtime.movie_id,
        cinema_id=existing_showtime.cinema_id,
    )

    with pytest.raises(IntegrityError) as exc_info:
        showtime_crud.create_showtime(
            session=db_transaction,
            showtime_create=showtime_create,
        )

    # Check if the error is a UniqueViolation
    assert isinstance(exc_info.value.orig, UniqueViolation)


def test_create_showtime_invalid_movie(
    *, db_transaction: Session, showtime_create_factory, cinema_factory
):
    cinema: Cinema = cinema_factory()
    showtime_create: ShowtimeCreate = showtime_create_factory(
        cinema_id=cinema.id, movie_id=1
    )

    with pytest.raises(IntegrityError) as exc_info:
        showtime_crud.create_showtime(
            session=db_transaction,
            showtime_create=showtime_create,
        )

    # Check if the error is a ForeignKeyViolation
    assert isinstance(exc_info.value.orig, ForeignKeyViolation)


def test_create_showtime_invalid_cinema(
    *, db_transaction: Session, showtime_create_factory, movie_factory
):
    movie: Movie = movie_factory()
    showtime_create: ShowtimeCreate = showtime_create_factory(
        movie_id=movie.id, cinema_id=1
    )

    with pytest.raises(IntegrityError) as exc_info:
        showtime_crud.create_showtime(
            session=db_transaction,
            showtime_create=showtime_create,
        )

    # Check if the error is a ForeignKeyViolation
    assert isinstance(exc_info.value.orig, ForeignKeyViolation)


def test_get_friends_for_showtime(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    friend_1 = user_factory()
    friend_2 = user_factory()
    user_3 = user_factory()
    showtime = showtime_factory()

    # Create friendships
    friendship_crud.create_friendship(
        session=db_transaction, user_id=user.id, friend_id=friend_1.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=user.id, friend_id=friend_2.id
    )

    user_crud.add_showtime_selection(
        session=db_transaction, user_id=user.id, showtime_id=showtime.id
    )
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=friend_1.id, showtime_id=showtime.id
    )
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=user_3.id, showtime_id=showtime.id
    )

    friends = showtime_crud.get_friends_for_showtime(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=user.id,
    )

    # Check if the returned list contains the friend
    assert friend_1 in friends
    assert len(friends) == 1


def test_get_friends_with_showtime_selection_includes_going_and_interested(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    actor = user_factory()
    friend_going = user_factory()
    friend_interested = user_factory()
    non_friend = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=actor.id, friend_id=friend_going.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=actor.id, friend_id=friend_interested.id
    )

    showtime_crud.add_showtime_selection(
        session=db_transaction,
        user_id=friend_going.id,
        showtime_id=showtime.id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        user_id=friend_interested.id,
        showtime_id=showtime.id,
        going_status=GoingStatus.INTERESTED,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        user_id=non_friend.id,
        showtime_id=showtime.id,
        going_status=GoingStatus.GOING,
    )

    recipients = showtime_crud.get_friends_with_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        friend_id=actor.id,
        statuses=[GoingStatus.GOING, GoingStatus.INTERESTED],
    )

    recipient_ids = {recipient.id for recipient in recipients}
    assert recipient_ids == {friend_going.id, friend_interested.id}


def test_get_main_page_showtimes_filters_by_selected_statuses(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    friend = user_factory()
    other_user = user_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=user.id, friend_id=friend.id
    )

    showtime_going = showtime_factory()
    showtime_interested = showtime_factory()
    showtime_other_user = showtime_factory()

    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_going.id,
        user_id=user.id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_interested.id,
        user_id=friend.id,
        going_status=GoingStatus.INTERESTED,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_other_user.id,
        user_id=other_user.id,
        going_status=GoingStatus.GOING,
    )

    going_only = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_statuses=[GoingStatus.GOING],
        ),
    )

    assert showtime_going in going_only
    assert showtime_interested not in going_only
    assert showtime_other_user not in going_only

    interested = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_statuses=[GoingStatus.GOING, GoingStatus.INTERESTED],
        ),
    )

    assert showtime_going in interested
    assert showtime_interested in interested
    assert showtime_other_user not in interested


def test_get_main_page_showtimes_returns_all_showtimes_when_no_selected_statuses(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()

    showtime_a = showtime_factory()
    showtime_b = showtime_factory()

    showtimes = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
        ),
    )

    assert {s.id for s in showtimes} == {showtime_a.id, showtime_b.id}


def test_get_main_page_showtimes_applies_cinema_day_time_query_and_watchlist_filters(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    cinema_factory: Callable[..., Cinema],
):
    user = user_factory()
    friend = user_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=user.id, friend_id=friend.id
    )

    cinema_match = cinema_factory()
    cinema_other = cinema_factory()
    movie_match = movie_factory(title="Match Title")
    movie_other = movie_factory(title="Other Title")

    base_day = now_amsterdam_naive().replace(hour=10, minute=0, second=0, microsecond=0)
    morning = base_day + timedelta(days=1)
    evening = morning.replace(hour=19)

    showtime_match = showtime_factory(
        movie=movie_match, cinema=cinema_match, datetime=morning
    )
    showtime_wrong_time = showtime_factory(
        movie=movie_match, cinema=cinema_match, datetime=evening
    )
    showtime_wrong_cinema = showtime_factory(
        movie=movie_match, cinema=cinema_other, datetime=morning
    )
    showtime_wrong_query = showtime_factory(
        movie=movie_other, cinema=cinema_match, datetime=morning
    )

    for showtime in (
        showtime_match,
        showtime_wrong_time,
        showtime_wrong_cinema,
        showtime_wrong_query,
    ):
        showtime_crud.add_showtime_selection(
            session=db_transaction,
            showtime_id=showtime.id,
            user_id=friend.id,
            going_status=GoingStatus.GOING,
        )

    db_transaction.add(
        WatchlistSelection(
            letterboxd_username=user.letterboxd_username,
            letterboxd_slug=movie_match.letterboxd_slug,
            movie_id=movie_match.id,
        )
    )
    db_transaction.flush()

    showtimes = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            query="Match",
            watchlist_only=True,
            selected_cinema_ids=[cinema_match.id],
            days=[morning.date()],
            time_ranges=[TimeRange(start=time(9, 0), end=time(12, 0))],
        ),
        letterboxd_username=user.letterboxd_username,
    )

    assert showtimes == [showtime_match]


def test_get_main_page_showtimes_hide_watched_filter(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
):
    user = user_factory()

    movie_watched = movie_factory()
    movie_unwatched = movie_factory()

    showtime_watched = showtime_factory(movie=movie_watched)
    showtime_unwatched = showtime_factory(movie=movie_unwatched)

    db_transaction.add(
        WatchedSelection(
            letterboxd_username=user.letterboxd_username,
            letterboxd_slug=movie_watched.letterboxd_slug,
            movie_id=movie_watched.id,
        )
    )
    db_transaction.flush()

    showtimes = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            hide_watched=True,
        ),
        letterboxd_username=user.letterboxd_username,
    )

    assert showtimes == [showtime_unwatched]
    assert showtime_watched not in showtimes


def test_count_main_page_showtimes_hide_watched_filter(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
):
    user = user_factory()

    movie_watched = movie_factory()
    movie_unwatched = movie_factory()

    showtime_factory(movie=movie_watched)
    showtime_factory(movie=movie_unwatched)

    db_transaction.add(
        WatchedSelection(
            letterboxd_username=user.letterboxd_username,
            letterboxd_slug=movie_watched.letterboxd_slug,
            movie_id=movie_watched.id,
        )
    )
    db_transaction.flush()

    count = showtime_crud.count_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            hide_watched=True,
        ),
        letterboxd_username=user.letterboxd_username,
    )

    assert count == 1


def test_get_main_page_showtimes_filters_by_list_ids(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
):
    user = user_factory()

    movie_on_list = movie_factory()
    movie_off_list = movie_factory()
    showtime_on_list = showtime_factory(movie=movie_on_list)
    showtime_off_list = showtime_factory(movie=movie_off_list)

    lb_list = LetterboxdList(owner="official", list_slug="top-500")
    db_transaction.add(lb_list)
    db_transaction.flush()
    db_transaction.add(
        LetterboxdListFilm(
            list_id=lb_list.id,
            letterboxd_slug=movie_on_list.letterboxd_slug,
            movie_id=movie_on_list.id,
        )
    )
    db_transaction.flush()

    showtimes = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            list_ids=[lb_list.id],
        ),
        letterboxd_username=user.letterboxd_username,
    )

    assert showtimes == [showtime_on_list]
    assert showtime_off_list not in showtimes

    count = showtime_crud.count_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            list_ids=[lb_list.id],
        ),
        letterboxd_username=user.letterboxd_username,
    )
    assert count == 1


def test_get_main_page_showtimes_excludes_by_list_ids(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
):
    user = user_factory()

    movie_on_list = movie_factory()
    movie_off_list = movie_factory()
    showtime_factory(movie=movie_on_list)
    showtime_off_list = showtime_factory(movie=movie_off_list)

    lb_list = LetterboxdList(owner="official", list_slug="top-500")
    db_transaction.add(lb_list)
    db_transaction.flush()
    db_transaction.add(
        LetterboxdListFilm(
            list_id=lb_list.id,
            letterboxd_slug=movie_on_list.letterboxd_slug,
            movie_id=movie_on_list.id,
        )
    )
    db_transaction.flush()

    showtimes = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            exclude_list_ids=[lb_list.id],
        ),
        letterboxd_username=user.letterboxd_username,
    )

    assert showtimes == [showtime_off_list]


def test_get_main_page_showtimes_unions_watchlist_and_list_includes(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
):
    """include watchlist + include list keeps movies on EITHER (union)."""
    user = user_factory()

    movie_watchlisted = movie_factory()
    movie_on_list = movie_factory()
    movie_neither = movie_factory()
    st_watchlisted = showtime_factory(movie=movie_watchlisted)
    st_on_list = showtime_factory(movie=movie_on_list)
    showtime_factory(movie=movie_neither)

    db_transaction.add(
        WatchlistSelection(
            letterboxd_username=user.letterboxd_username,
            letterboxd_slug=movie_watchlisted.letterboxd_slug,
            movie_id=movie_watchlisted.id,
        )
    )
    lb_list = LetterboxdList(owner="official", list_slug="top-500")
    db_transaction.add(lb_list)
    db_transaction.flush()
    db_transaction.add(
        LetterboxdListFilm(
            list_id=lb_list.id,
            letterboxd_slug=movie_on_list.letterboxd_slug,
            movie_id=movie_on_list.id,
        )
    )
    db_transaction.flush()

    showtimes = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            watchlist_only=True,
            list_ids=[lb_list.id],
        ),
        letterboxd_username=user.letterboxd_username,
    )

    assert {s.id for s in showtimes} == {st_watchlisted.id, st_on_list.id}


def test_get_main_page_showtimes_day_filter_uses_four_hour_day_bucket(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()

    day = now_amsterdam_naive().replace(
        hour=12, minute=0, second=0, microsecond=0
    ) + timedelta(days=1)
    same_day_evening = day.replace(hour=23, minute=0)
    next_day_early = (day + timedelta(days=1)).replace(hour=2, minute=0)
    same_day_early = day.replace(hour=2, minute=0)
    next_day_morning = (day + timedelta(days=1)).replace(hour=5, minute=0)

    showtime_should_match_evening = showtime_factory(datetime=same_day_evening)
    showtime_should_match_next_day_early = showtime_factory(datetime=next_day_early)
    showtime_should_not_match_same_day_early = showtime_factory(datetime=same_day_early)
    showtime_should_not_match_next_day_morning = showtime_factory(
        datetime=next_day_morning
    )

    showtimes = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=day - timedelta(days=1),
            days=[day.date()],
        ),
    )

    assert showtime_should_match_evening in showtimes
    assert showtime_should_match_next_day_early in showtimes
    assert showtime_should_not_match_same_day_early not in showtimes
    assert showtime_should_not_match_next_day_morning not in showtimes


def test_get_main_page_showtimes_open_ended_start_range_includes_until_4am(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    base_day = now_amsterdam_naive().replace(
        hour=12, minute=0, second=0, microsecond=0
    ) + timedelta(days=1)

    showtime_early_evening = showtime_factory(
        datetime=base_day.replace(hour=21, minute=30)
    )
    showtime_night = showtime_factory(datetime=base_day.replace(hour=22, minute=30))
    showtime_after_midnight = showtime_factory(
        datetime=(base_day + timedelta(days=1)).replace(hour=2, minute=30)
    )
    showtime_after_cutoff = showtime_factory(
        datetime=(base_day + timedelta(days=1)).replace(hour=5, minute=0)
    )

    showtimes = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=base_day - timedelta(days=1),
            time_ranges=[TimeRange(start=time(22, 0), end=None)],
        ),
    )

    assert showtime_early_evening not in showtimes
    assert showtime_night in showtimes
    assert showtime_after_midnight in showtimes
    assert showtime_after_cutoff not in showtimes


def test_get_main_page_showtimes_open_ended_end_range_starts_at_day_bucket_cutoff(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    base_day = now_amsterdam_naive().replace(
        hour=12, minute=0, second=0, microsecond=0
    ) + timedelta(days=1)

    day_bucket_cutoff = showtime_crud.DAY_BUCKET_CUTOFF
    day_start = base_day.replace(
        hour=day_bucket_cutoff.hour,
        minute=day_bucket_cutoff.minute,
        second=0,
        microsecond=0,
    )

    before_day_start_start = day_start - timedelta(minutes=30)
    showtime_before_day_start = showtime_factory(
        datetime=before_day_start_start,
        end_datetime=before_day_start_start + timedelta(minutes=20),
    )

    from_day_start_start = day_start + timedelta(minutes=15)
    showtime_from_day_start = showtime_factory(
        datetime=from_day_start_start,
        end_datetime=from_day_start_start + timedelta(minutes=20),
    )

    late_evening_start = base_day.replace(hour=23, minute=30, second=0, microsecond=0)
    showtime_late_evening = showtime_factory(
        datetime=late_evening_start,
        end_datetime=late_evening_start + timedelta(hours=1),
    )

    after_midnight_start = (base_day + timedelta(days=1)).replace(
        hour=0, minute=15, second=0, microsecond=0
    )
    showtime_after_midnight = showtime_factory(
        datetime=after_midnight_start,
        end_datetime=after_midnight_start + timedelta(minutes=30),
    )

    after_end_start = (base_day + timedelta(days=1)).replace(
        hour=0, minute=50, second=0, microsecond=0
    )
    showtime_after_end = showtime_factory(
        datetime=after_end_start,
        end_datetime=after_end_start + timedelta(minutes=30),
    )

    showtimes = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=base_day - timedelta(days=1),
            time_ranges=[TimeRange(start=None, end=time(1, 0))],
        ),
    )

    assert showtime_before_day_start not in showtimes
    assert showtime_from_day_start in showtimes
    assert showtime_late_evening in showtimes
    assert showtime_after_midnight in showtimes
    assert showtime_after_end not in showtimes


def test_get_main_page_showtimes_bounded_range_checks_showtime_end_time(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    base_day = now_amsterdam_naive().replace(
        hour=12, minute=0, second=0, microsecond=0
    ) + timedelta(days=1)

    showtime_inside_range = showtime_factory(
        datetime=base_day.replace(hour=10, minute=30),
        end_datetime=base_day.replace(hour=12, minute=20),
    )
    showtime_spilling_past_end = showtime_factory(
        datetime=base_day.replace(hour=11, minute=15),
        end_datetime=base_day.replace(hour=13, minute=30),
    )
    showtime_without_end_datetime = showtime_factory(
        datetime=base_day.replace(hour=12, minute=45),
        end_datetime=None,
    )

    showtimes = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=base_day - timedelta(days=1),
            time_ranges=[TimeRange(start=time(10, 0), end=time(13, 0))],
        ),
    )

    assert showtime_inside_range in showtimes
    assert showtime_spilling_past_end not in showtimes
    # Backward-compatible fallback: when end time is unknown, treat start as end.
    assert showtime_without_end_datetime in showtimes


def test_get_main_page_showtimes_filters_by_movie_runtime(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    movie_factory: Callable[..., Movie],
    user_factory: Callable[..., User],
):
    user = user_factory()
    movie_short = movie_factory(duration=80)
    movie_match = movie_factory(duration=105)
    movie_long = movie_factory(duration=150)

    showtime_short = showtime_factory(movie=movie_short)
    showtime_match = showtime_factory(movie=movie_match)
    showtime_long = showtime_factory(movie=movie_long)

    showtimes = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            runtime_min=90,
            runtime_max=120,
        ),
    )

    assert showtime_short not in showtimes
    assert showtime_match in showtimes
    assert showtime_long not in showtimes


def test_get_main_page_showtimes_filters_by_selected_languages(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    movie_factory: Callable[..., Movie],
    user_factory: Callable[..., User],
):
    user = user_factory()

    # Regression case: "Army of Shadows" - French audio with English subtitles
    # must NOT match a Dutch-only language filter.
    movie_french = movie_factory(original_language="fr")
    movie_dutch = movie_factory(original_language="nl")

    showtime_french = showtime_factory(movie=movie_french, subtitles=["en"])
    showtime_dutch = showtime_factory(movie=movie_dutch, subtitles=["en", "nl"])

    showtimes = showtime_crud.get_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_languages=[Language.DUTCH],
        ),
    )

    assert showtime_dutch in showtimes
    assert showtime_french not in showtimes


def test_count_main_page_showtimes_filters_by_selected_languages(
    *,
    db_transaction: Session,
    showtime_factory: Callable[..., Showtime],
    movie_factory: Callable[..., Movie],
    user_factory: Callable[..., User],
):
    user = user_factory()

    movie_french = movie_factory(original_language="fr")
    movie_dutch = movie_factory(original_language="nl")

    showtime_factory(movie=movie_french, subtitles=["en"])
    showtime_factory(movie=movie_dutch, subtitles=["en", "nl"])

    count = showtime_crud.count_main_page_showtimes(
        session=db_transaction,
        user_id=user.id,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_languages=[Language.DUTCH],
        ),
    )

    assert count == 1
