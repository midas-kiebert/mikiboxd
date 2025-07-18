import os
from collections.abc import Generator

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy_utils import (  # type: ignore[import-untyped]
    create_database,
    database_exists,
    drop_database,
)
from sqlmodel import Session

from app.api.deps import get_db
from app.core.config import settings
from app.core.db import init_db
from app.main import app
from app.tests.utils.user import authentication_token_from_email
from app.tests.utils.utils import get_superuser_token_headers

from .fixtures.letterboxd import *
from .fixtures.users import *

TEST_DATABASE_URL = str(settings.SQLALCHEMY_DATABASE_URI_TEST)
ALEMBIC_CFG_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "alembic.ini")


@pytest.fixture(scope="session", autouse=True)
def create_test_database() -> Generator[Engine, None, None]:
    assert os.getenv("TESTING") == "true"
    assert "test" in TEST_DATABASE_URL

    if database_exists(TEST_DATABASE_URL):
        drop_database(TEST_DATABASE_URL)
    create_database(TEST_DATABASE_URL)

    engine = create_engine(TEST_DATABASE_URL)

    alembic_cfg = Config(ALEMBIC_CFG_PATH)
    alembic_cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.upgrade(alembic_cfg, "head")

    with Session(engine) as session:
        init_db(session)

    yield engine


@pytest.fixture(scope="function", autouse=True)
def db_transaction(create_test_database: Engine) -> Generator[Session, None, None]:
    connection = create_test_database.connect()
    transaction = connection.begin()

    session = Session(bind=connection)

    def override_get_db() -> Generator[Session, None, None]:
        try:
            yield session
        finally:
            session.close()

    app.dependency_overrides[get_db] = override_get_db

    yield session

    session.close()
    transaction.rollback()
    connection.close()
    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="function")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="function")
def normal_user_token_headers(
    client: TestClient, db_transaction: Session
) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db_transaction
    )
