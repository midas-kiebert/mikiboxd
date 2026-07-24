from collections.abc import Callable
from datetime import timedelta

from app.models.user import User, is_report_banned
from app.utils import now_amsterdam_naive


def test_is_report_banned_false_when_not_banned(
    *, user_factory: Callable[..., User]
):
    user = user_factory(report_banned=False, report_ban_expires_at=None)

    assert is_report_banned(user) is False


def test_is_report_banned_true_indefinitely_when_no_expiry_set(
    *, user_factory: Callable[..., User]
):
    user = user_factory(report_banned=True, report_ban_expires_at=None)

    assert is_report_banned(user) is True


def test_is_report_banned_true_when_expiry_is_in_the_future(
    *, user_factory: Callable[..., User]
):
    user = user_factory(
        report_banned=True,
        report_ban_expires_at=now_amsterdam_naive() + timedelta(days=1),
    )

    assert is_report_banned(user) is True


def test_is_report_banned_false_when_expiry_has_passed(
    *, user_factory: Callable[..., User]
):
    """A past `report_ban_expires_at` counts as no-longer-banned, even though
    `report_banned` itself is still True (it isn't cleared automatically)."""
    user = user_factory(
        report_banned=True,
        report_ban_expires_at=now_amsterdam_naive() - timedelta(days=1),
    )

    assert is_report_banned(user) is False
