# from datetime import datetime

# from pytest_mock import MockerFixture

# from app.converters import movie as movie_converters
# from app.schemas.movie import MovieLoggedIn, MovieSummaryLoggedIn


# def test_to_summary_logged_in(
#     *,
#     mocker: MockerFixture,
#     movie_factory,
#     showtime_in_movie_logged_in_factory,
#     cinema_public_factory,
#     user_public_factory,
# ):
#     movie = movie_factory.build()
#     showtime_in_movie = showtime_in_movie_logged_in_factory.build()
#     cinema_public = cinema_public_factory.build()
#     user_public = user_public_factory.build()

#     mocker.patch(
#         "app.converters.showtime.to_in_movie_logged_in",
#         return_value=[showtime_in_movie],
#     )
#     mocker.patch(
#         "app.converters.cinema.to_public",
#         return_value=[cinema_public],
#     )
#     mocker.patch(
#         "app.crud.movie.get_last_showtime_datetime",
#         return_value=datetime(2023, 10, 1, 12, 0, 0),
#     )
#     mocker.patch(
#         "app.crud.movie.get_total_number_of_future_showtimes",
#         return_value=5,
#     )
#     mocker.patch(
#         "app.converters.user.to_public",
#         return_value=[user_public],
#     )

#     result = movie_converters.to_summary_logged_in(
#         movie=movie,
#         session=mocker.MagicMock(),
#         snapshot_time=mocker.MagicMock(),
#         current_user=mocker.MagicMock(),
#     )

#     assert isinstance(result, MovieSummaryLoggedIn)


# def test_to_logged_in(
#     *, mocker: MockerFixture, movie_factory, showtime_in_movie_logged_in_factory
# ):
#     movie = movie_factory.build()
#     showtime_in_movie = showtime_in_movie_logged_in_factory.build()

#     mocker.patch(
#         "app.converters.showtime.to_in_movie_logged_in",
#         return_value=[showtime_in_movie],
#     )

#     result = movie_converters.to_logged_in(
#         movie=movie,
#         session=mocker.MagicMock(),
#         snapshot_time=mocker.MagicMock(),
#         current_user=mocker.MagicMock(),
#     )

#     assert isinstance(result, MovieLoggedIn)
