"""Keeping already-installed app builds working across API changes.

Two mechanisms, and the order between them matters. The flat legacy mirrors
(`app.schemas.legacy_viewer_compat`) let an old build keep reading a response
whose shape has moved, which costs nothing and needs no store coordination.
The version gate (`app.core.middleware`) is the fallback for changes that
genuinely cannot be served to an old build, and it is per-platform because
App Store and Play review times are weeks apart — the two floors are never
raised at the same moment.
"""

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import GoingStatus
from app.crud import showtime as showtime_crud
from app.models.user import User
from app.schemas.legacy_viewer_compat import LEGACY_VIEWER_FIELD
from app.schemas.showtime import ShowtimePublic

_HEALTH_CHECK = f"{settings.API_V1_STR}/utils/health-check/"


@pytest.fixture
def restore_version_gate() -> Iterator[None]:
    """The gate is process-wide settings state, so put it back afterwards."""
    original = (
        settings.MIN_SUPPORTED_CLIENT_VERSION_IOS,
        settings.MIN_SUPPORTED_CLIENT_VERSION_ANDROID,
    )
    yield
    (
        settings.MIN_SUPPORTED_CLIENT_VERSION_IOS,
        settings.MIN_SUPPORTED_CLIENT_VERSION_ANDROID,
    ) = original


def test_legacy_flat_fields_mirror_the_viewer_block(
    client: TestClient,
    db_transaction: Session,
    normal_user_token_headers: dict[str, str],
    showtime_factory,
) -> None:
    """A build that predates `viewer` reads the same answer off the top level.

    This is what lets the viewer split ship without waiting on either store:
    old builds read the mirrors, new builds read `viewer`, and neither can
    disagree with the other because one is derived from the other.
    """
    showtime = showtime_factory()
    user_id = db_transaction.exec(
        select(User.id).where(User.email == settings.EMAIL_TEST_USER)
    ).one()
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=user_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    body = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime.id}",
        headers=normal_user_token_headers,
    ).json()

    viewer = body["viewer"]
    assert viewer is not None
    assert viewer["going"] == GoingStatus.GOING

    # Driven by the mirrors rather than by `viewer`'s keys: the viewer block
    # goes on growing, and a field added to it after the split has no old
    # build reading it at the top level and so is deliberately not mirrored.
    # What must hold is the other direction — a mirror that exists can never
    # disagree with the block it is derived from.
    mirrored = [
        name
        for name, field in ShowtimePublic.model_computed_fields.items()
        if field.deprecated == LEGACY_VIEWER_FIELD
    ]
    assert mirrored, "the legacy shim is gone; delete this test with it"
    for field_name in mirrored:
        assert field_name in viewer, field_name
        assert body[field_name] == viewer[field_name], field_name


def test_version_gate_floors_are_independent_per_platform(
    client: TestClient,
    restore_version_gate: None,  # noqa: ARG001 - fixture used for teardown side effect
) -> None:
    """Raising Android's floor must not strand iOS behind App Store review.

    The reverse case is the one that actually bites: iOS review can take weeks,
    so its floor stays put long after Android's has moved.
    """
    settings.MIN_SUPPORTED_CLIENT_VERSION_ANDROID = "1.1.0"
    settings.MIN_SUPPORTED_CLIENT_VERSION_IOS = None

    stale_android = client.get(
        _HEALTH_CHECK,
        headers={"X-Client-Platform": "android", "X-Client-Version": "1.0.3"},
    )
    current_android = client.get(
        _HEALTH_CHECK,
        headers={"X-Client-Platform": "android", "X-Client-Version": "1.1.0"},
    )
    same_version_on_ios = client.get(
        _HEALTH_CHECK,
        headers={"X-Client-Platform": "ios", "X-Client-Version": "1.0.3"},
    )

    assert stale_android.status_code == 426
    assert stale_android.json()["min_supported_version"] == "1.1.0"
    assert current_android.status_code == 200
    assert same_version_on_ios.status_code == 200


def test_version_gate_ignores_the_web_frontend(
    client: TestClient,
    restore_version_gate: None,  # noqa: ARG001 - fixture used for teardown side effect
) -> None:
    """Web ships on deploy, so it is never stale and never gated."""
    settings.MIN_SUPPORTED_CLIENT_VERSION_IOS = "9.0.0"
    settings.MIN_SUPPORTED_CLIENT_VERSION_ANDROID = "9.0.0"

    response = client.get(
        _HEALTH_CHECK,
        headers={"X-Client-Platform": "web", "X-Client-Version": "1.0.0"},
    )

    assert response.status_code == 200
