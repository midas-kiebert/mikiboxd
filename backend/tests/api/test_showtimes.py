import secrets
from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import GoingStatus, VisibilityMode
from app.crud import friendship as friendship_crud
from app.crud import showtime as showtime_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.crud import showtime_ping_link as showtime_ping_link_crud
from app.crud import showtime_visibility as showtime_visibility_crud
from app.crud import user as user_crud
from app.models.showtime_ping import ShowtimePing
from app.models.showtime_visibility import ShowtimeVisibilityEffective
from app.models.user import User
from app.utils import now_amsterdam_naive


def _mint_ping_link_token(session: Session, *, showtime_id: int, sender_id) -> str:
    token = secrets.token_urlsafe(12)
    showtime_ping_link_crud.create_showtime_ping_link(
        session=session, token=token, showtime_id=showtime_id, sender_id=sender_id
    )
    session.commit()
    return token


def _effective_viewer_ids(session: Session, owner_id, showtime_id) -> set:
    return set(
        session.exec(
            select(ShowtimeVisibilityEffective.viewer_id).where(
                ShowtimeVisibilityEffective.owner_id == owner_id,
                ShowtimeVisibilityEffective.showtime_id == showtime_id,
            )
        ).all()
    )


def _normal_user_id(db_transaction: Session):
    return db_transaction.exec(
        select(User.id).where(User.email == settings.EMAIL_TEST_USER)
    ).one()


def test_ping_friend_for_showtime(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
    mocker,
) -> None:
    friend = user_factory()
    showtime = showtime_factory()
    friend_id = friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    db_transaction.commit()

    notify_ping = mocker.patch("app.services.push_notifications.notify_user_on_showtime_ping")

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Friend invited successfully"}
    notify_ping.assert_called_once()


def test_ping_friend_for_showtime_requires_friendship(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    user_factory,
    showtime_factory,
) -> None:
    non_friend = user_factory()
    showtime = showtime_factory()
    non_friend_id = non_friend.id
    showtime_id = showtime.id

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{non_friend_id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "You can only invite your friends."


def test_ping_friend_for_showtime_does_not_notify_when_already_selected(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
    mocker,
) -> None:
    """Pinging an already going/interested friend succeeds, but silently.

    Nobody accepted anything, so it must not fire the "you were invited"
    push — see the `receiver_had_selection_at_creation` flag on the ping.
    """
    friend = user_factory()
    showtime = showtime_factory()
    friend_id = friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=friend_id,
        going_status=GoingStatus.INTERESTED,
    )
    db_transaction.commit()

    notify_ping = mocker.patch("app.services.push_notifications.notify_user_on_showtime_ping")

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Friend invited successfully"}
    notify_ping.assert_not_called()


def test_ping_friend_for_showtime_does_not_notify_when_selection_is_hidden(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
    mocker,
) -> None:
    """Same rule even when the existing selection was invisible to the sender:
    what matters is whether the friend already had one, not whether the
    sender could see it."""
    friend = user_factory()
    showtime = showtime_factory()
    friend_id = friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=friend_id,
        going_status=GoingStatus.INTERESTED,
    )
    # Friend hides this showtime from everyone but invitees, so the current
    # (non-favorite, un-invited) user cannot see the friend's status yet.
    showtime_visibility_crud.set_visibility_mode_for_showtime(
        session=db_transaction,
        owner_id=friend_id,
        showtime_id=showtime_id,
        mode=VisibilityMode.INVITED_ONLY,
        now=now_amsterdam_naive(),
    )
    db_transaction.commit()

    notify_ping = mocker.patch("app.services.push_notifications.notify_user_on_showtime_ping")

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Friend invited successfully"}
    notify_ping.assert_not_called()


def test_ping_friend_for_showtime_rejects_duplicate_ping(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    friend = user_factory()
    showtime = showtime_factory()
    friend_id = friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    db_transaction.commit()

    first_response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )
    assert first_response.status_code == 200

    second_response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )
    assert second_response.status_code == 409
    assert (
        second_response.json()["detail"]
        == "You already invited this friend for this showtime."
    )


def test_ping_friend_for_showtime_marks_sender_interested(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
    mocker,
) -> None:
    """Sending an invite with no prior selection sets the sender to INTERESTED."""
    friend = user_factory()
    showtime = showtime_factory()
    friend_id = friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    db_transaction.commit()

    mocker.patch("app.services.push_notifications.notify_user_on_showtime_ping")

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200

    db_transaction.expire_all()
    sender_status = user_crud.get_showtime_going_status(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
    )
    assert sender_status == GoingStatus.INTERESTED


def test_ping_friend_for_showtime_keeps_sender_interested(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
    mocker,
) -> None:
    """If the sender already selected INTERESTED, sending an invite stays a no-op."""
    friend = user_factory()
    showtime = showtime_factory()
    friend_id = friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.INTERESTED,
    )
    db_transaction.commit()

    mocker.patch("app.services.push_notifications.notify_user_on_showtime_ping")

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200

    db_transaction.expire_all()
    sender_status = user_crud.get_showtime_going_status(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
    )
    assert sender_status == GoingStatus.INTERESTED


def test_ping_friend_for_showtime_does_not_downgrade_going_sender(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
    mocker,
) -> None:
    """If the sender is already GOING, sending an invite must not downgrade them."""
    friend = user_factory()
    showtime = showtime_factory()
    friend_id = friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    mocker.patch("app.services.push_notifications.notify_user_on_showtime_ping")

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200

    db_transaction.expire_all()
    sender_status = user_crud.get_showtime_going_status(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
    )
    assert sender_status == GoingStatus.GOING


def test_get_pinged_friend_ids_for_showtime(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    friend = user_factory()
    showtime = showtime_factory()
    friend_id = friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    db_transaction.commit()

    ping_response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )
    assert ping_response.status_code == 200

    list_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/pinged-friends",
        headers=normal_user_token_headers,
    )
    assert list_response.status_code == 200
    assert list_response.json() == [str(friend_id)]


def test_create_showtime_ping_link_token_round_trip(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    superuser_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
) -> None:
    """The token minted for the sharer is the one the receiver's link redeems."""
    showtime = showtime_factory()
    showtime_id = showtime.id
    sender_id = _normal_user_id(db_transaction)

    mint_response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link-token",
        headers=normal_user_token_headers,
    )
    assert mint_response.status_code == 200
    token = mint_response.json()["token"]

    receive_response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link/{token}",
        headers=superuser_token_headers,
    )
    assert receive_response.status_code == 200
    assert receive_response.json() == {"message": "Invite received successfully"}

    superuser_id = db_transaction.exec(
        select(User.id).where(User.email == settings.FIRST_SUPERUSER)
    ).one()
    stored_ping = db_transaction.exec(
        select(ShowtimePing).where(
            ShowtimePing.showtime_id == showtime_id,
            ShowtimePing.sender_id == sender_id,
            ShowtimePing.receiver_id == superuser_id,
        )
    ).one_or_none()
    assert stored_ping is not None


def test_receive_ping_from_link_rejects_forged_sender(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    """A receiver must not be able to fabricate an invite by putting another
    user's raw ID where the signed token belongs — the whole point of the
    token is that only the real sharer can produce a value that verifies."""
    victim = user_factory(display_name="Never Shared Anything")
    showtime = showtime_factory()
    victim_id = victim.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link/{victim_id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "This invite link is invalid."

    stored_ping = db_transaction.exec(
        select(ShowtimePing).where(
            ShowtimePing.showtime_id == showtime_id,
            ShowtimePing.sender_id == victim_id,
            ShowtimePing.receiver_id == current_user_id,
        )
    ).one_or_none()
    assert stored_ping is None


def test_receive_ping_from_link_rejects_token_for_different_showtime(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    """A token minted for one showtime must not redeem an invite for another —
    otherwise a receiver could replay a legitimately-received token against an
    unrelated showtime the real sender never shared."""
    sender = user_factory(display_name="Cross Showtime Sender")
    minted_for = showtime_factory()
    other_showtime = showtime_factory()
    token = _mint_ping_link_token(
        db_transaction, showtime_id=minted_for.id, sender_id=sender.id
    )

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{other_showtime.id}/ping-link/{token}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "This invite link is invalid."


def test_receive_ping_from_link_marks_sender_interested(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    """Receiving an invite via link also marks the (link) sender as INTERESTED."""
    sender = user_factory(display_name="Link Sender Interested")
    showtime = showtime_factory()
    sender_id = sender.id
    showtime_id = showtime.id
    token = _mint_ping_link_token(db_transaction, showtime_id=showtime_id, sender_id=sender_id)

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link/{token}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200

    db_transaction.expire_all()
    sender_status = user_crud.get_showtime_going_status(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=sender_id,
    )
    assert sender_status == GoingStatus.INTERESTED


def test_receive_ping_from_link_does_not_downgrade_going_sender(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    """If the link sender is already GOING, receiving the ping must not downgrade them."""
    sender = user_factory(display_name="Link Sender Going")
    showtime = showtime_factory()
    sender_id = sender.id
    showtime_id = showtime.id
    token = _mint_ping_link_token(db_transaction, showtime_id=showtime_id, sender_id=sender_id)

    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=sender_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link/{token}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200

    db_transaction.expire_all()
    sender_status = user_crud.get_showtime_going_status(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=sender_id,
    )
    assert sender_status == GoingStatus.GOING


def test_receive_ping_from_link_is_idempotent(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    sender = user_factory(display_name="Idempotent Sender")
    showtime = showtime_factory()
    sender_id = sender.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)
    token = _mint_ping_link_token(db_transaction, showtime_id=showtime_id, sender_id=sender_id)

    first_response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link/{token}",
        headers=normal_user_token_headers,
    )
    assert first_response.status_code == 200

    second_response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link/{token}",
        headers=normal_user_token_headers,
    )
    assert second_response.status_code == 200
    assert second_response.json() == {"message": "Invite received successfully"}

    ping_rows = db_transaction.exec(
        select(ShowtimePing).where(
            ShowtimePing.showtime_id == showtime_id,
            ShowtimePing.sender_id == sender_id,
            ShowtimePing.receiver_id == current_user_id,
        )
    ).all()
    assert len(ping_rows) == 1


def test_receive_ping_from_link_rejects_past_showtime(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    """An invite link outlives its showtime; it must stop working once it starts."""
    sender = user_factory(display_name="Past Link Sender")
    showtime = showtime_factory(datetime=now_amsterdam_naive() - timedelta(hours=1))
    sender_id = sender.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)
    token = _mint_ping_link_token(db_transaction, showtime_id=showtime_id, sender_id=sender_id)

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link/{token}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 410
    assert response.json()["detail"] == "This showtime has already passed."

    stored_ping = db_transaction.exec(
        select(ShowtimePing).where(
            ShowtimePing.showtime_id == showtime_id,
            ShowtimePing.sender_id == sender_id,
            ShowtimePing.receiver_id == current_user_id,
        )
    ).one_or_none()
    assert stored_ping is None


def test_ping_friend_for_showtime_rejects_past_showtime(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    friend = user_factory()
    showtime = showtime_factory(datetime=now_amsterdam_naive() - timedelta(minutes=5))
    friend_id = friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    db_transaction.commit()

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 410
    assert response.json()["detail"] == "This showtime has already passed."


def test_receive_ping_from_link_rejects_garbage_token(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    showtime_factory,
) -> None:
    showtime = showtime_factory()
    showtime_id = showtime.id
    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link/not-a-real-token",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "This invite link is invalid."


def test_showtime_ping_link_cascades_when_sender_deleted(
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    """A minted link must not outlive the account that minted it — otherwise a
    link could redeem to a sender who no longer exists. The FK's ON DELETE
    CASCADE is what `receive_ping_from_link` relies on to skip a separate
    "sender not found" check."""
    sender = user_factory(display_name="Deleted Sender")
    showtime = showtime_factory()
    token = _mint_ping_link_token(
        db_transaction, showtime_id=showtime.id, sender_id=sender.id
    )

    db_transaction.delete(db_transaction.get(User, sender.id))
    db_transaction.commit()

    link = showtime_ping_link_crud.get_showtime_ping_link(
        session=db_transaction, token=token
    )
    assert link is None


def test_showtime_visibility_get_and_update(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    first_friend = user_factory()
    second_friend = user_factory()
    showtime = showtime_factory()
    first_friend_id = first_friend.id
    second_friend_id = second_friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=first_friend_id,
    )
    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=second_friend_id,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    initial_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
    )
    assert initial_response.status_code == 200
    initial_body = initial_response.json()
    assert initial_body["showtime_id"] == showtime_id
    assert initial_body["movie_id"] == showtime.movie_id
    # Default is ALL_FRIENDS, so both (non-opted-out) friends can see.
    assert initial_body["mode"] == "ALL_FRIENDS"
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == {
        first_friend_id,
        second_friend_id,
    }

    update_response = client.put(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
        json={"mode": "INVITED_ONLY"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["mode"] == "INVITED_ONLY"

    updated_get_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
    )
    assert updated_get_response.status_code == 200
    assert updated_get_response.json()["mode"] == "INVITED_ONLY"
    # INVITED_ONLY with no pings → nobody can see.
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == set()


def test_visibility_can_be_set_before_choosing_a_status(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    friend = user_factory()
    showtime = showtime_factory()
    friend_id = friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    db_transaction.commit()

    # Configure visibility without any selection yet — allowed and persisted.
    update_response = client.put(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
        json={"mode": "INVITED_ONLY"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["mode"] == "INVITED_ONLY"
    # Nothing is materialized until a status is set.
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == set()

    # Marking going now applies the pre-set mode.
    selection_response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "GOING"},
    )
    assert selection_response.status_code == 200
    db_transaction.expire_all()
    assert (
        client.get(
            f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
            headers=normal_user_token_headers,
        ).json()["mode"]
        == "INVITED_ONLY"
    )
    # INVITED_ONLY with no invites → still nobody.
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == set()


def test_update_showtime_selection_applies_visibility_mode(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    friend = user_factory()
    showtime = showtime_factory()
    friend_id = friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    db_transaction.commit()

    selection_update_response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={
            "going_status": "GOING",
            "visibility_mode": "INVITED_ONLY",
        },
    )
    assert selection_update_response.status_code == 200
    assert selection_update_response.json()["going"] == "GOING"

    visibility_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
    )
    assert visibility_response.status_code == 200
    assert visibility_response.json()["mode"] == "INVITED_ONLY"
    # INVITED_ONLY with no pings → nobody can see the status yet.
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == set()


def test_removing_showtime_selection_clears_effective_but_keeps_setting(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    friend = user_factory()
    showtime = showtime_factory()
    friend_id = friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    # Default ALL_FRIENDS shows the friend; INVITED_ONLY differs so a row is stored.
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == {
        friend_id
    }
    visibility_update_response = client.put(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
        json={"mode": "INVITED_ONLY"},
    )
    assert visibility_update_response.status_code == 200

    deselect_response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "NOT_GOING"},
    )
    assert deselect_response.status_code == 200
    db_transaction.expire_all()

    # The chosen mode persists across the status change; only the cache is cleared.
    setting = showtime_visibility_crud.get_showtime_visibility_setting(
        session=db_transaction,
        owner_id=current_user_id,
        showtime_id=showtime_id,
    )
    assert setting is not None
    assert setting.mode == VisibilityMode.INVITED_ONLY
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == set()


def test_showtime_visibility_batch_returns_payload_per_showtime(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    first_friend = user_factory()
    second_friend = user_factory()
    first_showtime = showtime_factory()
    second_showtime = showtime_factory(movie=first_showtime.movie)
    first_friend_id = first_friend.id
    second_friend_id = second_friend.id
    first_showtime_id = first_showtime.id
    second_showtime_id = second_showtime.id
    first_showtime_movie_id = first_showtime.movie_id
    second_showtime_movie_id = second_showtime.movie_id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=first_friend_id,
    )
    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=second_friend_id,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=first_showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=second_showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    update_response = client.put(
        f"{settings.API_V1_STR}/showtimes/{first_showtime_id}/visibility",
        headers=normal_user_token_headers,
        json={"mode": "INVITED_ONLY"},
    )
    assert update_response.status_code == 200

    batch_response = client.get(
        f"{settings.API_V1_STR}/showtimes/visibility/batch",
        headers=normal_user_token_headers,
        params=[
            ("showtime_ids", first_showtime_id),
            ("showtime_ids", second_showtime_id),
        ],
    )
    assert batch_response.status_code == 200
    body = batch_response.json()
    assert [item["showtime_id"] for item in body] == [
        first_showtime_id,
        second_showtime_id,
    ]
    assert body[0]["movie_id"] == first_showtime_movie_id
    assert body[0]["mode"] == "INVITED_ONLY"
    # Second showtime has no override → the default (ALL_FRIENDS).
    assert body[1]["movie_id"] == second_showtime_movie_id
    assert body[1]["mode"] == "ALL_FRIENDS"


def test_showtime_visibility_batch_rejects_an_oversized_request(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    """Clients chunk their prefetches; an unbounded batch is refused."""
    response = client.get(
        f"{settings.API_V1_STR}/showtimes/visibility/batch",
        headers=normal_user_token_headers,
        params=[("showtime_ids", showtime_id) for showtime_id in range(1, 1002)],
    )
    assert response.status_code == 422


def test_showtime_visibility_is_scoped_per_showtime(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    first_friend = user_factory()
    second_friend = user_factory()
    showtime = showtime_factory()
    second_showtime = showtime_factory(movie=showtime.movie)
    first_friend_id = first_friend.id
    second_friend_id = second_friend.id
    showtime_id = showtime.id
    second_showtime_id = second_showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=first_friend_id,
    )
    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=second_friend_id,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=second_showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    update_response = client.put(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
        json={"mode": "INVITED_ONLY"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["mode"] == "INVITED_ONLY"

    unaffected_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{second_showtime_id}/visibility",
        headers=normal_user_token_headers,
    )
    assert unaffected_response.status_code == 200
    # The second showtime keeps the default mode.
    assert unaffected_response.json()["mode"] == "ALL_FRIENDS"


def test_all_friends_mode_excludes_opted_out_friends(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    sharing_friend = user_factory()
    hidden_friend = user_factory()
    showtime = showtime_factory()
    showtime_id = showtime.id
    sharing_friend_id = sharing_friend.id
    hidden_friend_id = hidden_friend.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=sharing_friend_id,
    )
    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=hidden_friend_id,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    # Default ALL_FRIENDS shows both friends.
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == {
        sharing_friend_id,
        hidden_friend_id,
    }

    # Opt out of sharing with one friend; they no longer see (still ALL_FRIENDS).
    hide_response = client.put(
        f"{settings.API_V1_STR}/friends/{hidden_friend_id}/status-visibility",
        headers=normal_user_token_headers,
        json={"shares_status": False},
    )
    assert hide_response.status_code == 200
    db_transaction.expire_all()

    visibility_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
    )
    assert visibility_response.status_code == 200
    assert visibility_response.json()["mode"] == "ALL_FRIENDS"
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == {
        sharing_friend_id
    }


def test_incognito_mode_overrides_and_restores_status_visibility(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    visible_friend = user_factory()
    hidden_friend = user_factory()
    showtime = showtime_factory()
    showtime_id = showtime.id
    visible_friend_id = visible_friend.id
    hidden_friend_id = hidden_friend.id
    visible_friend_email = visible_friend.email
    hidden_friend_email = hidden_friend.email
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=visible_friend_id,
    )
    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=hidden_friend_id,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    # Opt out of the hidden friend so only the visible friend can see by default.
    hide_response = client.put(
        f"{settings.API_V1_STR}/friends/{hidden_friend_id}/status-visibility",
        headers=normal_user_token_headers,
        json={"shares_status": False},
    )
    assert hide_response.status_code == 200
    db_transaction.expire_all()

    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == {
        visible_friend_id
    }

    enable_incognito_response = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"incognito_mode": True},
    )
    assert enable_incognito_response.status_code == 200
    assert enable_incognito_response.json()["incognito_mode"] is True

    while_incognito_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
    )
    assert while_incognito_response.status_code == 200
    # Incognito forces the effective default to INVITED_ONLY: nobody is materialized.
    assert while_incognito_response.json()["mode"] == "INVITED_ONLY"
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == set()

    visible_friend_login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": visible_friend_email, "password": "password"},
    )
    assert visible_friend_login.status_code == 200
    visible_friend_headers = {
        "Authorization": f"Bearer {visible_friend_login.json()['access_token']}"
    }
    visible_friend_view_while_incognito = client.get(
        f"{settings.API_V1_STR}/users/{current_user_id}/showtimes",
        headers=visible_friend_headers,
        params={"limit": 50, "offset": 0},
    )
    assert visible_friend_view_while_incognito.status_code == 200
    assert not any(
        showtime_item["id"] == showtime_id
        for showtime_item in visible_friend_view_while_incognito.json()
    )

    hidden_friend_login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": hidden_friend_email, "password": "password"},
    )
    assert hidden_friend_login.status_code == 200
    hidden_friend_headers = {
        "Authorization": f"Bearer {hidden_friend_login.json()['access_token']}"
    }
    hidden_friend_view_while_incognito = client.get(
        f"{settings.API_V1_STR}/users/{current_user_id}/showtimes",
        headers=hidden_friend_headers,
        params={"limit": 50, "offset": 0},
    )
    assert hidden_friend_view_while_incognito.status_code == 200
    assert not any(
        showtime_item["id"] == showtime_id
        for showtime_item in hidden_friend_view_while_incognito.json()
    )

    disable_incognito_response = client.patch(
        f"{settings.API_V1_STR}/me/",
        headers=normal_user_token_headers,
        json={"incognito_mode": False},
    )
    assert disable_incognito_response.status_code == 200
    assert disable_incognito_response.json()["incognito_mode"] is False

    after_incognito_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
    )
    assert after_incognito_response.status_code == 200
    # Default mode restored, sharing friend visible again (opted-out one stays hidden).
    assert after_incognito_response.json()["mode"] == "ALL_FRIENDS"
    db_transaction.expire_all()
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == {
        visible_friend_id
    }

    visible_friend_view_after_incognito = client.get(
        f"{settings.API_V1_STR}/users/{current_user_id}/showtimes",
        headers=visible_friend_headers,
        params={"limit": 50, "offset": 0},
    )
    assert visible_friend_view_after_incognito.status_code == 200
    assert any(
        showtime_item["id"] == showtime_id
        for showtime_item in visible_friend_view_after_incognito.json()
    )


def test_showtime_visibility_filters_friend_status_in_showtime_payload(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    visible_friend = user_factory()
    hidden_friend = user_factory()
    showtime = showtime_factory()
    visible_friend_id = visible_friend.id
    hidden_friend_id = hidden_friend.id
    visible_friend_email = visible_friend.email
    hidden_friend_email = hidden_friend.email
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=visible_friend_id,
    )
    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=hidden_friend_id,
    )

    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=visible_friend_id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=hidden_friend_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    # Opt out of the hidden friend; the default ALL_FRIENDS shows the other.
    hide_response = client.put(
        f"{settings.API_V1_STR}/friends/{hidden_friend_id}/status-visibility",
        headers=normal_user_token_headers,
        json={"shares_status": False},
    )
    assert hide_response.status_code == 200

    visible_friend_login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": visible_friend_email, "password": "password"},
    )
    assert visible_friend_login.status_code == 200
    visible_friend_headers = {
        "Authorization": f"Bearer {visible_friend_login.json()['access_token']}"
    }
    visible_friend_view = client.get(
        f"{settings.API_V1_STR}/users/{current_user_id}/showtimes",
        headers=visible_friend_headers,
        params={"limit": 50, "offset": 0},
    )
    assert visible_friend_view.status_code == 200
    assert any(
        showtime_item["id"] == showtime_id for showtime_item in visible_friend_view.json()
    )

    hidden_friend_login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": hidden_friend_email, "password": "password"},
    )
    assert hidden_friend_login.status_code == 200
    hidden_friend_headers = {
        "Authorization": f"Bearer {hidden_friend_login.json()['access_token']}"
    }
    hidden_friend_view = client.get(
        f"{settings.API_V1_STR}/users/{current_user_id}/showtimes",
        headers=hidden_friend_headers,
        params={"limit": 50, "offset": 0},
    )
    assert hidden_friend_view.status_code == 200
    assert not any(
        showtime_item["id"] == showtime_id for showtime_item in hidden_friend_view.json()
    )


def test_showtime_visibility_no_longer_applies_after_unfriend(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    friend_user = user_factory()
    friend_id = friend_user.id
    friend_email = friend_user.email
    showtime = showtime_factory()
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    visibility_update_response = client.put(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
        json={"mode": "ALL_FRIENDS"},
    )
    assert visibility_update_response.status_code == 200

    friendship_crud.delete_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    db_transaction.commit()

    friend_login_response = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": friend_email, "password": "password"},
    )
    assert friend_login_response.status_code == 200
    friend_headers = {
        "Authorization": f"Bearer {friend_login_response.json()['access_token']}"
    }

    showtimes_response = client.get(
        f"{settings.API_V1_STR}/users/{current_user_id}/showtimes",
        headers=friend_headers,
        params={"limit": 50, "offset": 0},
    )
    assert showtimes_response.status_code == 403
    assert "is not a friend" in showtimes_response.json()["detail"]


def test_update_showtime_selection_seat_roundtrip_and_clear(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    showtime_factory,
) -> None:
    showtime = showtime_factory()
    showtime_id = showtime.id

    set_seat_response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "GOING", "seat_row": " 6 ", "seat_number": "3 "},
    )
    assert set_seat_response.status_code == 200
    assert set_seat_response.json()["going"] == "GOING"
    assert set_seat_response.json()["seat_row"] == "6"
    assert set_seat_response.json()["seat_number"] == "3"

    preserve_seat_response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "GOING"},
    )
    assert preserve_seat_response.status_code == 200
    assert preserve_seat_response.json()["seat_row"] == "6"
    assert preserve_seat_response.json()["seat_number"] == "3"

    clear_seat_response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "GOING", "seat_row": None, "seat_number": None},
    )
    assert clear_seat_response.status_code == 200
    assert clear_seat_response.json()["seat_row"] is None
    assert clear_seat_response.json()["seat_number"] is None

    interested_response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "INTERESTED", "seat_row": "B", "seat_number": "7"},
    )
    assert interested_response.status_code == 200
    assert interested_response.json()["going"] == "INTERESTED"
    assert interested_response.json()["seat_row"] is None
    assert interested_response.json()["seat_number"] is None


def test_update_showtime_selection_rejects_invalid_unknown_seat_values(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    showtime_factory,
) -> None:
    showtime = showtime_factory(cinema__seating="unknown")
    showtime_id = showtime.id

    response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "GOING", "seat_row": "AA", "seat_number": "12"},
    )

    assert response.status_code == 400
    assert "Invalid row value" in response.json()["detail"]


def test_update_showtime_selection_rejects_invalid_row_number_seat_number_format(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    showtime_factory,
) -> None:
    showtime = showtime_factory(cinema__seating="number-number")
    showtime_id = showtime.id

    response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "GOING", "seat_row": "B", "seat_number": "8"},
    )

    assert response.status_code == 400
    assert "number-number" in response.json()["detail"]


def test_update_showtime_selection_rejects_seat_input_for_free_seating(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    showtime_factory,
) -> None:
    showtime = showtime_factory(cinema__seating="free")
    showtime_id = showtime.id

    response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "GOING", "seat_row": "A", "seat_number": "5"},
    )

    assert response.status_code == 400
    assert "free seating" in response.json()["detail"]


def test_update_showtime_selection_accepts_blank_seat_pair_as_no_selection(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    showtime_factory,
) -> None:
    showtime = showtime_factory(cinema__seating="letter-number")
    showtime_id = showtime.id

    response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "GOING", "seat_row": "   ", "seat_number": ""},
    )

    assert response.status_code == 200
    assert response.json()["going"] == "GOING"
    assert response.json()["seat_row"] is None
    assert response.json()["seat_number"] is None


def test_update_showtime_selection_rejects_row_only_seat_value(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    showtime_factory,
) -> None:
    showtime = showtime_factory(cinema__seating="unknown")
    showtime_id = showtime.id

    row_only_response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "GOING", "seat_row": "A", "seat_number": None},
    )
    assert row_only_response.status_code == 400
    assert "both be set or both be empty" in row_only_response.json()["detail"]


def test_update_showtime_selection_rejects_seat_only_seat_value(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    showtime_factory,
) -> None:
    showtime = showtime_factory(cinema__seating="unknown")
    showtime_id = showtime.id

    seat_only_response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "GOING", "seat_row": None, "seat_number": "5"},
    )
    assert seat_only_response.status_code == 400
    assert "both be set or both be empty" in seat_only_response.json()["detail"]


def test_get_showtime_by_id_returns_showtime(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    showtime_factory,
) -> None:
    showtime = showtime_factory()
    showtime_id = showtime.id
    movie_id = showtime.movie_id

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == showtime_id
    assert body["movie"]["id"] == movie_id
    assert "cinema" in body
    assert body["going"] == "NOT_GOING"
    assert body["friends_going"] == []
    assert body["friends_interested"] == []


def test_get_showtime_by_id_reflects_current_user_status(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    showtime_factory,
) -> None:
    showtime = showtime_factory()
    showtime_id = showtime.id

    selection_response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "INTERESTED"},
    )
    assert selection_response.status_code == 200

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["going"] == "INTERESTED"


def test_get_showtime_by_id_returns_404_for_unknown_id(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/showtimes/99999999",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Showtime with ID 99999999 not found."


def test_main_page_showtimes_includes_friend_seat_in_badge_payload(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    friend = user_factory()
    showtime = showtime_factory()
    friend_id = friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user_id,
        friend_id=friend_id,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=friend_id,
        going_status=GoingStatus.GOING,
        seat_row="C",
        seat_number="5",
        update_seat=True,
    )
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/showtimes",
        headers=normal_user_token_headers,
        params={"limit": 50, "offset": 0},
    )
    assert response.status_code == 200

    showtime_item = next(
        item for item in response.json() if item["id"] == showtime_id
    )
    friend_item = next(
        item for item in showtime_item["friends_going"] if item["id"] == str(friend_id)
    )

    assert friend_item["seat_row"] == "C"
    assert friend_item["seat_number"] == "5"


def test_opting_out_of_status_sharing_changes_effective_visibility(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    friend = user_factory()
    other_friend = user_factory()
    showtime = showtime_factory()
    friend_id = friend.id
    other_friend_id = other_friend.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction, user_id=current_user_id, friend_id=friend_id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=current_user_id, friend_id=other_friend_id
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    # Default ALL_FRIENDS + sharing-by-default → both friends see.
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == {
        friend_id,
        other_friend_id,
    }

    hide_response = client.put(
        f"{settings.API_V1_STR}/friends/{friend_id}/status-visibility",
        headers=normal_user_token_headers,
        json={"shares_status": False},
    )
    assert hide_response.status_code == 200
    db_transaction.expire_all()
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == {
        other_friend_id
    }

    # The friend list reflects the sharing flag.
    friends_response = client.get(
        f"{settings.API_V1_STR}/me/friends", headers=normal_user_token_headers
    )
    assert friends_response.status_code == 200
    sharing = {
        friend["id"]: friend["shares_status"] for friend in friends_response.json()
    }
    assert sharing[str(friend_id)] is False
    assert sharing[str(other_friend_id)] is True

    restore_response = client.put(
        f"{settings.API_V1_STR}/friends/{friend_id}/status-visibility",
        headers=normal_user_token_headers,
        json={"shares_status": True},
    )
    assert restore_response.status_code == 200
    db_transaction.expire_all()
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == {
        friend_id,
        other_friend_id,
    }


def test_set_friend_status_sharing_rejects_non_friend(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,  # noqa: ARG001
    user_factory,
) -> None:
    stranger = user_factory()
    response = client.put(
        f"{settings.API_V1_STR}/friends/{stranger.id}/status-visibility",
        headers=normal_user_token_headers,
        json={"shares_status": False},
    )
    assert response.status_code == 404


def test_invited_friend_always_sees_status_under_invited_only(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    friend = user_factory()
    friend_id = friend.id
    showtime = showtime_factory()
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction, user_id=current_user_id, friend_id=friend_id
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    showtime_visibility_crud.set_visibility_mode_for_showtime(
        session=db_transaction,
        owner_id=current_user_id,
        showtime_id=showtime_id,
        mode=VisibilityMode.INVITED_ONLY,
        now=now_amsterdam_naive(),
    )
    db_transaction.commit()

    # INVITED_ONLY + non-favorite + no ping → friend cannot see the status.
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == set()

    ping_response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )
    assert ping_response.status_code == 200
    db_transaction.expire_all()
    # Inviting the friend always exposes your status to them.
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == {
        friend_id
    }

    uninvite_response = client.delete(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )
    assert uninvite_response.status_code == 200
    db_transaction.expire_all()
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == set()


def test_friend_who_invited_you_sees_your_status(
    client: TestClient,
    normal_user_token_headers: dict[str, str],  # noqa: ARG001
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    inviter = user_factory()
    inviter_id = inviter.id
    inviter_email = inviter.email
    showtime = showtime_factory()
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction, user_id=current_user_id, friend_id=inviter_id
    )
    db_transaction.commit()

    inviter_login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": inviter_email, "password": "password"},
    )
    assert inviter_login.status_code == 200
    inviter_headers = {
        "Authorization": f"Bearer {inviter_login.json()['access_token']}"
    }

    # The inviter invites you to the showtime before you have any selection on
    # it, so the ping is a "real" invite and grants visibility (a ping sent
    # after you already have a selection is visibility-inert instead — see
    # test_ping_friend_for_showtime_does_not_grant_visibility_when_already_selected).
    ping_response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{current_user_id}",
        headers=inviter_headers,
    )
    assert ping_response.status_code == 200

    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    showtime_visibility_crud.set_visibility_mode_for_showtime(
        session=db_transaction,
        owner_id=current_user_id,
        showtime_id=showtime_id,
        mode=VisibilityMode.INVITED_ONLY,
        now=now_amsterdam_naive(),
    )
    db_transaction.commit()
    db_transaction.expire_all()
    # A friend who invited you always sees your status, even under INVITED_ONLY.
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == {
        inviter_id
    }


def test_being_invited_by_an_all_friends_inviter_stays_all_friends(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    """Being invited only tightens your default when the inviter is private.

    An inviter who is plain ALL_FRIENDS shouldn't push you to INVITED_ONLY —
    that only happens if the inviter is themselves private/incognito for this
    showtime (covered by test_co_invitees_..._inherit_invite_only_default).
    """
    inviter = user_factory()
    inviter_id = inviter.id
    showtime = showtime_factory()
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction, user_id=current_user_id, friend_id=inviter_id
    )
    db_transaction.commit()

    showtime_ping_crud.create_showtime_ping(
        session=db_transaction,
        showtime_id=showtime_id,
        sender_id=inviter_id,
        receiver_id=current_user_id,
        created_at=now_amsterdam_naive(),
    )
    db_transaction.commit()

    visibility_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
    )
    assert visibility_response.status_code == 200
    assert visibility_response.json()["mode"] == "ALL_FRIENDS"


def test_co_invitees_see_your_status_and_inherit_invite_only_default(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    inviter = user_factory()
    co_invitee = user_factory()  # my friend, invited by the same inviter
    bystander = user_factory()  # my friend, not invited
    showtime = showtime_factory()
    inviter_id = inviter.id
    co_invitee_id = co_invitee.id
    bystander_id = bystander.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    for friend_id in (inviter_id, co_invitee_id, bystander_id):
        friendship_crud.create_friendship(
            session=db_transaction, user_id=current_user_id, friend_id=friend_id
        )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    # The inviter is keeping this showtime invite-only.
    showtime_visibility_crud.set_visibility_mode_for_showtime(
        session=db_transaction,
        owner_id=inviter_id,
        showtime_id=showtime_id,
        mode=VisibilityMode.INVITED_ONLY,
        now=now_amsterdam_naive(),
    )
    # The inviter invites both me and my friend (co_invitee).
    showtime_ping_crud.create_showtime_ping(
        session=db_transaction,
        showtime_id=showtime_id,
        sender_id=inviter_id,
        receiver_id=current_user_id,
        created_at=now_amsterdam_naive(),
    )
    showtime_ping_crud.create_showtime_ping(
        session=db_transaction,
        showtime_id=showtime_id,
        sender_id=inviter_id,
        receiver_id=co_invitee_id,
        created_at=now_amsterdam_naive(),
    )
    showtime_visibility_crud.rebuild_effective_visibility_for_showtime_participants(
        session=db_transaction,
        showtime_id=showtime_id,
    )
    db_transaction.commit()

    # I inherit the inviter's invite-only default for this showtime.
    visibility_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
    )
    assert visibility_response.status_code == 200
    assert visibility_response.json()["mode"] == "INVITED_ONLY"

    # Even under invite-only, the inviter (direct) and the co-invitee see my
    # status; the un-invited bystander does not.
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == {
        inviter_id,
        co_invitee_id,
    }
    assert bystander_id not in _effective_viewer_ids(
        db_transaction, current_user_id, showtime_id
    )

    # The showtime payload surfaces the co-invited friend for the banner.
    showtime_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}",
        headers=normal_user_token_headers,
    )
    assert showtime_response.status_code == 200
    co_invited_ids = {
        entry["friend"]["id"]
        for entry in showtime_response.json()["co_invited_friends"]
    }
    assert co_invited_ids == {str(co_invitee_id)}

    # Switching to ALL_FRIENDS still keeps the co-invitee visible.
    update_response = client.put(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
        json={"mode": "ALL_FRIENDS"},
    )
    assert update_response.status_code == 200
    db_transaction.expire_all()
    assert _effective_viewer_ids(db_transaction, current_user_id, showtime_id) == {
        inviter_id,
        co_invitee_id,
        bystander_id,
    }


def test_non_friend_participants_surfaces_non_friends_from_invite_graph(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    """current_user -> connector (friend, accepted) -> stranger (non-friend).

    The chain-connected stranger should show up in `non_friend_participants`
    (identity-only), while the friend connector should not — they're already
    covered by the friend-scoped visibility fields.
    """
    connector = user_factory()  # my friend, invited by me
    stranger = user_factory()  # not my friend, invited by the connector
    showtime = showtime_factory()
    connector_id = connector.id
    stranger_id = stranger.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction, user_id=current_user_id, friend_id=connector_id
    )
    showtime_ping_crud.create_showtime_ping(
        session=db_transaction,
        showtime_id=showtime_id,
        sender_id=current_user_id,
        receiver_id=connector_id,
        created_at=now_amsterdam_naive(),
    )
    showtime_ping_crud.create_showtime_ping(
        session=db_transaction,
        showtime_id=showtime_id,
        sender_id=connector_id,
        receiver_id=stranger_id,
        created_at=now_amsterdam_naive(),
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=connector_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    showtime_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}",
        headers=normal_user_token_headers,
    )
    assert showtime_response.status_code == 200
    non_friend_participant_ids = {
        entry["user"]["id"]
        for entry in showtime_response.json()["non_friend_participants"]
    }
    assert non_friend_participant_ids == {str(stranger_id)}


def test_non_friend_participants_empty_without_chain_acceptance(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    """Before the connector accepts, the stranger isn't in the invite graph at
    all (chain visibility is gated on the connector's selection)."""
    connector = user_factory()
    stranger = user_factory()
    showtime = showtime_factory()
    connector_id = connector.id
    stranger_id = stranger.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction, user_id=current_user_id, friend_id=connector_id
    )
    showtime_ping_crud.create_showtime_ping(
        session=db_transaction,
        showtime_id=showtime_id,
        sender_id=current_user_id,
        receiver_id=connector_id,
        created_at=now_amsterdam_naive(),
    )
    showtime_ping_crud.create_showtime_ping(
        session=db_transaction,
        showtime_id=showtime_id,
        sender_id=connector_id,
        receiver_id=stranger_id,
        created_at=now_amsterdam_naive(),
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=current_user_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()
    # Note: connector never accepted (no ShowtimeSelection for them).

    showtime_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}",
        headers=normal_user_token_headers,
    )
    assert showtime_response.status_code == 200
    non_friend_participant_ids = {
        entry["user"]["id"]
        for entry in showtime_response.json()["non_friend_participants"]
    }
    assert str(stranger_id) not in non_friend_participant_ids


def test_report_showtime_is_blocked_for_report_banned_user(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
) -> None:
    showtime = showtime_factory()
    current_user_id = _normal_user_id(db_transaction)
    current_user = db_transaction.get(User, current_user_id)
    assert current_user is not None
    current_user.report_banned = True
    current_user.report_ban_expires_at = None
    db_transaction.add(current_user)
    db_transaction.commit()

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime.id}/report",
        headers=normal_user_token_headers,
        json={"reason": "incorrect_time", "message": "Starts 30 min later"},
    )

    assert response.status_code == 403


def test_report_showtime_allowed_when_ban_has_expired(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
) -> None:
    showtime = showtime_factory()
    current_user_id = _normal_user_id(db_transaction)
    current_user = db_transaction.get(User, current_user_id)
    assert current_user is not None
    current_user.report_banned = True
    current_user.report_ban_expires_at = now_amsterdam_naive() - timedelta(days=1)
    db_transaction.add(current_user)
    db_transaction.commit()

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime.id}/report",
        headers=normal_user_token_headers,
        json={"reason": "incorrect_time", "message": "Starts 30 min later"},
    )

    assert response.status_code == 200


def test_share_preview_returns_og_tags_with_poster(
    client: TestClient,
    showtime_factory,
) -> None:
    """No auth header is passed at all: this endpoint must remain public."""
    showtime = showtime_factory(
        movie__title="Paddington 3",
        movie__poster_link="https://example.com/paddington.jpg",
        cinema__name="The Movies",
    )
    showtime_id = showtime.id
    sender_identifier = "some-sender"

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/share-preview/{sender_identifier}"
    )

    assert response.status_code == 200
    body = response.text

    expected_description = (
        f"{showtime.datetime.strftime('%-d %b, %H:%M')} · The Movies"
    )
    expected_url = f"{settings.FRONTEND_HOST}/ping/{showtime_id}/{sender_identifier}"

    assert 'property="og:title" content="Paddington 3"' in body
    assert 'name="twitter:title" content="Paddington 3"' in body
    assert f'property="og:description" content="{expected_description}"' in body
    assert f'name="twitter:description" content="{expected_description}"' in body
    assert (
        'property="og:image" content="https://example.com/paddington.jpg"' in body
    )
    assert (
        'name="twitter:image" content="https://example.com/paddington.jpg"' in body
    )
    assert f'property="og:url" content="{expected_url}"' in body


def test_share_preview_falls_back_to_static_logo_without_poster(
    client: TestClient,
    showtime_factory,
) -> None:
    showtime = showtime_factory(movie__poster_link=None)
    showtime_id = showtime.id

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/share-preview/some-sender"
    )

    assert response.status_code == 200
    expected_fallback = f"{settings.FRONTEND_HOST}/assets/images/mikino-logo.png"
    body = response.text
    assert f'property="og:image" content="{expected_fallback}"' in body
    assert f'name="twitter:image" content="{expected_fallback}"' in body


def test_share_preview_html_escapes_movie_title_and_cinema_name(
    client: TestClient,
    showtime_factory,
) -> None:
    """Special characters in movie title / cinema name must not appear raw in the HTML."""
    showtime = showtime_factory(
        movie__title='<script>alert("xss")</script> & Friends',
        cinema__name='Bob\'s "Cinema" <Downtown>',
    )
    showtime_id = showtime.id

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/share-preview/some-sender"
    )

    assert response.status_code == 200
    body = response.text

    # The raw, unescaped strings must never appear in the response body.
    assert "<script>alert(\"xss\")</script>" not in body
    assert 'Bob\'s "Cinema" <Downtown>' not in body

    # The escaped versions must be present instead.
    assert "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; Friends" in body
    assert "Bob&#x27;s &quot;Cinema&quot; &lt;Downtown&gt;" in body


def test_share_preview_returns_404_for_nonexistent_showtime(
    client: TestClient,
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/showtimes/99999999/share-preview/some-sender"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Showtime not found"


def test_cinema_search_reaches_cinemas_outside_the_saved_selection(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
) -> None:
    """Searching for a cinema by name must look past "wherever I usually go".

    The client says "no cinema restriction" by sending no cinema ids at all,
    which for every other request means the account's saved cinemas — so a
    cinema search used to be silently answered from the saved ones only, and a
    cinema the user had not saved could never be found.
    """
    saved = showtime_factory(cinema__name="Plaza")
    unsaved = showtime_factory(cinema__name="The Grand Picture House")
    user_crud.set_cinema_selections(
        session=db_transaction,
        user_id=_normal_user_id(db_transaction),
        cinema_ids=[saved.cinema_id],
    )
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/",
        params={"query": "grand", "search_field": "cinema"},
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    returned_ids = {item["id"] for item in response.json()}
    assert unsaved.id in returned_ids
    assert saved.id not in returned_ids


def test_saved_cinemas_still_apply_without_a_cinema_search(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
) -> None:
    """The fallback above is lifted only for a cinema-name search.

    A title search — and an empty cinema query — must still be answered from
    the account's saved cinemas.
    """
    saved = showtime_factory(cinema__name="Plaza", movie__title="Shared Title")
    unsaved = showtime_factory(
        cinema__name="The Grand Picture House", movie__title="Shared Title"
    )
    user_crud.set_cinema_selections(
        session=db_transaction,
        user_id=_normal_user_id(db_transaction),
        cinema_ids=[saved.cinema_id],
    )
    db_transaction.commit()

    for params in (
        {"query": "Shared Title", "search_field": "title"},
        {"search_field": "cinema"},
    ):
        response = client.get(
            f"{settings.API_V1_STR}/showtimes/",
            params=params,
            headers=normal_user_token_headers,
        )

        assert response.status_code == 200
        returned_ids = {item["id"] for item in response.json()}
        assert saved.id in returned_ids, params
        assert unsaved.id not in returned_ids, params


# LAB111's Z-ELITE shop, one of the platforms `scraping.seat_availability` reads.
_READABLE_TICKET_LINK = (
    "https://tickets.lab111.nl/labcinema/nl/flow_configs/webshop"
    "/steps/start/show/1293554"
)


def test_requesting_a_first_seat_reading_queues_one_and_says_so(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
    mocker,
) -> None:
    """The "Check" button in the showtime sheet.

    Its whole job is to leave the screening saying a reading is on its way —
    that is what the sheet swaps the button for — and to dispatch the one live
    read the showtime is ever entitled to.
    """
    check_now = mocker.patch("app.api.routes.showtimes._check_seat_availability_now")
    showtime = showtime_factory(
        datetime=now_amsterdam_naive() + timedelta(days=2),
        ticket_link=_READABLE_TICKET_LINK,
        seats_checked_at=None,
        seats_next_check_at=None,
    )
    showtime_id = showtime.id
    db_transaction.commit()

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/seat-availability/check",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["checking"] is True
    assert body["trackable"] is True
    # Gone the moment it is used: one hand-requested read per screening, ever.
    assert body["can_request_check"] is False
    check_now.assert_called_once_with(showtime_id)


def test_requesting_a_seat_reading_that_already_happened_costs_nothing(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
    mocker,
) -> None:
    """Two people tapping at once, or a stale client: the answer the caller
    wanted is already there, so it comes back rather than costing a second
    request at the ticket shop."""
    check_now = mocker.patch("app.api.routes.showtimes._check_seat_availability_now")
    showtime = showtime_factory(
        datetime=now_amsterdam_naive() + timedelta(days=2),
        ticket_link=_READABLE_TICKET_LINK,
        seats_left=40,
        seats_capacity=100,
        seats_checked_at=now_amsterdam_naive() - timedelta(minutes=5),
        seats_next_check_at=now_amsterdam_naive() + timedelta(minutes=30),
    )
    showtime_id = showtime.id
    db_transaction.commit()

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/seat-availability/check",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["seats_left"] == 40
    assert body["can_request_check"] is False
    check_now.assert_not_called()


def test_requesting_a_seat_reading_needs_an_account(
    client: TestClient,
    db_transaction: Session,
    showtime_factory,
    mocker,
) -> None:
    """Reading how full a screening is is public; *causing* a request at a small
    cinema's ticket shop is not."""
    check_now = mocker.patch("app.api.routes.showtimes._check_seat_availability_now")
    showtime = showtime_factory(
        datetime=now_amsterdam_naive() + timedelta(days=2),
        ticket_link=_READABLE_TICKET_LINK,
        seats_checked_at=None,
    )
    showtime_id = showtime.id
    db_transaction.commit()

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/seat-availability/check",
    )

    assert response.status_code == 401
    check_now.assert_not_called()


def test_listed_showtimes_carry_their_own_seat_availability(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
) -> None:
    """The busyness badge is drawn from the list response itself.

    It used to take a second request per screenful, which is why the badges
    appeared a beat after the cards they belong to. Carrying the reading inline
    is what lets the client paint them in the same frame, so the field has to
    be there — with the same `None`-means-nothing-to-say rule as the batch
    endpoint, which is what the client caches to stop asking again.
    """
    readable = showtime_factory(
        datetime=now_amsterdam_naive() + timedelta(days=2),
        ticket_link=_READABLE_TICKET_LINK,
        seats_left=12,
        seats_capacity=100,
        seats_checked_at=now_amsterdam_naive() - timedelta(minutes=5),
    )
    unreadable = showtime_factory(
        datetime=now_amsterdam_naive() + timedelta(days=2),
        ticket_link="https://example.com/some-other-ticket-shop/1",
    )
    readable_id = readable.id
    unreadable_id = unreadable.id
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/",
        params={"limit": 100},
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    by_id = {item["id"]: item for item in response.json()}
    inline = by_id[readable_id]["seat_availability"]
    assert inline["showtime_id"] == readable_id
    assert inline["seats_left"] == 12
    assert inline["seats_capacity"] == 100
    assert inline["level"] is not None
    assert inline["trackable"] is True
    # A ticket shop nothing here can read: no block, and never will be one.
    assert by_id[unreadable_id]["seat_availability"] is None


def test_listed_showtimes_carry_the_viewers_visibility_mode(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
) -> None:
    """The sheet's mode pill is drawn from the list the sheet was opened from.

    It used to cost a batched request of its own, which is what made the pill
    arrive after the sheet. The mode is viewer state — the asker's own setting
    — so it rides along in `viewer`, and an explicit override has to win over
    the default exactly as the batch endpoint has it.
    """
    overridden = showtime_factory(datetime=now_amsterdam_naive() + timedelta(days=2))
    defaulted = showtime_factory(datetime=now_amsterdam_naive() + timedelta(days=2))
    overridden_id = overridden.id
    defaulted_id = defaulted.id
    db_transaction.commit()

    update_response = client.put(
        f"{settings.API_V1_STR}/showtimes/{overridden_id}/visibility",
        headers=normal_user_token_headers,
        json={"mode": "INVITED_ONLY"},
    )
    assert update_response.status_code == 200

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/",
        params={"limit": 100},
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    by_id = {item["id"]: item for item in response.json()}
    assert by_id[overridden_id]["viewer"]["visibility_mode"] == "INVITED_ONLY"
    # No override, so the viewer's own default stands.
    assert by_id[defaulted_id]["viewer"]["visibility_mode"] == "ALL_FRIENDS"


def test_hidden_attending_friends_route_returns_404_for_unknown_showtime(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/showtimes/99999999/visibility/hidden-attending-friends",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Showtime with ID 99999999 not found."


def test_hidden_attending_friends_route_warns_about_an_invisible_attending_friend(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    """The mirror of `uninvited-selected-friends`: this warns before marking
    going/interested rather than before switching to INVITED_ONLY, so it must
    take the actor's own INVITED_ONLY mode into account and surface the
    already-attending friend who would not see the actor's status."""
    hidden_friend = user_factory()
    hidden_friend_id = hidden_friend.id
    showtime = showtime_factory()
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction, user_id=current_user_id, friend_id=hidden_friend_id
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=hidden_friend_id,
        going_status=GoingStatus.GOING,
    )
    showtime_visibility_crud.set_visibility_mode_for_showtime(
        session=db_transaction,
        owner_id=current_user_id,
        showtime_id=showtime_id,
        mode=VisibilityMode.INVITED_ONLY,
        now=now_amsterdam_naive(),
    )
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility/hidden-attending-friends",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    friend_ids = {friend["id"] for friend in response.json()["friends"]}
    assert friend_ids == {str(hidden_friend_id)}


def test_hidden_attending_friends_route_omits_a_friend_who_would_already_see_you(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    """An attending friend under the default ALL_FRIENDS mode, with no
    opt-out, would already see the actor's status — so the route must not
    warn about them."""
    visible_friend = user_factory()
    visible_friend_id = visible_friend.id
    showtime = showtime_factory()
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    friendship_crud.create_friendship(
        session=db_transaction, user_id=current_user_id, friend_id=visible_friend_id
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_id,
        user_id=visible_friend_id,
        going_status=GoingStatus.INTERESTED,
    )
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility/hidden-attending-friends",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.json()["friends"] == []
