from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import GoingStatus
from app.crud import friendship as friendship_crud
from app.crud import showtime as showtime_crud
from app.crud import showtime_visibility as showtime_visibility_crud
from app.models.user import User
from app.utils import now_amsterdam_naive


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
    assert response.json() == {"message": "Friend pinged successfully"}
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
    assert response.json()["detail"] == "You can only ping your friends."


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
    showtime_visibility_crud.set_visible_friend_ids_for_showtime(
        session=db_transaction,
        owner_id=friend_id,
        showtime_id=showtime_id,
        visible_friend_ids=[],
        all_friend_ids={current_user_id},
        now=now_amsterdam_naive(),
    )
    db_transaction.commit()

    notify_ping = mocker.patch("app.services.push_notifications.notify_user_on_showtime_ping")

    response = client.post(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/ping/{friend_id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.json() == {"message": "Friend pinged successfully"}
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
        == "You already pinged this friend for this showtime."
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
    db_transaction.commit()

    initial_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
    )
    assert initial_response.status_code == 200
    initial_body = initial_response.json()
    assert initial_body["showtime_id"] == showtime_id
    assert initial_body["movie_id"] == showtime.movie_id
    assert initial_body["all_friends_selected"] is True
    assert sorted(initial_body["visible_friend_ids"]) == sorted(
        [str(first_friend_id), str(second_friend_id)]
    )

    update_response = client.put(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
        json={"visible_friend_ids": [str(first_friend_id)]},
    )
    assert update_response.status_code == 200
    update_body = update_response.json()
    assert update_body["all_friends_selected"] is False
    assert update_body["visible_friend_ids"] == [str(first_friend_id)]

    updated_get_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
    )
    assert updated_get_response.status_code == 200
    assert updated_get_response.json()["visible_friend_ids"] == [str(first_friend_id)]


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
    db_transaction.commit()

    update_response = client.put(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
        json={"visible_friend_ids": [str(first_friend_id)]},
    )
    assert update_response.status_code == 200
    assert update_response.json()["all_friends_selected"] is False
    assert update_response.json()["visible_friend_ids"] == [str(first_friend_id)]

    unaffected_response = client.get(
        f"{settings.API_V1_STR}/showtimes/{second_showtime_id}/visibility",
        headers=normal_user_token_headers,
    )
    assert unaffected_response.status_code == 200
    unaffected_body = unaffected_response.json()
    assert unaffected_body["all_friends_selected"] is True
    assert sorted(unaffected_body["visible_friend_ids"]) == sorted(
        [str(first_friend_id), str(second_friend_id)]
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

    visibility_update_response = client.put(
        f"{settings.API_V1_STR}/showtimes/{showtime_id}/visibility",
        headers=normal_user_token_headers,
        json={"visible_friend_ids": [str(visible_friend_id)]},
    )
    assert visibility_update_response.status_code == 200

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
    showtime = showtime_factory(cinema__seating="row-number-seat-number")
    showtime_id = showtime.id

    response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "GOING", "seat_row": "B", "seat_number": "8"},
    )

    assert response.status_code == 400
    assert "row-number-seat-number" in response.json()["detail"]


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
    showtime = showtime_factory(cinema__seating="row-letter-seat-number")
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


def test_update_showtime_selection_rejects_partial_seat_values(
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

    seat_only_response = client.put(
        f"{settings.API_V1_STR}/showtimes/selection/{showtime_id}",
        headers=normal_user_token_headers,
        json={"going_status": "GOING", "seat_row": None, "seat_number": "5"},
    )
    assert seat_only_response.status_code == 400
    assert "both be set or both be empty" in seat_only_response.json()["detail"]


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
