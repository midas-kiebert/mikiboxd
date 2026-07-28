from collections.abc import Callable
from datetime import datetime, timedelta

from sqlmodel import Session

from app.converters import user as user_converters
from app.crud import watched as watched_crud
from app.crud import watchlist as watchlist_crud
from app.models.user import User
from app.utils import now_amsterdam_naive

# from pytest_mock import MockerFixture

# from app.converters import user as user_converters
# from app.schemas.user import UserWithFriendStatus, UserWithShowtimesPublic


def test_to_me_exposes_letterboxd_sync_timestamps(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user = user_factory()
    assert user.letterboxd is not None
    synced_at = datetime(2026, 6, 1, 12, 0)
    user.letterboxd.last_watchlist_sync = synced_at
    user.letterboxd.last_watched_sync = None

    me = user_converters.to_me(user, session=db_transaction)

    assert me.watchlist_last_synced == synced_at
    assert me.watched_last_synced is None


def test_to_me_watchlist_and_watched_counts_zero_without_letterboxd_username(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user = user_factory(letterboxd=None, letterboxd_username=None)
    assert user.letterboxd_username is None

    me = user_converters.to_me(user, session=db_transaction)

    assert me.watchlist_count == 0
    assert me.watched_count == 0


def test_to_me_watchlist_and_watched_counts_reflect_selections(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user = user_factory()
    assert user.letterboxd_username is not None

    watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug="heat",
    )
    watchlist_crud.add_watchlist_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug="the-conversation",
    )
    watched_crud.add_watched_selection(
        session=db_transaction,
        letterboxd_username=user.letterboxd_username,
        letterboxd_slug="heat",
    )

    me = user_converters.to_me(user, session=db_transaction)

    assert me.watchlist_count == 2
    assert me.watched_count == 1


def test_to_me_sync_failed_is_false_when_no_attempt_yet(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user = user_factory()
    assert user.letterboxd is not None
    user.letterboxd.last_watchlist_sync = None
    user.letterboxd.last_watchlist_sync_attempt = None

    me = user_converters.to_me(user, session=db_transaction)

    assert me.watchlist_sync_failed is False


def test_to_me_sync_failed_is_true_when_attempt_never_succeeded(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user = user_factory()
    assert user.letterboxd is not None
    user.letterboxd.last_watchlist_sync = None
    user.letterboxd.last_watchlist_sync_attempt = now_amsterdam_naive()

    me = user_converters.to_me(user, session=db_transaction)

    assert me.watchlist_sync_failed is True


def test_to_me_sync_failed_is_true_when_last_attempt_after_last_success(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user = user_factory()
    assert user.letterboxd is not None
    now = now_amsterdam_naive()
    user.letterboxd.last_watched_sync = now - timedelta(minutes=10)
    user.letterboxd.last_watched_sync_attempt = now

    me = user_converters.to_me(user, session=db_transaction)

    assert me.watched_sync_failed is True


def test_to_me_sync_failed_is_false_when_last_success_after_or_equal_attempt(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user = user_factory()
    assert user.letterboxd is not None
    now = now_amsterdam_naive()
    user.letterboxd.last_watched_sync = now
    user.letterboxd.last_watched_sync_attempt = now

    me = user_converters.to_me(user, session=db_transaction)

    assert me.watched_sync_failed is False


def test_to_me_sync_cooldown_ends_at_set_when_recent_attempt(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user = user_factory()
    assert user.letterboxd is not None
    now = now_amsterdam_naive()
    user.letterboxd.last_watchlist_sync = None
    user.letterboxd.last_watchlist_sync_attempt = now - timedelta(minutes=2)

    me = user_converters.to_me(user, session=db_transaction)

    assert me.watchlist_sync_cooldown_ends_at is not None
    remaining = me.watchlist_sync_cooldown_ends_at - now
    assert timedelta(minutes=7) < remaining < timedelta(minutes=9)


def test_to_me_sync_cooldown_ends_at_none_when_outside_cooldown(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user = user_factory()
    assert user.letterboxd is not None
    now = now_amsterdam_naive()
    user.letterboxd.last_watchlist_sync = None
    user.letterboxd.last_watchlist_sync_attempt = now - timedelta(minutes=20)

    me = user_converters.to_me(user, session=db_transaction)

    assert me.watchlist_sync_cooldown_ends_at is None


def test_to_me_can_report_is_true_when_not_banned(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user = user_factory(report_banned=False, report_ban_expires_at=None)

    me = user_converters.to_me(user, session=db_transaction)

    assert me.can_report is True


def test_to_me_can_report_is_false_when_banned_indefinitely(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user = user_factory(report_banned=True, report_ban_expires_at=None)

    me = user_converters.to_me(user, session=db_transaction)

    assert me.can_report is False


def test_to_me_can_report_is_true_after_ban_expires(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user = user_factory(
        report_banned=True,
        report_ban_expires_at=now_amsterdam_naive() - timedelta(days=1),
    )

    me = user_converters.to_me(user, session=db_transaction)

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
