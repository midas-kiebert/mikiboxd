import requests
from re import sub
from datetime import datetime
from app.models import MovieCreate, ShowtimeCreate
from app.scraping.tmdb import find_tmdb_id
from app.scraping import BaseCinemaScraper
import re
from app import crud
from app.api.deps import get_db_context

from app.scraping import logger

# Generic scraper for cinemas using the Eagerly website.

def clean_title(title: str) -> str:
        title = title.lower()
        title = re.sub(r'-\d{4}$', '', title)        # Remove trailing -YEAR (e.g., -1967)
        title = re.sub(r'-ov$', '', title)           # Remove trailing -ov
        title = title.replace('-', ' ')              # Replace all hyphens with spaces
        title = re.sub(r'\s+', ' ', title).strip()   # Normalize whitespace
        return title


class GenericEagerlyScraper(BaseCinemaScraper):
    def __init__(self, cinema: str, url_base: str, theatre_filter: str = "") -> None:
        self.cinema = cinema
        with get_db_context() as session:
            self.cinema_id = crud.get_cinema_id_by_name(session=session, name=cinema)
            if not self.cinema_id:
                logger.error(f"Cinema {cinema} not found in database")
                raise ValueError(f"Cinema {cinema} not found in database")

        self.url_base = url_base
        self.url = f"{url_base}/fk-feed/agenda"
        self.theatre_filter=theatre_filter # For Leiden

        self.movies: list[MovieCreate] = []
        self.showtimes: list[ShowtimeCreate] = []

    def scrape(self) -> None:
        logger.trace(f"Running {self.cinema} scraper...")
        response = requests.get(self.url)
        response.raise_for_status()

        data = response.json()

        if not data:
            logger.debug(f"No data found for cinema {self.cinema}")
            raise Exception

        for slug, value in data.items():
            if not value.get("times"): continue
            title_query = clean_title(slug)
            directors = value["director_name"]
            if directors:
                director = directors["value"].split(",")[0].strip()
            # get actor, removing text within parenthesis (such as (voice))
            actor = sub(r"\s*\([^)]*\)", "", value["starring_short"].split(",")[0].strip())
            logger.trace(f"query: {title_query}, {director}, {actor}")
            # Try to find the tmdb_id
            tup = find_tmdb_id(title_query=title_query,
                               director_name=director,
                               actor_name=actor)

            if not tup:
                logger.warning(f"No TMDB ID found for {title_query}, skipping")
                continue
            title, tmdb_id, poster_url = tup

            # Get film from the database, check on id first
            # Add into the database if needed
            logger.debug(f"Found TMDB id {tmdb_id} for {title}")
            movie = MovieCreate(
                id=int(tmdb_id),
                title=title,
                poster_link=poster_url
            )
            self.movies.append(movie)

            # Get showtimes
            for time in value["times"]:
                theatre: str = time["location"]
                if not theatre.startswith(self.theatre_filter): continue
                date = datetime.strptime(time["program_start"], "%Y%m%d%H%M")
                ticket_link = f"{self.url_base}/tickets/{time['provider_id']}"
                logger.trace(f"Found showtime: {date} at {theatre} for {title} ({tmdb_id}), with ticket link {ticket_link}")
                if not self.cinema_id:
                    logger.error(f"Cinema ID not found for {self.cinema}, skipping showtime")
                    continue
                showtime = ShowtimeCreate(
                    movie_id=movie.id,
                    datetime=date,
                    cinema_id=self.cinema_id,
                    theatre=theatre,
                    ticket_link=ticket_link,
                )
                self.showtimes.append(showtime)
        with get_db_context() as session:
            logger.trace(f"Inserting {len(self.movies)} movies and {len(self.showtimes)} showtimes")
            for movie in self.movies:
                crud.create_movie(session=session, movie_create=movie)
            for showtime in self.showtimes:
                crud.create_showtime(session=session, showtime_create=showtime)
