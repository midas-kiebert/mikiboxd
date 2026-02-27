
from psycopg.errors import UniqueViolation
from pytest_mock import MockerFixture
from sqlalchemy.exc import IntegrityError

from app.services import showtimes as showtime_services

# def test_get_showtime_by_id_success(
#     mocker: MockerFixture,
# ):
#     mock_crud = mocker.patch("app.crud.showtime.get_showtime_by_id")
#     mock_converter = mocker.patch("app.converters.showtime.to_logged_in")
#     mock_session = mocker.MagicMock()

#     current_user = uuid4()
#     showtime_id = randint(1, 1000)

#     showtime_services.get_showtime_by_id(
#         session=mock_session,
#         showtime_id=showtime_id,
#         current_user=current_user,
#     )

#     mock_crud.assert_called_once_with(
#         session=mock_session,
#         showtime_id=showtime_id,
#     )
#     mock_converter.assert_called_once_with(
#         showtime=mock_crud.return_value,
#         session=mock_session,
#         user_id=current_user,
#     )


# def test_get_showtime_by_id_not_found(
#     mocker: MockerFixture,
# ):
#     mock_crud = mocker.patch("app.crud.showtime.get_showtime_by_id")
#     mock_crud.return_value = None
#     mock_session = mocker.MagicMock()

#     current_user = uuid4()
#     showtime_id = randint(1, 1000)

#     with pytest.raises(ShowtimeNotFoundError) as exc_info:
#         showtime_services.get_showtime_by_id(
#             session=mock_session,
#             showtime_id=showtime_id,
#             current_user=current_user,
#         )

#     assert str(exc_info.value) == f"Showtime with ID {showtime_id} not found."


# def test_select_showtime_success(
#     mocker: MockerFixture,
# ):
#     mock_crud = mocker.patch("app.crud.user.add_showtime_selection")
#     mock_converter = mocker.patch("app.converters.showtime.to_logged_in")
#     mock_session = mocker.MagicMock()

#     showtime_id = randint(1, 1000)
#     user_id = uuid4()

#     showtime_services.select_showtime(
#         session=mock_session,
#         showtime_id=showtime_id,
#         user_id=user_id,
#     )

#     mock_crud.assert_called_once_with(
#         session=mock_session,
#         showtime_id=showtime_id,
#         user_id=user_id,
#     )
#     mock_converter.assert_called_once_with(
#         showtime=mock_crud.return_value,
#         session=mock_session,
#         user_id=user_id,
#     )


# def test_select_showtime_already_selected(
#     mocker: MockerFixture,
# ):
#     mock_crud = mocker.patch("app.crud.user.add_showtime_selection")
#     mock_crud.side_effect = IntegrityError(
#         statement="Integrity error",
#         orig=UniqueViolation("Showtime already selected"),
#         params=None,
#     )
#     mock_session = mocker.MagicMock()

#     showtime_id = randint(1, 1000)
#     user_id = uuid4()

#     with pytest.raises(ShowtimeAlreadySelectedError) as exc_info:
#         showtime_services.select_showtime(
#             session=mock_session,
#             showtime_id=showtime_id,
#             user_id=user_id,
#         )

#     assert (
#         str(exc_info.value)
#         == f"Showtime with ID {showtime_id} is already selected by user with ID {user_id}."
#     )
#     mock_session.rollback.assert_called_once()


# def test_select_showtime_not_found(
#     mocker: MockerFixture,
# ):
#     mock_crud = mocker.patch("app.crud.user.add_showtime_selection")
#     mock_crud.side_effect = IntegrityError(
#         statement="Integrity error",
#         orig=ForeignKeyViolation("Showtime or user not found"),
#         params=None,
#     )
#     mock_session = mocker.MagicMock()

#     showtime_id = randint(1, 1000)
#     user_id = uuid4()

#     with pytest.raises(ShowtimeOrUserNotFoundError) as exc_info:
#         showtime_services.select_showtime(
#             session=mock_session,
#             showtime_id=showtime_id,
#             user_id=user_id,
#         )

#     assert (
#         str(exc_info.value)
#         == f"Showtime with ID {showtime_id} or user with ID {user_id} not found."
#     )
#     mock_session.rollback.assert_called_once()


# def test_delete_showtime_success(
#     mocker: MockerFixture,
# ):
#     mock_crud = mocker.patch("app.crud.user.delete_showtime_selection")
#     mock_converter = mocker.patch("app.converters.showtime.to_logged_in")
#     mock_session = mocker.MagicMock()

#     showtime_id = randint(1, 1000)
#     user_id = uuid4()

#     showtime_services.delete_showtime_selection(
#         session=mock_session,
#         showtime_id=showtime_id,
#         user_id=user_id,
#     )

#     mock_crud.assert_called_once_with(
#         session=mock_session,
#         showtime_id=showtime_id,
#         user_id=user_id,
#     )
#     mock_session.commit.assert_called_once()
#     mock_converter.assert_called_once_with(
#         showtime=mock_crud.return_value,
#         session=mock_session,
#         user_id=user_id,
#     )


# def test_delete_showtime_not_found(
#     mocker: MockerFixture,
# ):
#     mock_crud = mocker.patch("app.crud.user.delete_showtime_selection")
#     mock_crud.side_effect = NoResultFound("Showtime selection not found")
#     mock_session = mocker.MagicMock()

#     showtime_id = randint(1, 1000)
#     user_id = uuid4()

#     with pytest.raises(ShowtimeSelectionNotFoundError) as exc_info:
#         showtime_services.delete_showtime_selection(
#             session=mock_session,
#             showtime_id=showtime_id,
#             user_id=user_id,
#         )

#     assert (
#         str(exc_info.value)
#         == f"Showtime selection with ID {showtime_id} for user with ID {user_id} not found."
#     )
#     mock_session.rollback.assert_called_once()


# def test_toggle_showtime_selection_select_success(
#     mocker: MockerFixture,
# ):
#     mock_is_going = mocker.patch("app.crud.user.has_user_selected_showtime")
#     mock_is_going.return_value = False
#     mock_select = mocker.patch("app.services.showtimes.select_showtime")
#     mock_deselect = mocker.patch("app.services.showtimes.delete_showtime_selection")
#     mock_session = mocker.MagicMock()

#     showtime_id = randint(1, 1000)
#     user_id = uuid4()

#     showtime_services.toggle_showtime_selection(
#         session=mock_session,
#         showtime_id=showtime_id,
#         user_id=user_id,
#     )

#     mock_is_going.assert_called_once_with(
#         session=mock_session,
#         showtime_id=showtime_id,
#         user_id=user_id,
#     )

#     mock_select.assert_called_once_with(
#         session=mock_session,
#         showtime_id=showtime_id,
#         user_id=user_id,
#     )

#     mock_deselect.assert_not_called()


# def test_toggle_showtime_selection_deselect_success(
#     mocker: MockerFixture,
# ):
#     mock_is_going = mocker.patch("app.crud.user.has_user_selected_showtime")
#     mock_is_going.return_value = True
#     mock_select = mocker.patch("app.services.showtimes.select_showtime")
#     mock_deselect = mocker.patch("app.services.showtimes.delete_showtime_selection")
#     mock_session = mocker.MagicMock()

#     showtime_id = randint(1, 1000)
#     user_id = uuid4()

#     showtime_services.toggle_showtime_selection(
#         session=mock_session,
#         showtime_id=showtime_id,
#         user_id=user_id,
#     )

#     mock_is_going.assert_called_once_with(
#         session=mock_session,
#         showtime_id=showtime_id,
#         user_id=user_id,
#     )

#     mock_deselect.assert_called_once_with(
#         session=mock_session,
#         showtime_id=showtime_id,
#         user_id=user_id,
#     )

#     mock_select.assert_not_called()


def test_insert_showtime_if_not_exists(
    mocker: MockerFixture,
):
    mock_close_in_time = mocker.patch("app.crud.showtime.get_showtime_close_in_time")
    mock_close_in_time.return_value = None
    mocker.patch("app.crud.movie.get_movie_by_id", return_value=None)
    mock_crud = mocker.patch("app.crud.showtime.create_showtime")
    mock_session = mocker.MagicMock()
    showtime_create = mocker.MagicMock()

    inserted = showtime_services.insert_showtime_if_not_exists(
        session=mock_session,
        showtime_create=showtime_create,
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        showtime_create=showtime_create,
    )

    assert inserted is True

def test_insert_showtime_if_not_exists_already_exists(
    mocker: MockerFixture,
):
    mock_close_in_time = mocker.patch("app.crud.showtime.get_showtime_close_in_time")
    mock_close_in_time.return_value = None
    mocker.patch("app.crud.movie.get_movie_by_id", return_value=None)
    mock_crud = mocker.patch("app.crud.showtime.create_showtime")
    mock_crud.side_effect = IntegrityError(
        statement="Integrity error",
        orig=UniqueViolation("Showtime already exists"),
        params=None,
    )
    mock_session = mocker.MagicMock()
    showtime_create = mocker.MagicMock()

    inserted = showtime_services.insert_showtime_if_not_exists(
        session=mock_session,
        showtime_create=showtime_create,
    )

    mock_crud.assert_called_once_with(
        session=mock_session,
        showtime_create=showtime_create,
    )

    assert inserted is False
