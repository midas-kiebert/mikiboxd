from typing import Protocol

import pytest
from sqlmodel import Session

from app import crud
from app.models import User, UserCreate
from app.tests.utils.utils import random_email, random_lower_string

__all__ = [
    "user_factory",
    "test_users",
]


class UserFactory(Protocol):
    def __call__(
        self,
        *,
        email: str | None = None,
        password: str | None = None,
        display_name: str | None = None,
        # is_superuser: bool = False,
    ) -> User: ...


@pytest.fixture
def user_factory(db_transaction: Session) -> UserFactory:
    def factory(
        *,
        email: str | None = None,
        password: str | None = None,
        display_name: str | None = None,
        # is_superuser: bool = False,
    ) -> User:
        email = email or random_email()
        password = password or random_lower_string()
        user_in = UserCreate(
            email=email,
            password=password,
            display_name=display_name or random_lower_string(),
            # is_superuser=is_superuser,
        )
        user = crud.create_user(
            session=db_transaction,
            user_create=user_in,
        )
        return user

    return factory


TEST_USERS: list[tuple[str, str]] = [
    ("alice@example.com", "alice"),
    ("bob@example.com", "bob"),
    ("charlie@example.com", "charlie"),
    ("dennis@example.com", "dennis"),
    ("eric@example.com", "eric"),
    ("bobby@example.com", "bobby"),
    ("charles@example.com", "charles"),
]


@pytest.fixture
def test_users(user_factory: UserFactory) -> list[User]:
    users: list[User] = []
    for email, display_name in TEST_USERS:
        user = user_factory(email=email, display_name=display_name)
        users.append(user)
    return users
