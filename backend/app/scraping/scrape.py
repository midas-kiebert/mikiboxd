from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.cinemas.amsterdam.eye import EyeScraper
from app.scraping.cinemas.amsterdam.fchyena import FCHyenaScraper
from app.scraping.cinemas.amsterdam.filmhallen import FilmHallenScraper
from app.scraping.cinemas.amsterdam.kriterion import KriterionScraper
from app.scraping.cinemas.amsterdam.lab111 import LAB111Scraper
from app.scraping.cinemas.amsterdam.themovies import TheMoviesScraper
from app.scraping.cinemas.amsterdam.uitkijk import UitkijkScraper
from app.scraping.logger import logger
from app.scraping.tmdb import find_tmdb_id
from app.services import movies as movies_service
from app.services import showtimes as showtimes_service
from app.utils import clean_title, to_amsterdam_time

from . import get_movies, get_showtimes
from .letterboxd.load_letterboxd_data import scrape_letterboxd

SCRAPERS = [
    EyeScraper,
    FCHyenaScraper,
    LAB111Scraper,
    UitkijkScraper,
    KriterionScraper,
    TheMoviesScraper,
    FilmHallenScraper,
]


def scrape_cineville():
    movies_data = get_movies.get_movies_json()
    for movie_data in movies_data:
        title_query = clean_title(movie_data.title)
        actors = movie_data.cast
        actor = actors[0] if actors else None
        directors = movie_data.directors
        director = directors[0] if directors else None

        tmdb_id = find_tmdb_id(
            title_query=title_query,
            actor_name=actor,
            director_name=director,
        )
        if tmdb_id is None:
            logger.warning(f"TMDB ID not found for movie: {title_query}")
            continue

        letterboxd_data = scrape_letterboxd(tmdb_id)
        if letterboxd_data is None:
            logger.warning(f"Letterboxd data not found for TMDB ID: {tmdb_id}")
            continue

        movie = MovieCreate(
            title=letterboxd_data.title,
            id=tmdb_id,
            poster_link=letterboxd_data.poster_url,
            letterboxd_slug=letterboxd_data.slug,
            top250=letterboxd_data.top250,
            directors=letterboxd_data.directors,
            release_year=letterboxd_data.release_year,
            rating=letterboxd_data.rating,
            original_title=letterboxd_data.original_title,
        )

        with get_db_context() as session:
            movie = movies_service.upsert_movie(
                session=session,
                movie_create=movie,
            )
        logger.info(
            f"Inserted movie: {letterboxd_data.title} (TMDB ID: {tmdb_id}, Letterboxd slug: {letterboxd_data.slug})"
        )

        showtimes_data = get_showtimes.get_showtimes_json(productionId=movie_data.id)
        for showtime_data in showtimes_data:
            with get_db_context() as session:
                try:
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
                        f"Inserted showtime for movie: {letterboxd_data.title} at {showtime_data.venueName} on {start_date}"
                    )
                except Exception as e:
                    logger.error(
                        f"Failed to insert showtime for movie: {letterboxd_data.title} at {showtime_data.venueName} on {start_date}. Error: {e}"
                    )


def run_cinema_scrapers():
    for scraper_class in SCRAPERS:
        scraper: BaseCinemaScraper = scraper_class()
        try:
            scraper.scrape()
        except Exception:
            logger.exception(
                f"Error occurred while scraping with {scraper_class.__name__}"
            )


if __name__ == "__main__":
    logger.info("Starting Cineville scraping...")
    scrape_cineville()
    logger.info("Cineville scraping completed.")
    logger.info("Starting cinema scrapers...")
    run_cinema_scrapers()
    logger.info("Cinema scrapers completed.")
