"""One-off backfill: populate Movie.original_language from TMDB.

The original_language column was added after movies already existed, so
every pre-existing row starts NULL. This re-fetches TMDB details (a single
cheap call per movie, no append_to_response needed) for movies missing the
column and writes the result. Run once after deploying the migration:

    python scripts/backfill-movie-original-language.py
"""

import time

from sqlmodel import col, select

from app.api.deps import get_db_context
from app.models.movie import Movie
from app.scraping import tmdb_lookup as tmdb_core

REQUEST_DELAY_SECONDS = 0.05


def backfill_original_language() -> None:
    with get_db_context() as session:
        movie_ids = list(
            session.exec(
                select(Movie.id).where(col(Movie.original_language).is_(None))
            ).all()
        )

    print(f"Backfilling original_language for {len(movie_ids)} movies")
    updated = 0
    skipped = 0
    for movie_id in movie_ids:
        details = tmdb_core.fetch_tmdb_movie_details_sync(movie_id)
        if details is None or details.original_language is None:
            skipped += 1
            time.sleep(REQUEST_DELAY_SECONDS)
            continue

        with get_db_context() as session:
            movie = session.get(Movie, movie_id)
            if movie is not None and movie.original_language is None:
                movie.original_language = details.original_language
                session.add(movie)
                session.commit()
                updated += 1

        time.sleep(REQUEST_DELAY_SECONDS)

    print(f"Done. Updated {updated}, skipped {skipped} (no TMDB data available)")


if __name__ == "__main__":
    backfill_original_language()
