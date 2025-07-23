from sqlmodel import Session

from app import crud
from app.models import Cinema, City, Movie, Showtime, User, UserPublic


def test_get_movie_search_watchlist_only(
    *,
    db_transaction: Session,
    user_factory,
    movie_factory,
    showtime_factory,
    city_factory,
    cinema_factory,
):
    city: City = city_factory()
    cinema: Cinema = cinema_factory(city_id=city.id)

    user: User = user_factory()
    movie_1: Movie = movie_factory(title="Test Movie")
    movie_2: Movie = movie_factory(title="Another Movie")
    movie_3: Movie = movie_factory(title="Test Movie 3")
    movie_4: Movie = movie_factory(title="Seven Samurai")

    # Add movie_1 and movie_2 to the user's watchlist
    crud.add_watchlist_selection(
        session=db_transaction,
        user_id=user.id,
        movie_id=movie_1.id,
    )
    crud.add_watchlist_selection(
        session=db_transaction,
        user_id=user.id,
        movie_id=movie_2.id,
    )

    # add showtimes
    showtime_factory(
        movie_id=movie_1.id,
        cinema_id=cinema.id,
    )
    showtime_factory(
        movie_id=movie_2.id,
        cinema_id=cinema.id,
    )
    showtime_factory(
        movie_id=movie_3.id,
        cinema_id=cinema.id,
    )
    showtime_factory(
        movie_id=movie_4.id,
        cinema_id=cinema.id,
    )

    # Perform the search
    result_1 = crud.get_movies(
        session=db_transaction,
        user_id=user.id,
        query="Test Movie",
    )

    result_2 = crud.get_movies(
        session=db_transaction,
        user_id=user.id,
        query="Test Movie",
        watchlist_only=True,
    )

    result_3 = crud.get_movies(
        session=db_transaction,
        user_id=user.id,
        watchlist_only=True,
    )

    result_4 = crud.get_movies(
        session=db_transaction,
        user_id=user.id,
        query="Seven Samurai",
        watchlist_only=True,
    )

    assert (
        len(result_1) == 2
    ), "Expected two movies in the result when query is 'Test Movie'"
    assert (
        len(result_2) == 1
    ), "Expected one movie in the result when watchlist_only is True and query is 'Test Movie'"
    assert (
        len(result_3) == 2
    ), "Expected two movies in the result when watchlist_only is True without query"
    assert (
        len(result_4) == 0
    ), "Expected no movies in the result when watchlist_only is True and query is 'Seven Samurai'"


def test_get_cinemas_for_movie(
    *,
    db_transaction: Session,
    movie_factory,
    cinema_factory,
    city_factory,
    showtime_factory,
):
    city: City = city_factory()
    cinema: Cinema = cinema_factory(city_id=city.id)
    cinema_2: Cinema = cinema_factory(city_id=city.id)
    movie: Movie = movie_factory()

    # Add showtimes for the movie
    showtime_factory(
        movie_id=movie.id,
        cinema_id=cinema.id,
    )

    # add past showtime to ensure it is not included
    showtime_factory(
        movie_id=movie.id,
        cinema_id=cinema_2.id,
        dt="2023-01-01T00:00:00Z",  # Past date
    )

    cinemas = crud.get_cinemas_for_movie(
        session=db_transaction,
        movie_id=movie.id,
    )

    assert len(cinemas) == 1, "Expected one cinema for the movie"
    assert (
        cinemas[0].id == cinema.id
    ), "Expected the returned cinema to match the created one"

    # add another showtime to cinema_2
    showtime_factory(
        movie_id=movie.id,
        cinema_id=cinema_2.id,
    )

    cinemas = crud.get_cinemas_for_movie(
        session=db_transaction,
        movie_id=movie.id,
    )

    assert (
        len(cinemas) == 2
    ), "Expected two cinemas for the movie after adding another showtime"


def test_get_friends_for_movie(
    *,
    db_transaction: Session,
    user_factory,
    movie_factory,
    showtime_factory,
    city_factory,
    cinema_factory,
):
    city: City = city_factory()
    cinema_1: Cinema = cinema_factory(city_id=city.id)
    cinema_2: Cinema = cinema_factory(city_id=city.id)
    user_1: User = user_factory()
    user_2: User = user_factory()
    user_3: User = user_factory()
    user_4: User = user_factory()
    movie_1: Movie = movie_factory(title="Test Movie")
    movie_2: Movie = movie_factory(title="Another Movie")
    showtime_1: Showtime = showtime_factory(
        movie_id=movie_1.id,
        dt="2023-10-01T20:00:00Z",
        cinema_id=cinema_1.id,
    )
    assert showtime_1.id is not None
    showtime_2: Showtime = showtime_factory(
        movie_id=movie_1.id,
        cinema_id=cinema_1.id,
    )
    assert showtime_2.id is not None
    showtime_3: Showtime = showtime_factory(
        movie_id=movie_1.id,
        cinema_id=cinema_2.id,
    )
    assert showtime_3.id is not None
    showtime_4: Showtime = showtime_factory(
        movie_id=movie_2.id,
        cinema_id=cinema_1.id,
    )
    assert showtime_4.id is not None

    crud.add_friendship(
        session=db_transaction,
        user_id=user_1.id,
        friend_id=user_2.id,
    )
    crud.add_friendship(
        session=db_transaction,
        user_id=user_1.id,
        friend_id=user_3.id,
    )
    crud.add_showtime_selection(
        session=db_transaction,
        user_id=user_4.id,
        showtime_id=showtime_1.id,
    )
    crud.add_showtime_selection(
        session=db_transaction,
        user_id=user_1.id,
        showtime_id=showtime_2.id,
    )
    crud.add_showtime_selection(
        session=db_transaction,
        user_id=user_2.id,
        showtime_id=showtime_2.id,
    )
    crud.add_showtime_selection(
        session=db_transaction,
        user_id=user_3.id,
        showtime_id=showtime_3.id,
    )
    crud.add_showtime_selection(
        session=db_transaction,
        user_id=user_3.id,
        showtime_id=showtime_4.id,
    )

    friends_1: list[UserPublic] = crud.get_friends_for_movie(
        session=db_transaction,
        movie_id=movie_1.id,
        current_user=user_1.id,
    )
    friend_ids_1 = [friend.id for friend in friends_1]
    assert len(friends_1) == 2
    assert user_2.id in friend_ids_1
    assert user_3.id in friend_ids_1
    crud.add_showtime_selection(
        session=db_transaction,
        user_id=user_3.id,
        showtime_id=showtime_2.id,
    )
    friends_2 = crud.get_friends_for_movie(
        session=db_transaction,
        movie_id=movie_1.id,
        current_user=user_1.id,
    )
    friend_ids_2 = [friend.id for friend in friends_2]
    assert len(friends_2) == 2
    assert user_2.id in friend_ids_2
    assert user_3.id in friend_ids_2
