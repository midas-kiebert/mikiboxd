"""One-off backfill: populate Movie.description from TMDB.

The description column was added after movies already existed (migration
e2f4a6c8b0d2), so every pre-existing row starts NULL. This re-fetches TMDB
details for movies missing a description and writes the result. Safe to
rerun; only touches rows where description IS NULL. Run once after
deploying the migration:

    python scripts/backfill-movie-description.py
"""

import time

from sqlmodel import col, select

from app.api.deps import get_db_context
from app.models.movie import Movie
from app.scraping import tmdb_lookup as tmdb_core

REQUEST_DELAY_SECONDS = 0.05


def backfill_description() -> None:
    with get_db_context() as session:
        movie_ids = list(
            session.exec(
                select(Movie.id).where(col(Movie.description).is_(None))
            ).all()
        )

    print(f"Backfilling description for {len(movie_ids)} movies")
    updated = 0
    skipped = 0
    for movie_id in movie_ids:
        details = tmdb_core.fetch_tmdb_movie_details_sync(movie_id)
        if details is None or details.description is None:
            skipped += 1
            time.sleep(REQUEST_DELAY_SECONDS)
            continue

        with get_db_context() as session:
            movie = session.get(Movie, movie_id)
            if movie is not None and movie.description is None:
                movie.description = details.description
                session.add(movie)
                session.commit()
                updated += 1

        time.sleep(REQUEST_DELAY_SECONDS)

    print(f"Done. Updated {updated}, skipped {skipped} (no TMDB data available)")


if __name__ == "__main__":
    backfill_description()
