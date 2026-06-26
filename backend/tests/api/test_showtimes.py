from urllib.parse import quote

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import GoingStatus, VisibilityMode
from app.crud import friendship as friendship_crud
from app.crud import showtime as showtime_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.crud import showtime_visibility as showtime_visibility_crud
from app.models.showtime_ping import ShowtimePing
from app.models.showtime_visibility import ShowtimeVisibilityEffective
from app.models.user import User
from app.utils import now_amsterdam_naive


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


def test_ping_friend_for_showtime_rejects_when_already_selected(
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
        going_status=GoingStatus.INTERESTED,
    )
    db_transaction.commit()

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "This friend already selected this showtime."


def test_ping_friend_for_showtime_allows_ping_when_selection_is_hidden(
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
    notify_ping.assert_called_once()


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


def test_receive_ping_from_link_allows_non_friend_sender(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
    showtime_factory,
) -> None:
    sender = user_factory(display_name="Ping Link Sender")
    showtime = showtime_factory()
    sender_id = sender.id
    showtime_id = showtime.id
    current_user_id = _normal_user_id(db_transaction)

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link/{sender_id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Invite received successfully"}

    stored_ping = db_transaction.exec(
        select(ShowtimePing).where(
            ShowtimePing.showtime_id == showtime_id,
            ShowtimePing.sender_id == sender_id,
            ShowtimePing.receiver_id == current_user_id,
        )
    ).one_or_none()
    assert stored_ping is not None


def test_receive_ping_from_link_accepts_display_name_identifier(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    user_factory,
    showtime_factory,
) -> None:
    sender = user_factory(display_name="Sender Via Name")
    showtime = showtime_factory()
    showtime_id = showtime.id
    encoded_sender = quote(sender.display_name or "", safe="")

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link/{encoded_sender}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Invite received successfully"}


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

    first_response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link/{sender_id}",
        headers=normal_user_token_headers,
    )
    assert first_response.status_code == 200

    second_response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link/{sender_id}",
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


def test_receive_ping_from_link_rejects_unknown_sender(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    showtime_factory,
) -> None:
    showtime = showtime_factory()
    showtime_id = showtime.id
    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping-link/{quote('missing sender', safe='')}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Sender for this invite link was not found."


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

    inviter_login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={"username": inviter_email, "password": "password"},
    )
    assert inviter_login.status_code == 200
    inviter_headers = {
        "Authorization": f"Bearer {inviter_login.json()['access_token']}"
    }

    # The inviter invites you to the showtime.
    ping_response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{current_user_id}",
        headers=inviter_headers,
    )
    assert ping_response.status_code == 200
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
