"""API tests for the /friends routes."""

from uuid import UUID

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.crud import friendship as friendship_crud
from app.models.user import User
from tests.utils.user import user_authentication_headers


def _normal_user_id(db_transaction: Session) -> UUID:
    return db_transaction.exec(
        select(User.id).where(User.email == settings.EMAIL_TEST_USER)
    ).one()


def _auth_headers_for(client: TestClient, user) -> dict[str, str]:
    return user_authentication_headers(
        client=client, email=user.email, password="password"
    )


def test_send_friend_request_creates_pending_request(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
) -> None:
    """With no prior state, sending a request just leaves it pending."""
    current_user_id = _normal_user_id(db_transaction)
    other_user = user_factory()

    response = client.post(
        f"{settings.API_V1_STR}/friends/request/{other_user.id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert response.json()["message"] == "Friend request sent successfully."

    sent = client.get(
        f"{settings.API_V1_STR}/me/requests/sent",
        headers=normal_user_token_headers,
    )
    assert sent.status_code == 200
    assert [u["id"] for u in sent.json()] == [str(other_user.id)]

    # Not friends yet.
    assert friendship_crud.are_users_friends(
        session=db_transaction, user_id=current_user_id, friend_id=other_user.id
    ) is False


def test_mutual_friend_request_auto_resolves_to_friendship(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
) -> None:
    """If B already requested A, A requesting B back immediately makes them friends."""
    current_user_id = _normal_user_id(db_transaction)
    other_user = user_factory(password="password")
    other_headers = _auth_headers_for(client, other_user)

    # B -> A pending request.
    reverse_request = client.post(
        f"{settings.API_V1_STR}/friends/request/{current_user_id}",
        headers=other_headers,
    )
    assert reverse_request.status_code == 200
    assert reverse_request.json()["message"] == "Friend request sent successfully."

    # A -> B: should auto-resolve into a friendship instead of a second request.
    response = client.post(
        f"{settings.API_V1_STR}/friends/request/{other_user.id}",
        headers=normal_user_token_headers,
    )
    assert response.status_code == 200
    assert response.json()["message"] == "Friend request accepted successfully."

    # No pending requests remain in either direction.
    assert (
        friendship_crud.has_sent_friend_request(
            session=db_transaction,
            sender_id=other_user.id,
            receiver_id=current_user_id,
        )
        is False
    )
    assert (
        friendship_crud.has_sent_friend_request(
            session=db_transaction,
            sender_id=current_user_id,
            receiver_id=other_user.id,
        )
        is False
    )

    # They are now friends, both ways.
    assert friendship_crud.are_users_friends(
        session=db_transaction, user_id=current_user_id, friend_id=other_user.id
    )
    assert friendship_crud.are_users_friends(
        session=db_transaction, user_id=other_user.id, friend_id=current_user_id
    )

    a_friends = client.get(
        f"{settings.API_V1_STR}/me/friends",
        headers=normal_user_token_headers,
    )
    assert a_friends.status_code == 200
    assert [u["id"] for u in a_friends.json()] == [str(other_user.id)]

    b_friends = client.get(
        f"{settings.API_V1_STR}/me/friends",
        headers=other_headers,
    )
    assert b_friends.status_code == 200
    assert [u["id"] for u in b_friends.json()] == [str(current_user_id)]


def test_send_friend_request_when_already_friends_is_a_no_op(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
) -> None:
    """Already being friends is a clean no-op success, not a dangling pending
    request that can never be accepted (guards against a stale client, a race
    with another action, or a direct API call).
    """
    current_user_id = _normal_user_id(db_transaction)
    other_user = user_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=current_user_id, friend_id=other_user.id
    )
    db_transaction.commit()

    response = client.post(
        f"{settings.API_V1_STR}/friends/request/{other_user.id}",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    assert friendship_crud.are_users_friends(
        session=db_transaction, user_id=current_user_id, friend_id=other_user.id
    )
    assert not friendship_crud.has_sent_friend_request(
        session=db_transaction, sender_id=current_user_id, receiver_id=other_user.id
    )
