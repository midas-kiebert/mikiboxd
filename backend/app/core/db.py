"""Database engine and initialization.

This module creates the SQLAlchemy engine (the connection pool to PostgreSQL)
and exposes `init_db`, which seeds the first superuser on a fresh installation.

The engine is a module-level singleton — it is created once when the application
starts and reused for the lifetime of the process. SQLModel sessions are opened
per-request via the `get_db` dependency in `api/deps.py`.

The test engine (`test_engine`) points at a separate `<db>_test` database and
is only intended to be used by the test suite. It shares the same pool settings
as the main engine.
"""

from sqlmodel import Session, create_engine, select

from app.core.config import settings
from app.crud import user as user_crud
from app.models.user import User, UserCreate

# Pool settings are read from config so they can be tuned per environment
# without changing code. See config.py for explanations of each option.
_engine_options = {
    "pool_size": settings.SQLALCHEMY_POOL_SIZE,
    "max_overflow": settings.SQLALCHEMY_MAX_OVERFLOW,
    "pool_timeout": settings.SQLALCHEMY_POOL_TIMEOUT_SECONDS,
    "pool_recycle": settings.SQLALCHEMY_POOL_RECYCLE_SECONDS,
    "pool_pre_ping": settings.SQLALCHEMY_POOL_PRE_PING,
}

# Main application engine — connects to the primary database.
engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI), **_engine_options)

# Test engine — connects to a separate `<db>_test` database so tests never
# touch production data. Only import this from test code (conftest.py).
test_engine = create_engine(
    str(settings.SQLALCHEMY_DATABASE_URI_TEST), **_engine_options
)


def init_db(session: Session) -> None:
    """Seed the database with required initial data on first startup.

    This is called by the prestart script before the application server launches.
    It is safe to call multiple times — it checks for existence before creating.

    Note: Tables must already exist (created by Alembic migrations) before this
    function is called. This function only seeds *data*, not schema.

    Args:
        session: An open database session to use for queries and inserts.
    """
    # Create the superuser if it doesn't exist yet. The credentials come from
    # FIRST_SUPERUSER and FIRST_SUPERUSER_PASSWORD in the environment.
    user = session.exec(
        select(User).where(User.email == settings.FIRST_SUPERUSER)
    ).first()
    if not user:
        user_in = UserCreate(
            email=settings.FIRST_SUPERUSER,
            password=settings.FIRST_SUPERUSER_PASSWORD,
            is_superuser=True,
        )
        user_crud.create_user(session=session, user_create=user_in)

    session.commit()

    # Seed the curated Letterboxd lists from configs/letterboxd_lists.yaml.
    # Idempotent: existing lists are left untouched. Films are populated lazily
    # on the list's first sync, not here (no scraping at seed time).
    from app.services.letterboxd_lists import seed_curated_lists

    seed_curated_lists(session=session)
