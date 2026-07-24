from collections.abc import Callable
from datetime import datetime, timedelta

from app.converters import user as user_converters
from app.models.user import User
from app.utils import now_amsterdam_naive

# from pytest_mock import MockerFixture

# from app.converters import user as user_converters
# from app.schemas.user import UserWithFriendStatus, UserWithShowtimesPublic


def test_to_me_exposes_letterboxd_sync_timestamps(
    *,
    user_factory: Callable[..., User],
):
    user = user_factory()
    assert user.letterboxd is not None
    synced_at = datetime(2026, 6, 1, 12, 0)
    user.letterboxd.last_watchlist_sync = synced_at
    user.letterboxd.last_watched_sync = None

    me = user_converters.to_me(user)

    assert me.watchlist_last_synced == synced_at
    assert me.watched_last_synced is None


def test_to_me_can_report_is_true_when_not_banned(
    *,
    user_factory: Callable[..., User],
):
    user = user_factory(report_banned=False, report_ban_expires_at=None)

    me = user_converters.to_me(user)

    assert me.can_report is True


def test_to_me_can_report_is_false_when_banned_indefinitely(
    *,
    user_factory: Callable[..., User],
):
    user = user_factory(report_banned=True, report_ban_expires_at=None)

    me = user_converters.to_me(user)

    assert me.can_report is False


def test_to_me_can_report_is_true_after_ban_expires(
    *,
    user_factory: Callable[..., User],
):
    user = user_factory(
        report_banned=True,
        report_ban_expires_at=now_amsterdam_naive() - timedelta(days=1),
    )

    me = user_converters.to_me(user)

    assert me.can_report is True


# def test_to_with_friend_status(
#     *,
#     mocker: MockerFixture,
#     user_factory,
# ):
#     user = user_factory.build()

#     mocker.patch(
#         "app.crud.friendship.are_users_friends",
#         return_value=True,
#     )
#     mocker.patch(
#         "app.crud.friendship.has_sent_friend_request",
#         return_value=True,
#     )

#     user_with_friend_status = user_converters.to_with_friend_status(
#         user=user,
#         session=mocker.MagicMock(),
#         current_user=user.id,
#     )

#     assert isinstance(user_with_friend_status, UserWithFriendStatus)


# def test_to_with_showtimes_public(
#     *,
#     mocker: MockerFixture,
#     user_factory,
#     showtime_logged_in_factory,
# ):
#     user = user_factory.build()

#     showtime_logged_in = showtime_logged_in_factory()

#     mocker.patch(
#         "app.converters.showtime.to_logged_in",
#         return_value=showtime_logged_in,
#     )

#     limit=20
#     offset=0

#     user_with_showtimes = user_converters.to_with_showtimes_public(
#         user=user,
#         session=mocker.MagicMock(),
#         limit=limit,
#         offset=offset,
#     )

#     assert isinstance(user_with_showtimes, UserWithShowtimesPublic)
