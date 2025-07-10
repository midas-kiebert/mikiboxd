import os

os.environ["TESTING"] = "true"

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, text

from app.core.config import settings
from app.core.db import test_engine, init_db
from app.main import app
from app.models import Item, User
from app.tests.utils.user import authentication_token_from_email
from app.tests.utils.utils import get_superuser_token_headers
from alembic.config import Config
from alembic import command


@pytest.fixture(scope="session", autouse=True)
def run_migrations():
    """Run alembic migrations on test DB before any tests start."""
    alembic_cfg = Config("alembic.ini")  # path to your alembic.ini
    command.upgrade(alembic_cfg, "head")
    yield



@pytest.fixture(scope="session", autouse=True)
def db(run_migrations) -> Generator[Session, None, None]:
    with Session(test_engine) as session:
        init_db(session)
        yield session
        # statement = delete(Item)
        # session.execute(statement)
        # statement = delete(User)
        # session.execute(statement)
        session.commit()


@pytest.fixture(scope="module")
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
