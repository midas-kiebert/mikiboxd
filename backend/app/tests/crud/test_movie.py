from sqlmodel import Session

from app import crud
from app.models import Cinema, City, Movie, User


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
