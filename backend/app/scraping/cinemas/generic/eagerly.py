import re
from datetime import datetime
from re import sub

import requests

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.letterboxd.load_letterboxd_data import scrape_letterboxd
from app.scraping.logger import logger
from app.scraping.tmdb import find_tmdb_id
from app.services import movies as movies_service
from app.services import showtimes as showtimes_service

# Generic scraper for cinemas using the Eagerly website.


def clean_title(title: str) -> str:
    title = title.lower()
    title = re.sub(r"-\d{4}$", "", title)  # Remove trailing -YEAR (e.g., -1967)
    title = re.sub(r"-ov$", "", title)  # Remove trailing -ov
    title = title.replace("-", " ")  # Replace all hyphens with spaces
    title = re.sub(r"\s+", " ", title).strip()  # Normalize whitespace
    return title


class GenericEagerlyScraper(BaseCinemaScraper):
    def __init__(self, cinema: str, url_base: str, theatre_filter: str = "") -> None:
        self.cinema = cinema
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_name(
                session=session, name=cinema
            )
            if not self.cinema_id:
                logger.error(f"Cinema {cinema} not found in database")
                raise ValueError(f"Cinema {cinema} not found in database")

        self.url_base = url_base
        self.url = f"{url_base}/fk-feed/agenda"
        self.theatre_filter = theatre_filter  # For Leiden

        self.movies: list[MovieCreate] = []
        self.showtimes: list[ShowtimeCreate] = []

    def scrape(self) -> None:
        # logger.trace(f"Running {self.cinema} scraper...")
        response = requests.get(self.url)
        response.raise_for_status()

        data = response.json()

        if not data:
            logger.debug(f"No data found for cinema {self.cinema}")
            raise Exception

        for slug, value in data.items():
            if not value.get("times"):
                continue
            title_query = clean_title(slug)
            directors_str = value["director_name"]
            directors = [director.strip() for director in directors_str["value"].split(",")]
            # get actor, removing text within parenthesis (such as (voice))
            actor = sub(
                r"\s*\([^)]*\)", "", value["starring_short"].split(",")[0].strip()
            )
            # logger.trace(f"query: {title_query}, {director}, {actor}")
            # Try to find the tmdb_id
            tmdb_id = find_tmdb_id(
                title_query=title_query, director_names=directors, actor_name=actor
            )

            if not tmdb_id:
                logger.warning(f"No TMDB ID found for {title_query}, skipping")
                continue

            # Get letterboxd data
            letterboxd_data = scrape_letterboxd(tmdb_id)

            if not letterboxd_data:
                logger.warning(f"Letterboxd data not found for TMDB ID: {tmdb_id}")
                continue

            # Get film from the database, check on id first
            # Add into the database if needed
            logger.debug(f"Found TMDB id {tmdb_id} for {letterboxd_data.title}")
            movie = MovieCreate(
                id=int(tmdb_id),
                title=letterboxd_data.title,
                poster_link=letterboxd_data.poster_url,
                letterboxd_slug=letterboxd_data.slug,
                top250=letterboxd_data.top250,
                directors=letterboxd_data.directors,
                release_year=letterboxd_data.release_year,
                rating=letterboxd_data.rating,
                original_title=letterboxd_data.original_title,
            )
            self.movies.append(movie)

            # Get showtimes
            for time in value["times"]:
                theatre: str = time["location"]
                if not theatre.startswith(self.theatre_filter):
                    continue
                date = datetime.strptime(time["program_start"], "%Y%m%d%H%M")
                ticket_link = f"{self.url_base}/tickets/{time['provider_id']}"
                # logger.trace(f"Found showtime: {date} at {theatre} for {title} ({tmdb_id}), with ticket link {ticket_link}")
                if not self.cinema_id:
                    logger.error(
                        f"Cinema ID not found for {self.cinema}, skipping showtime"
                    )
                    continue
                showtime = ShowtimeCreate(
                    movie_id=movie.id,
                    datetime=date,
                    cinema_id=self.cinema_id,
                    ticket_link=ticket_link,
                )
                self.showtimes.append(showtime)
        with get_db_context() as session:
            # logger.trace(f"Inserting {len(self.movies)} movies and {len(self.showtimes)} showtimes")
            for movie_create in self.movies:
                movies_service.insert_movie_if_not_exists(
                    session=session, movie_create=movie_create
                )
            for showtime_create in self.showtimes:
                showtimes_service.insert_showtime_if_not_exists(
                    session=session, showtime_create=showtime_create
                )
