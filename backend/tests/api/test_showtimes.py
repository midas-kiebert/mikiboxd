from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import GoingStatus
from app.crud import friendship as friendship_crud
from app.crud import showtime as showtime_crud
from app.models.user import User


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
