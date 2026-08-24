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

from sqlmodel import Session, col, create_engine, select, update

from app.core.config import settings
from app.core.enums import Environment
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


# Accounts that get `is_pro` in production. There is no paid tier and no way to
# buy this — it is a list of people, and the only thing it currently unlocks is
# the sold-out watch, whose whole cost model assumes the list stays this short.
PRODUCTION_PRO_EMAILS = ("mikino@midaskiebert.nl",)


def _seed_pro_users(session: Session) -> None:
    """Grant `is_pro` to whoever should have it in this environment.

    Outside production everyone gets it, because the point of staging is to
    exercise the feature; in production it is the named accounts and nobody
    else. Run on every startup, and only ever grants — revoking someone is a
    deliberate act, not something a redeploy should do behind your back.

    A Core `UPDATE`, deliberately not `select(User)` + ORM writes: loading a
    `User` row deserializes every column, including `notify_channel_*`, whose
    mapped type has no `values_callable` and so expects the enum's uppercase
    member names — but existing rows carry the lowercase values an old
    migration's raw-SQL default wrote, and reading one throws. Nothing before
    this function ever did a broad `select(User)`, so that mismatch had never
    been exercised. An `UPDATE` never decodes the row, only writes one column,
    so it sidesteps the bug instead of tripping over it.
    """
    stmt = update(User).where(col(User.is_pro).is_(False)).values(is_pro=True)
    if settings.ENVIRONMENT == Environment.PRODUCTION:
        stmt = stmt.where(col(User.email).in_(PRODUCTION_PRO_EMAILS))
    result = session.exec(stmt)  # type: ignore[call-overload]
    if result.rowcount:
        session.commit()


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

    # Promote known test accounts to superuser. The watchlist digest is
    # gated to superusers outside production, so this account needs the flag
    # to test it on dev/staging.
    midas = session.exec(
        select(User).where(User.email == "mikino@midaskiebert.nl")
    ).first()
    if midas is not None and not midas.is_superuser:
        midas.is_superuser = True
        session.add(midas)
        session.commit()

    _seed_pro_users(session)

    # Seed the curated Letterboxd lists from configs/letterboxd_lists.yaml.
    # Idempotent: existing lists are left untouched. Films are populated lazily
    # on the list's first sync, not here (no scraping at seed time).
    from app.services.letterboxd_lists import seed_curated_lists

    seed_curated_lists(session=session)
