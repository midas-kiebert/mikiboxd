# from pytest_mock import MockerFixture

# from app.converters import showtime as showtime_converters
# from app.schemas.showtime import ShowtimeInMovieLoggedIn, ShowtimeLoggedIn


# def test_to_logged_in(
#     *,
#     mocker: MockerFixture,
#     showtime_factory,
#     user_public_factory,
# ):
#     showtime = showtime_factory.build()
#     user_public = user_public_factory

#     mocker.patch("app.converters.user.to_public", return_value=user_public)

#     showtime_logged_in = showtime_converters.to_logged_in(
#         showtime=showtime,
#         session=mocker.MagicMock(),
#         user_id=mocker.MagicMock(),
#     )
#     assert isinstance(showtime_logged_in, ShowtimeLoggedIn)


# def test_to_in_movie_logged_in(
#     *,
#     mocker: MockerFixture,
#     showtime_factory,
#     user_public_factory,
# ):
#     showtime = showtime_factory.build()
#     user_public = user_public_factory.build()

#     mocker.patch("app.converters.user.to_public", return_value=user_public)

#     showtime_in_movie_logged_in = showtime_converters.to_in_movie_logged_in(
#         showtime=showtime,
#         session=mocker.MagicMock(),
#         user_id=mocker.MagicMock(),
#     )
#     assert isinstance(showtime_in_movie_logged_in, ShowtimeInMovieLoggedIn)
