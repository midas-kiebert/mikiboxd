"""Entrypoint script to seed the database with required initial data.

Opens a real database session and delegates to `core.db.init_db`, which
contains the actual seeding logic. This separation keeps the logic testable
(init_db accepts any session) while this script handles the real-DB wiring.

Safe to re-run — all operations in init_db check for existence first.

Usage:
    uv run python -m app.initial_data
"""

import logging

from sqlmodel import Session

from app.core.db import engine, init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def main() -> None:
    logger.info("Seeding initial data...")
    with Session(engine) as session:
        init_db(session)
    logger.info("Done.")


if __name__ == "__main__":
    main()
