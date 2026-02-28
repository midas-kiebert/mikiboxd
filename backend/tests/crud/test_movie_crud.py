from collections.abc import Callable
from datetime import timedelta

import pytest
from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.core.enums import GoingStatus
from app.crud import friendship as friendship_crud
from app.crud import movie as movie_crud
from app.crud import showtime as showtime_crud
from app.crud import user as user_crud
from app.inputs.movie import Filters
from app.models.movie import Movie, MovieCreate, MovieUpdate
from app.models.showtime import Showtime
from app.models.user import User
from app.utils import now_amsterdam_naive


def test_get_movie_by_id_success(
    *,
    db_transaction: Session,
    movie_factory,
):
    movie: Movie = movie_factory()

    retrieved_movie = movie_crud.get_movie_by_id(
        session=db_transaction,
        id=movie.id,
    )

    # Check if the returned object matches the one in the database
    assert retrieved_movie is movie


def test_get_movie_by_id_not_found(
    *,
    db_transaction: Session,
):
    retrieved_movie = movie_crud.get_movie_by_id(
        session=db_transaction,
        id=1,  # Assuming this ID does not exist
    )

    # Check if the returned object is None when the movie does not exist
    assert retrieved_movie is None


def test_create_movie_success(
    *,
    db_transaction: Session,
    movie_create_factory,
):
    movie_create: MovieCreate = movie_create_factory()

    created_movie = movie_crud.create_movie(
        session=db_transaction,
        movie_create=movie_create,
    )

    # Check if the returned object is correct
    assert created_movie.id is not None
    assert created_movie.title == movie_create.title
    assert created_movie.poster_link == movie_create.poster_link
    assert created_movie.letterboxd_slug == movie_create.letterboxd_slug


def test_create_movie_already_exists(
    *,
    db_transaction: Session,
    movie_create_factory,
    movie_factory,
):
    movie: Movie = movie_factory()

    movie_create: MovieCreate = movie_create_factory(id=movie.id)

    with pytest.raises(IntegrityError) as exc_info:
        movie_crud.create_movie(
            session=db_transaction,
            movie_create=movie_create,
        )

    assert isinstance(exc_info.value.orig, UniqueViolation)


def test_get_movie_by_letterboxd_slug_success(
    *,
    db_transaction: Session,
    movie_factory,
):
    movie: Movie = movie_factory()
    assert movie.letterboxd_slug is not None

    retrieved_movie = movie_crud.get_movie_by_letterboxd_slug(
        session=db_transaction,
        letterboxd_slug=movie.letterboxd_slug,
    )

    # Check if the returned object matches the one in the database
    assert retrieved_movie is movie


def test_get_movie_by_letterboxd_slug_not_found(
    *,
    db_transaction: Session,
):
    retrieved_movie = movie_crud.get_movie_by_letterboxd_slug(
        session=db_transaction,
        letterboxd_slug="nonexistent-slug",
    )

    # Check if the returned object is None when the movie does not exist
    assert retrieved_movie is None


def test_get_movies_without_letterboxd_slug(
    *,
    db_transaction: Session,
    movie_factory,
):
    # Create movies with and without Letterboxd slugs
    movie_factory(letterboxd_slug="valid-slug")
    movie_without_slug: Movie = movie_factory(letterboxd_slug=None)

    movies_without_slug = movie_crud.get_movies_without_letterboxd_slug(
        session=db_transaction,
    )

    # Check if the returned list contains only the movie without a slug
    assert len(movies_without_slug) == 1
    assert movies_without_slug[0] is movie_without_slug
    assert movies_without_slug[0].letterboxd_slug is None


def test_update_movie_success(
    *,
    movie_factory: Callable[..., Movie]
):
    movie: Movie = movie_factory()

    movie_update = MovieUpdate(letterboxd_slug="updated-slug")

    updated_movie = movie_crud.update_movie(db_movie=movie, movie_update=movie_update)

    assert movie.letterboxd_slug == "updated-slug"
    assert updated_movie is movie


def test_upsert_movie_preserves_existing_duration_when_payload_duration_is_missing(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
):
    existing_movie = movie_factory(duration=121)
    movie_create = MovieCreate(
        id=existing_movie.id,
        title=existing_movie.title,
        poster_link=existing_movie.poster_link,
        letterboxd_slug=existing_movie.letterboxd_slug,
        duration=None,
    )

    updated_movie = movie_crud.upsert_movie(
        session=db_transaction,
        movie_create=movie_create,
    )

    assert updated_movie.id == existing_movie.id
    assert updated_movie.duration == 121


# def test_get_cinemas_for_movie(
#     *,
#     db_transaction: Session,
#     movie_factory: Callable[..., Movie],
#     cinema_factory: Callable[..., Cinema],
#     showtime_factory: Callable[..., Showtime],
#     user_factory: Callable[..., User],
# ):
#     cinema_1, cinema_2, cinema_3, cinema_4 = (cinema_factory() for _ in range(4))
#     user = user_factory()

#     past = now_amsterdam_naive() - timedelta(minutes=10)
#     future = now_amsterdam_naive() + timedelta(minutes=10)

#     movie = movie_factory(
#         showtimes=[
#             showtime_factory(cinema=cinema_1, datetime=past),
#             showtime_factory(cinema=cinema_2, datetime=past),
#             showtime_factory(cinema=cinema_2, datetime=future),
#             showtime_factory(cinema=cinema_3, datetime=future),
#         ]
#     )

#     movie_factory(
#         showtimes=[
#             showtime_factory(cinema=cinema_1, datetime=future),
#             showtime_factory(cinema=cinema_3, datetime=future),
#             showtime_factory(cinema=cinema_4, datetime=past),
#             showtime_factory(cinema=cinema_4, datetime=future),
#         ]
#     )

    # user_crud.set_cinema_selections(
    #     session=db_transaction,
    #     user_id=user.id,
    #     cinema_ids=[cinema_1.id, cinema_3.id, cinema_4.id],
    # )

    # cinemas = movie_crud.get_cinemas_for_movie(
    #     session=db_transaction,
    #     movie_id=movie.id,
    #     snapshot_time=now_amsterdam_naive(),
    #     current_user_id=user.id,
    # )

    # assert cinema_3 in cinemas
    # assert len(cinemas) == 1

    # user_crud.set_cinema_selections(
    #     session=db_transaction,
    #     user_id=user.id,
    #     cinema_ids=[cinema_1.id, cinema_2.id, cinema_3.id, cinema_4.id],
    # )

    # cinemas = movie_crud.get_cinemas_for_movie(
    #     session=db_transaction,
    #     movie_id=movie.id,
    #     snapshot_time=now_amsterdam_naive(),
    #     current_user_id=user.id,
    # )

    # assert cinema_2 in cinemas
    # assert cinema_3 in cinemas
    # assert len(cinemas) == 2

    # more_future = now_amsterdam_naive() + timedelta(minutes=20)

    # cinemas_in_20_minutes = movie_crud.get_cinemas_for_movie(
    #     session=db_transaction,
    #     movie_id=movie.id,
    #     snapshot_time=more_future,
    #     current_user_id=user.id,
    # )

    # assert len(cinemas_in_20_minutes) == 0


def test_get_friends_for_movie(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    user = user_factory()
    friend_1 = user_factory()
    friend_2 = user_factory()
    user_3 = user_factory()

    # Create friendships
    friendship_crud.create_friendship(
        session=db_transaction, user_id=user.id, friend_id=friend_1.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=user.id, friend_id=friend_2.id
    )

    past = now_amsterdam_naive() - timedelta(minutes=10)

    showtimes = [
        showtime_factory(datetime=past),
        showtime_factory(),
        showtime_factory(),
    ]

    other_showtime = showtime_factory()

    all_showtimes = showtimes + [other_showtime]

    user_crud.set_cinema_selections(
        session=db_transaction,
        user_id=user.id,
        cinema_ids=list({showtime.cinema_id for showtime in all_showtimes}),
    )

    movie = movie_factory(showtimes=showtimes)

    # Showtime selections
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=user.id, showtime_id=showtimes[1].id
    )
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=friend_1.id, showtime_id=showtimes[1].id
    )
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=friend_2.id, showtime_id=showtimes[0].id
    )
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=user_3.id, showtime_id=showtimes[2].id
    )
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=friend_2.id, showtime_id=other_showtime.id
    )

    friends = movie_crud.get_friends_for_movie(
        session=db_transaction,
        movie_id=movie.id,
        current_user=user.id,
        snapshot_time=now_amsterdam_naive(),
    )

    assert friend_1 in friends
    assert len(friends) == 1


def test_get_showtimes_for_movie_filters_by_selected_statuses(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    friend = user_factory()
    not_friend = user_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=user.id, friend_id=friend.id
    )

    movie = movie_factory()
    showtime_going = showtime_factory(movie=movie)
    showtime_interested = showtime_factory(movie=movie)
    showtime_not_friend = showtime_factory(movie=movie)

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
        showtime_id=showtime_not_friend.id,
        user_id=not_friend.id,
        going_status=GoingStatus.GOING,
    )

    going_filtered = movie_crud.get_showtimes_for_movie(
        session=db_transaction,
        movie_id=movie.id,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_statuses=[GoingStatus.GOING],
        ),
        current_user_id=user.id,
    )

    assert showtime_going in going_filtered
    assert showtime_interested not in going_filtered
    assert showtime_not_friend not in going_filtered

    interested_filtered = movie_crud.get_showtimes_for_movie(
        session=db_transaction,
        movie_id=movie.id,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_statuses=[GoingStatus.GOING, GoingStatus.INTERESTED],
        ),
        current_user_id=user.id,
    )

    assert showtime_going in interested_filtered
    assert showtime_interested in interested_filtered
    assert showtime_not_friend not in interested_filtered


def test_get_movies_filters_by_selected_statuses(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    friend = user_factory()
    stranger = user_factory()

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=user.id,
        friend_id=friend.id,
    )

    movie_going = movie_factory()
    movie_interested = movie_factory()
    movie_stranger_only = movie_factory()

    showtime_going = showtime_factory(movie=movie_going)
    showtime_interested = showtime_factory(movie=movie_interested)
    showtime_stranger_only = showtime_factory(movie=movie_stranger_only)

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
        showtime_id=showtime_stranger_only.id,
        user_id=stranger.id,
        going_status=GoingStatus.GOING,
    )

    going_only = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_statuses=[GoingStatus.GOING],
        ),
    )
    assert {movie.id for movie in going_only} == {movie_going.id}

    going_or_interested = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_statuses=[GoingStatus.GOING, GoingStatus.INTERESTED],
        ),
    )
    assert {movie.id for movie in going_or_interested} == {
        movie_going.id,
        movie_interested.id,
    }


# def test_get_showtimes_for_movie(
#     *,
#     db_transaction: Session,
#     movie_factory: Callable[..., Movie],
#     showtime_factory: Callable[..., Showtime],
#     user_factory: Callable[..., User],
# ):
#     user = user_factory()
#     past = now_amsterdam_naive() - timedelta(minutes=10)
#     future = now_amsterdam_naive() + timedelta(minutes=10)

#     showtimes = [
#         showtime_factory(datetime=past),
#         showtime_factory(datetime=future),
#         showtime_factory(datetime=future),
#     ]

#     movie = movie_factory(showtimes=showtimes)

#     user_crud.set_cinema_selections(
#         session=db_transaction,
#         user_id=user.id,
#         cinema_ids=list({showtime.cinema_id for showtime in showtimes}),
#     )

#     retrieved_showtimes = movie_crud.get_showtimes_for_movie(
#         session=db_transaction,
#         movie_id=movie.id,
#         snapshot_time=now_amsterdam_naive(),
#         current_user_id=user.id,
#     )

#     assert showtimes[1] in retrieved_showtimes
#     assert showtimes[2] in retrieved_showtimes
#     assert len(retrieved_showtimes) == 2

#     retrieved_showtimes_limited = movie_crud.get_showtimes_for_movie(
#         session=db_transaction,
#         movie_id=movie.id,
#         limit=1,
#         snapshot_time=now_amsterdam_naive(),
#         current_user_id=user.id,
#     )
#     assert len(retrieved_showtimes_limited) == 1


# def test_get_last_showtime_datetime(
#     *,
#     db_transaction: Session,
#     movie_factory: Callable[..., Movie],
#     showtime_factory: Callable[..., Showtime],
#     user_factory: Callable[..., User],
# ):
#     user = user_factory()
#     past = now_amsterdam_naive() - timedelta(minutes=10)
#     future = now_amsterdam_naive() + timedelta(minutes=10)
#     far_future = now_amsterdam_naive() + timedelta(days=10)
#     very_far_future = now_amsterdam_naive() + timedelta(days=100)

#     showtimes_1 = [
#         showtime_factory(datetime=past),
#         showtime_factory(datetime=far_future),
#     ]

#     showtimes_2 = [
#         showtime_factory(datetime=very_far_future),
#         showtime_factory(datetime=future),
#     ]

#     showtimes = showtimes_1 + showtimes_2

#     movie = movie_factory(showtimes=showtimes_1)
#     other_movie = movie_factory(showtimes=showtimes_2)

#     user_crud.set_cinema_selections(
#         session=db_transaction,
#         user_id=user.id,
#         cinema_ids=list({showtime.cinema_id for showtime in showtimes}),
#     )

#     last_showtime_datetime = movie_crud.get_last_showtime_datetime(
#         session=db_transaction,
#         movie_id=movie.id,
#         current_user_id=user.id,
#     )

#     assert last_showtime_datetime == far_future

#     last_showtime_datetime_other = movie_crud.get_last_showtime_datetime(
#         session=db_transaction,
#         movie_id=other_movie.id,
#         current_user_id=user.id,
#     )

#     assert last_showtime_datetime_other == very_far_future


# def test_get_last_showtime_datetime_no_showtimes(
#     *,
#     db_transaction: Session,
#     movie_factory: Callable[..., Movie],
#     user_factory: Callable[..., User],
# ):
#     user = user_factory()
#     movie = movie_factory()

#     last_showtime_datetime = movie_crud.get_last_showtime_datetime(
#         session=db_transaction,
#         movie_id=movie.id,
#         current_user_id=user.id,
#     )

#     assert last_showtime_datetime is None


# def test_get_total_number_of_future_showtimes(
#     *,
#     db_transaction: Session,
#     movie_factory: Callable[..., Movie],
#     showtime_factory: Callable[..., Showtime],
#     user_factory: Callable[..., User],
# ):
#     user = user_factory()
#     past = now_amsterdam_naive() - timedelta(minutes=10)
#     future = now_amsterdam_naive() + timedelta(minutes=10)

#     showtimes = [
#         showtime_factory(datetime=past),
#         showtime_factory(datetime=future),
#         showtime_factory(datetime=future),
#     ]

#     movie = movie_factory(showtimes=showtimes)

#     user_crud.set_cinema_selections(
#         session=db_transaction,
#         user_id=user.id,
#         cinema_ids=list({showtime.cinema_id for showtime in showtimes}),
#     )

#     total_showtimes = movie_crud.get_total_number_of_future_showtimes(
#         session=db_transaction,
#         movie_id=movie.id,
#         snapshot_time=now_amsterdam_naive(),
#         current_user_id=user.id,
#     )

#     assert total_showtimes == 2

#     total_showtimes_past = movie_crud.get_total_number_of_future_showtimes(
#         session=db_transaction,
#         movie_id=movie.id,
#         snapshot_time=past,
#         current_user_id=user.id,
#     )

#     assert total_showtimes_past == 3


# def test_get_movies(
#     *,
#     db_transaction: Session,
#     movie_factory: Callable[..., Movie],
#     showtime_factory: Callable[..., Showtime],
#     user_factory: Callable[..., User],
# ):
#     past = now_amsterdam_naive() - timedelta(minutes=10)
#     tomorrow = now_amsterdam_naive() + timedelta(days=1)
#     far_future = now_amsterdam_naive() + timedelta(days=10)

#     showtimes_1 = [showtime_factory(datetime=past)]
#     showtimes_2 = [showtime_factory(datetime=far_future)]
#     showtimes_3 = []
#     showtimes_4 = [showtime_factory(datetime=tomorrow)]
#     showtimes = showtimes_1 + showtimes_2 + showtimes_3 + showtimes_4

#     # Create movies with different showtimes
#     movie_factory(
#         title="Gone Girl", showtimes=showtimes_1
#     )
#     movie_2 = movie_factory(
#         title="A girl Walks Home Alone At Night",
#         showtimes=showtimes_2
#     )
#     movie_factory(
#         title="Girly Pop",
#         showtimes=showtimes_3
#     )
#     movie_4 = movie_factory(
#         title="Forrest Gump", showtimes=showtimes_4
#     )
#     user = user_factory()

#     user_crud.set_cinema_selections(
#         session=db_transaction,
#         user_id=user.id,
#         cinema_ids=list({showtime.cinema_id for showtime in showtimes}),
#     )

#     # Retrieve all movies
#     movies = movie_crud.get_movies(
#         session=db_transaction,
#         letterboxd_username=user.letterboxd_username,
#         limit=10,
#         offset=0,
#         snapshot_time=now_amsterdam_naive(),
#         query="",
#         watchlist_only=False,
#         current_user_id=user.id,
#     )

#     assert movie_2 in movies
#     assert movie_4 in movies
#     assert len(movies) == 2  # Only movies with future showtimes should be returned
#     assert movies[1] == movie_2  # Ensure the order is correct

#     movies_with_query = movie_crud.get_movies(
#         session=db_transaction,
#         letterboxd_username=user.letterboxd_username,
#         limit=10,
#         offset=0,
#         snapshot_time=now_amsterdam_naive(),
#         query="girl",
#         watchlist_only=False,
#         current_user_id=user.id,
#     )

#     assert movie_2 in movies_with_query
#     assert len(movies_with_query) == 1
