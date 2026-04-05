"""Pre-start readiness check.

Runs before the application server starts. Retries the database connection
until it succeeds or the timeout is reached, ensuring the app never starts
with a broken DB connection.
"""

import logging

from sqlalchemy import Engine
from sqlmodel import Session, select
from tenacity import after_log, before_log, retry, stop_after_attempt, wait_fixed

from app.core.db import engine

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Retry for up to 5 minutes (300 attempts, 1 second apart).
_MAX_TRIES = 60 * 5
_WAIT_SECONDS = 1


@retry(
    stop=stop_after_attempt(_MAX_TRIES),
    wait=wait_fixed(_WAIT_SECONDS),
    # Log each attempt at INFO level before, and WARNING level after failure.
    before=before_log(logger, logging.INFO),
    after=after_log(logger, logging.WARNING),
)
def _wait_for_db(db_engine: Engine) -> None:
    """Attempt a single DB connection. Tenacity retries this on failure."""
    with Session(db_engine) as session:
        session.exec(select(1))


def main() -> None:
    logger.info("Waiting for database...")
    _wait_for_db(engine)
    logger.info("Database ready.")


if __name__ == "__main__":
    main()
