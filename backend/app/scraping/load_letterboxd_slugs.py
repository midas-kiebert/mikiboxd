import requests
from tqdm import tqdm

from app.api.deps import get_db_context
from app.crud import movie as movie_crud
from app.models.movie import MovieUpdate

# from app.logging_.logger import setup_logger
# logger = setup_logger(__name__)
from app.scraping.logger import logger
from app.services import movies as movies_services


def get_letterboxd_slug(tmdb_id: int) -> str | None:
    url = f"https://letterboxd.com/tmdb/{tmdb_id}/"
    headers = {
        "referer": "https://letterboxd.com",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "allow-redirects": "true",
    }

    response = requests.get(url, headers=headers)
    if response.status_code != 200:
        logger.warning(
            "Failed to fetch page for TMDB ID:",
            tmdb_id,
            "Status code:",
            response.status_code,
        )
        return None
    final_url = response.url
    slug = final_url.split("/")[-2]
    return slug


def load_letterboxd_slugs() -> None:
    with get_db_context() as session:
        # Fetch movies without Letterboxd slug
        movies = movie_crud.get_movies_without_letterboxd_slug(session=session)
        if not movies:
            logger.info("No movies found without Letterboxd slug.")
            return

        for movie in tqdm(movies):
            slug = get_letterboxd_slug(movie.id)
            if not slug:
                logger.warning(f"Skipping TMDB ID {movie.id} due to missing slug.")
                continue
            update = MovieUpdate(letterboxd_slug=slug)
            movies_services.update_movie(
                session=session,
                movie_id=movie.id,
                movie_update=update,
            )


if __name__ == "__main__":
    load_letterboxd_slugs()
