import re
from datetime import datetime
from zoneinfo import ZoneInfo

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.logger import logger
from app.scraping.tmdb import find_tmdb_id
from app.services import movies as movies_service
from app.services import showtimes as showtimes_service

from . import get_movies, get_showtimes
from .load_letterboxd_slugs import get_letterboxd_slug


def to_amsterdam_time(dt: str) -> datetime:
    """Convert UTC datetime string to Amsterdam time."""
    utc_dt = datetime.strptime(dt, "%Y-%m-%dT%H:%M:%S.%fZ").replace(
        tzinfo=ZoneInfo("UTC")
    )
    amsterdam_tz = ZoneInfo("Europe/Amsterdam")
    amsterdam_dt = utc_dt.astimezone(amsterdam_tz)
    amsterdam_naive = amsterdam_dt.replace(tzinfo=None)  # Convert to naive datetime
    return amsterdam_naive


def clean_title(title: str) -> str:
    title = title.lower()
    title = re.sub(r"\(.*\)", "", title)  # Remove everything in parentheses
    title = re.sub(r"\b-.*$", "", title)  # Remove everything starting from "-"
    title = re.sub(r"\s+", " ", title).strip()  # Normalize whitespace
    return title


def scrape_cineville():
    movies_data = get_movies.get_movies_json()
    for movie_data in movies_data:
        title_query = clean_title(movie_data.title)
        actors = movie_data.cast
        actor = actors[0] if actors else None
        directors = movie_data.directors
        director = directors[0] if directors else None

        ret = find_tmdb_id(
            title_query=title_query,
            actor_name=actor,
            director_name=director,
        )
        if ret is None:
            logger.warning(f"TMDB ID not found for movie: {title_query}")
            continue
        title, tmdb_id, posterUrl = ret
        tmdb_id = int(tmdb_id)

        letterboxd_slug = get_letterboxd_slug(tmdb_id)
        if letterboxd_slug is None:
            logger.warning(f"Letterboxd slug not found for TMDB ID: {tmdb_id}")
            continue

        movie = MovieCreate(
            title=title,
            id=tmdb_id,
            poster_link=posterUrl,
            letterboxd_slug=letterboxd_slug,
        )

        with get_db_context() as session:
            movie = movies_service.insert_movie_if_not_exists(
                session=session,
                movie_create=movie,
            )
        logger.info(
            f"Inserted movie: {title} (TMDB ID: {tmdb_id}, Letterboxd slug: {letterboxd_slug})"
        )

        showtimes_data = get_showtimes.get_showtimes_json(productionId=movie_data.id)
        for showtime_data in showtimes_data:
            with get_db_context() as session:
                startdate_utc = showtime_data.startDate
                start_date = to_amsterdam_time(startdate_utc)
                venue_name = showtime_data.venueName
                ticket_url = showtime_data.ticketUrl

                cinema_id = cinema_crud.get_cinema_id_by_name(
                    session=session,
                    name=venue_name,
                )

                showtime = ShowtimeCreate(
                    datetime=start_date,
                    ticket_link=ticket_url,
                    movie_id=tmdb_id,
                    cinema_id=cinema_id,
                )

                showtimes_service.insert_showtime_if_not_exists(
                    session=session,
                    showtime_create=showtime,
                )
                logger.info(
                    f"Inserted showtime for movie: {title} at {showtime_data.venueName} on {start_date}"
                )


if __name__ == "__main__":
    logger.info("Starting Cineville scraping...")
    scrape_cineville()
    logger.info("Cineville scraping completed.")
