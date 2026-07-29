# import uuid
# from unittest.mock import patch

# from fastapi.testclient import TestClient
# from sqlmodel import Session, select

# from app import crud
# from app.core.config import settings
# from app.core.security import verify_password
# from app.models import User, UserCreate, UserPublic, UserWithFriendInfoPublic
# from app.tests.utils.utils import random_email, random_lower_string


# def test_count_users(db_transaction: Session) -> None:
#     user_query = select(User)
#     users_count = len(list(db_transaction.exec(user_query)))
#     print("Total users in the database:", users_count)
#     assert users_count == 2


# def test_create_user_new_email(
#     client: TestClient, superuser_token_headers: dict[str, str], db_transaction: Session
# ) -> None:
#     with (
#         patch("app.utils.send_email", return_value=None),
#         patch("app.core.config.settings.SMTP_HOST", "smtp.example.com"),
#         patch("app.core.config.settings.SMTP_USER", "admin@example.com"),
#     ):
#         username = random_email()
#         password = random_lower_string()
#         data = {"email": username, "password": password}
#         r = client.post(
#             f"{settings.API_V1_STR}/users/",
#             headers=superuser_token_headers,
#             json=data,
#         )
#         assert 200 <= r.status_code < 300
#         created_user = r.json()
#         user = crud.get_user_by_email(session=db_transaction, email=username)
#         assert user
#         assert user.email == created_user["email"]


# def test_count_users_after(db_transaction: Session) -> None:
#     user_query = select(User)
#     users_count = len(list(db_transaction.exec(user_query)))
#     print("Total users in the database:", users_count)
#     assert users_count == 2


# def test_get_existing_user(
#     client: TestClient, superuser_token_headers: dict[str, str], db_transaction: Session
# ) -> None:
#     username = random_email()
#     password = random_lower_string()
#     user_in = UserCreate(email=username, password=password)
#     user = crud.create_user(session=db_transaction, user_create=user_in)
#     user_id = user.id
#     r = client.get(
#         f"{settings.API_V1_STR}/users/{user_id}",
#         headers=superuser_token_headers,
#     )
#     assert 200 <= r.status_code < 300
#     api_user = r.json()
#     existing_user = crud.get_user_by_email(session=db_transaction, email=username)
#     assert existing_user
#     assert existing_user.email == api_user["email"]


# def test_get_existing_user_current_user(
#     client: TestClient, db_transaction: Session
# ) -> None:
#     username = random_email()
#     password = random_lower_string()
#     user_in = UserCreate(email=username, password=password)
#     user = crud.create_user(session=db_transaction, user_create=user_in)
#     user_id = user.id

#     login_data = {
#         "username": username,
#         "password": password,
#     }
#     r = client.post(f"{settings.API_V1_STR}/login/access-token", data=login_data)
#     tokens = r.json()
#     a_token = tokens["access_token"]
#     headers = {"Authorization": f"Bearer {a_token}"}

#     r = client.get(
#         f"{settings.API_V1_STR}/users/{user_id}",
#         headers=headers,
#     )
#     assert 200 <= r.status_code < 300
#     api_user = r.json()
#     existing_user = crud.get_user_by_email(session=db_transaction, email=username)
#     assert existing_user
#     assert existing_user.email == api_user["email"]


# def test_get_existing_user_permissions_error(
#     client: TestClient, normal_user_token_headers: dict[str, str]
# ) -> None:
#     r = client.get(
#         f"{settings.API_V1_STR}/users/{uuid.uuid4()}",
#         headers=normal_user_token_headers,
#     )
#     assert r.status_code == 403
#     assert r.json() == {"detail": "The user doesn't have enough privileges"}


# def test_create_user_existing_username(
#     client: TestClient, superuser_token_headers: dict[str, str], db_transaction: Session
# ) -> None:
#     username = random_email()
#     # username = email
#     password = random_lower_string()
#     user_in = UserCreate(email=username, password=password)
#     crud.create_user(session=db_transaction, user_create=user_in)
#     data = {"email": username, "password": password}
#     r = client.post(
#         f"{settings.API_V1_STR}/users/",
#         headers=superuser_token_headers,
#         json=data,
#     )
#     created_user = r.json()
#     assert r.status_code == 400
#     assert "_id" not in created_user


# def test_create_user_by_normal_user(
#     client: TestClient, normal_user_token_headers: dict[str, str]
# ) -> None:
#     username = random_email()
#     password = random_lower_string()
#     data = {"email": username, "password": password}
#     r = client.post(
#         f"{settings.API_V1_STR}/users/",
#         headers=normal_user_token_headers,
#         json=data,
#     )
#     assert r.status_code == 403


# def test_retrieve_users(
#     client: TestClient, superuser_token_headers: dict[str, str], db_transaction: Session
# ) -> None:
#     username = random_email()
#     password = random_lower_string()
#     user_in = UserCreate(email=username, password=password)
#     crud.create_user(session=db_transaction, user_create=user_in)

#     username2 = random_email()
#     password2 = random_lower_string()
#     user_in2 = UserCreate(email=username2, password=password2)
#     crud.create_user(session=db_transaction, user_create=user_in2)

#     r = client.get(f"{settings.API_V1_STR}/users/", headers=superuser_token_headers)
#     all_users = r.json()

#     assert len(all_users["data"]) > 1
#     assert "count" in all_users
#     for item in all_users["data"]:
#         assert "email" in item


# def test_update_password_me(
#     client: TestClient, superuser_token_headers: dict[str, str], db_transaction: Session
# ) -> None:
#     new_password = random_lower_string()
#     data = {
#         "current_password": settings.FIRST_SUPERUSER_PASSWORD,
#         "new_password": new_password,
#     }
#     r = client.patch(
#         f"{settings.API_V1_STR}/users/me/password",
#         headers=superuser_token_headers,
#         json=data,
#     )
#     assert r.status_code == 200
#     updated_user = r.json()
#     assert updated_user["message"] == "Password updated successfully"

#     user_query = select(User).where(User.email == settings.FIRST_SUPERUSER)
#     user_db_transaction = db_transaction.exec(user_query).first()
#     assert user_db_transaction
#     assert user_db_transaction.email == settings.FIRST_SUPERUSER
#     assert verify_password(new_password, user_db_transaction.hashed_password)


# def test_update_password_me_incorrect_password(
#     client: TestClient, superuser_token_headers: dict[str, str]
# ) -> None:
#     new_password = random_lower_string()
#     data = {"current_password": new_password, "new_password": new_password}
#     r = client.patch(
#         f"{settings.API_V1_STR}/users/me/password",
#         headers=superuser_token_headers,
#         json=data,
#     )
#     assert r.status_code == 400
#     updated_user = r.json()
#     assert updated_user["detail"] == "Incorrect password"


# def test_update_user_me_email_exists(
#     client: TestClient,
#     normal_user_token_headers: dict[str, str],
#     db_transaction: Session,
# ) -> None:
#     username = random_email()
#     password = random_lower_string()
#     user_in = UserCreate(email=username, password=password)
#     user = crud.create_user(session=db_transaction, user_create=user_in)

#     data = {"email": user.email}
#     r = client.patch(
#         f"{settings.API_V1_STR}/users/me",
#         headers=normal_user_token_headers,
#         json=data,
#     )
#     assert r.status_code == 409
#     assert r.json()["detail"] == "User with this email already exists"


# def test_update_password_me_same_password_error(
#     client: TestClient, superuser_token_headers: dict[str, str]
# ) -> None:
#     data = {
#         "current_password": settings.FIRST_SUPERUSER_PASSWORD,
#         "new_password": settings.FIRST_SUPERUSER_PASSWORD,
#     }
#     r = client.patch(
#         f"{settings.API_V1_STR}/users/me/password",
#         headers=superuser_token_headers,
#         json=data,
#     )
#     assert r.status_code == 400
#     updated_user = r.json()
#     assert (
#         updated_user["detail"] == "New password cannot be the same as the current one"
#     )


# def test_register_user(client: TestClient, db_transaction: Session) -> None:
#     username = random_email()
#     password = random_lower_string()
#     data = {"email": username, "password": password}
#     r = client.post(
#         f"{settings.API_V1_STR}/users/signup",
#         json=data,
#     )
#     assert r.status_code == 200
#     created_user = r.json()
#     assert created_user["email"] == username

#     user_query = select(User).where(User.email == username)
#     user_db_transaction = db_transaction.exec(user_query).first()
#     assert user_db_transaction
#     assert user_db_transaction.email == username
#     assert verify_password(password, user_db_transaction.hashed_password)


# def test_register_user_already_exists_error(client: TestClient) -> None:
#     password = random_lower_string()
#     data = {
#         "email": settings.FIRST_SUPERUSER,
#         "password": password,
#     }
#     r = client.post(
#         f"{settings.API_V1_STR}/users/signup",
#         json=data,
#     )
#     assert r.status_code == 400
#     assert r.json()["detail"] == "The user with this email already exists in the system"


# def test_update_user_email_exists(
#     client: TestClient, superuser_token_headers: dict[str, str], db_transaction: Session
# ) -> None:
#     username = random_email()
#     password = random_lower_string()
#     user_in = UserCreate(email=username, password=password)
#     user = crud.create_user(session=db_transaction, user_create=user_in)

#     username2 = random_email()
#     password2 = random_lower_string()
#     user_in2 = UserCreate(email=username2, password=password2)
#     user2 = crud.create_user(session=db_transaction, user_create=user_in2)

#     data = {"email": user2.email}
#     r = client.patch(
#         f"{settings.API_V1_STR}/users/{user.id}",
#         headers=superuser_token_headers,
#         json=data,
#     )
#     assert r.status_code == 409
#     assert r.json()["detail"] == "User with this email already exists"


# def test_delete_user_me(client: TestClient, db_transaction: Session) -> None:
#     username = random_email()
#     password = random_lower_string()
#     user_in = UserCreate(email=username, password=password)
#     user = crud.create_user(session=db_transaction, user_create=user_in)
#     user_id = user.id

#     login_data = {
#         "username": username,
#         "password": password,
#     }
#     r = client.post(f"{settings.API_V1_STR}/login/access-token", data=login_data)
#     tokens = r.json()
#     a_token = tokens["access_token"]
#     headers = {"Authorization": f"Bearer {a_token}"}

#     r = client.delete(
#         f"{settings.API_V1_STR}/users/me",
#         headers=headers,
#     )
#     assert r.status_code == 200
#     deleted_user = r.json()
#     assert deleted_user["message"] == "User deleted successfully"
#     result = db_transaction.exec(select(User).where(User.id == user_id)).first()
#     assert result is None

#     user_query = select(User).where(User.id == user_id)
#     user_db_transaction = db_transaction.execute(user_query).first()
#     assert user_db_transaction is None


# def test_delete_user_me_as_superuser(
#     client: TestClient, superuser_token_headers: dict[str, str]
# ) -> None:
#     r = client.delete(
#         f"{settings.API_V1_STR}/users/me",
#         headers=superuser_token_headers,
#     )
#     assert r.status_code == 403
#     response = r.json()
#     assert response["detail"] == "Super users are not allowed to delete themselves"


# def test_delete_user_super_user(
#     client: TestClient, superuser_token_headers: dict[str, str], db_transaction: Session
# ) -> None:
#     username = random_email()
#     password = random_lower_string()
#     user_in = UserCreate(email=username, password=password)
#     user = crud.create_user(session=db_transaction, user_create=user_in)
#     user_id = user.id
#     r = client.delete(
#         f"{settings.API_V1_STR}/users/{user_id}",
#         headers=superuser_token_headers,
#     )
#     assert r.status_code == 200
#     deleted_user = r.json()
#     assert deleted_user["message"] == "User deleted successfully"
#     result = db_transaction.exec(select(User).where(User.id == user_id)).first()
#     assert result is None


# def test_delete_user_not_found(
#     client: TestClient, superuser_token_headers: dict[str, str]
# ) -> None:
#     r = client.delete(
#         f"{settings.API_V1_STR}/users/{uuid.uuid4()}",
#         headers=superuser_token_headers,
#     )
#     assert r.status_code == 404
#     assert r.json()["detail"] == "User not found"


# def test_delete_user_current_super_user_error(
#     client: TestClient, superuser_token_headers: dict[str, str], db_transaction: Session
# ) -> None:
#     super_user = crud.get_user_by_email(
#         session=db_transaction, email=settings.FIRST_SUPERUSER
#     )
#     assert super_user
#     user_id = super_user.id

#     r = client.delete(
#         f"{settings.API_V1_STR}/users/{user_id}",
#         headers=superuser_token_headers,
#     )
#     assert r.status_code == 403
#     assert r.json()["detail"] == "Super users are not allowed to delete themselves"


# def test_delete_user_without_privileges(
#     client: TestClient,
#     normal_user_token_headers: dict[str, str],
#     db_transaction: Session,
# ) -> None:
#     username = random_email()
#     password = random_lower_string()
#     user_in = UserCreate(email=username, password=password)
#     user = crud.create_user(session=db_transaction, user_create=user_in)

#     r = client.delete(
#         f"{settings.API_V1_STR}/users/{user.id}",
#         headers=normal_user_token_headers,
#     )
#     assert r.status_code == 403
#     assert r.json()["detail"] == "The user doesn't have enough privileges"


# def test_search_users(
#     client: TestClient,
#     test_users: list[UserWithFriendInfoPublic],
#     normal_user_token_headers: dict[str, str],
# ) -> None:
#     assert len(test_users) > 0
#     assert any(user.display_name == "alice" for user in test_users)
#     search_query = "alice"
#     r = client.get(
#         f"{settings.API_V1_STR}/users/search",
#         params={"query": search_query},
#         headers=normal_user_token_headers,
#     )
#     assert r.status_code == 200
#     users_with_alice_query = [
#         UserPublic.model_validate(user_dict) for user_dict in r.json()
#     ]
#     assert len(users_with_alice_query) == 1
#     alice_user = users_with_alice_query[0]
#     assert alice_user.display_name == "alice"


from uuid import UUID, uuid4

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


def test_friend_status_with_no_relationship(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    user_factory,
) -> None:
    other_user = user_factory()

    response = client.get(
        f"{settings.API_V1_STR}/users/{other_user.id}/friend-status",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_friend"] is False
    assert body["sent_request"] is False
    assert body["received_request"] is False


def test_friend_status_reflects_a_sent_request_from_both_angles(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
) -> None:
    current_user_id = _normal_user_id(db_transaction)
    other_user = user_factory(password="password")
    other_headers = user_authentication_headers(
        client=client, email=other_user.email, password="password"
    )

    friendship_crud.create_friend_request(
        session=db_transaction,
        sender_id=current_user_id,
        receiver_id=other_user.id,
    )
    db_transaction.commit()

    # Queried by the sender: sent_request is True, received_request is False.
    from_sender = client.get(
        f"{settings.API_V1_STR}/users/{other_user.id}/friend-status",
        headers=normal_user_token_headers,
    )
    assert from_sender.status_code == 200
    sender_body = from_sender.json()
    assert sender_body["sent_request"] is True
    assert sender_body["received_request"] is False
    assert sender_body["is_friend"] is False

    # Queried by the receiver (looking at the sender): received_request is True.
    from_receiver = client.get(
        f"{settings.API_V1_STR}/users/{current_user_id}/friend-status",
        headers=other_headers,
    )
    assert from_receiver.status_code == 200
    receiver_body = from_receiver.json()
    assert receiver_body["received_request"] is True
    assert receiver_body["sent_request"] is False
    assert receiver_body["is_friend"] is False


def test_friend_status_when_already_friends(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    user_factory,
) -> None:
    current_user_id = _normal_user_id(db_transaction)
    other_user = user_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=current_user_id, friend_id=other_user.id
    )
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/users/{other_user.id}/friend-status",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_friend"] is True
    assert body["sent_request"] is False
    assert body["received_request"] is False


def test_friend_status_for_nonexistent_user_returns_404(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/users/{uuid4()}/friend-status",
        headers=normal_user_token_headers,
    )

    assert response.status_code == 404


def test_friend_status_requires_authentication(
    client: TestClient,
    user_factory,
) -> None:
    other_user = user_factory()

    response = client.get(
        f"{settings.API_V1_STR}/users/{other_user.id}/friend-status",
    )

    assert response.status_code == 401
