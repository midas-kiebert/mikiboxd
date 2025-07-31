from pytest_mock import MockerFixture

from app.converters import user as user_converters
from app.schemas.user import UserWithFriendStatus, UserWithShowtimesPublic


def test_to_with_friend_status(
    *,
    mocker: MockerFixture,
    user_factory,
):
    user = user_factory.build()

    mocker.patch(
        "app.crud.friendship.are_users_friends",
        return_value=True,
    )
    mocker.patch(
        "app.crud.friendship.has_sent_friend_request",
        return_value=True,
    )

    user_with_friend_status = user_converters.to_with_friend_status(
        user=user,
        session=mocker.MagicMock(),
        current_user=user.id,
    )

    assert isinstance(user_with_friend_status, UserWithFriendStatus)


def test_to_with_showtimes_public(
    *,
    mocker: MockerFixture,
    user_factory,
    showtime_logged_in_factory,
):
    user = user_factory.build()

    showtime_logged_in = showtime_logged_in_factory()

    mocker.patch(
        "app.converters.showtime.to_logged_in",
        return_value=showtime_logged_in,
    )

    user_with_showtimes = user_converters.to_with_showtimes_public(
        user=user,
        session=mocker.MagicMock(),
    )

    assert isinstance(user_with_showtimes, UserWithShowtimesPublic)
