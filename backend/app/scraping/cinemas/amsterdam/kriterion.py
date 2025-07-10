import requests
from re import sub
from datetime import datetime
from app.models import MovieCreate, ShowtimeCreate
from app.scraping.tmdb import find_tmdb_id
from collections import defaultdict
from rapidfuzz import fuzz
from app.scraping import BaseCinemaScraper
from app.scraping import logger
from app import crud
from app.api.deps import get_db_context

from dateutil import parser

CINEMA = "Kriterion"

class KriterionScraper(BaseCinemaScraper):
    def __init__(self):
        self.movies = []
        self.showtimes = []
        with get_db_context() as session:
            self.cinema_id = crud.get_cinema_id_by_name(session=session, name=CINEMA)
            if not self.cinema_id:
                logger.error(f"Cinema {CINEMA} not found in database")
                raise ValueError(f"Cinema {CINEMA} not found in database")


    def scrape(self):
        url_movies = "https://kritsite-cms-mxa7oxwmcq-ez.a.run.app/api/films?populate=*&pagination[page]=1&pagination[pageSize]=1000&sort=release:asc"
        url_showtimes = "https://storage.googleapis.com/kritsite-buffer/shows.json"

        response = requests.get(url_showtimes)
        response.raise_for_status()
        response_movies = requests.get(url_movies)
        response_movies.raise_for_status()

        data = response.json()
        shows = data['shows']

        movies_data = response_movies.json()['data']

        movies_directors = []

        for m in movies_data:
            title = sub(r"\s*\([^)]*\)", "", m['attributes']['titel'].split(' | ')[0].strip())  # Take the first part of the title if multiple are listed
            director = m['attributes']['regie'].split(' and ')[0].split(',')[0].split(' | ')[0].split(' en ')[0].strip() # Take the first director if multiple are listed
            movies_directors.append((title, director))
            logger.trace(f"title: {title}, director: {director}")

        movie_cache = {}
        for show in shows:
            movie_id = show['production_id']
            if not movie_id in movie_cache:
                movie = get_movie(
                    show=show,
                    movies_directors=movies_directors
                )
                if not movie:
                    logger.trace(f"Could not process show {show}")
                    logger.warning(f"Could not process show {show.get('name')}")
                    continue
                self.movies.append(movie)
                movie_cache[movie_id] = movie
            datetime_str = show['start_date']
            start_datetime = parser.parse(datetime_str).replace(tzinfo=None)
            theatre = show['theatre_name']
            ticket_link = f"https://tickets.kriterion.nl/kriterion/nl/flow_configs/webshop/steps/start/show/{show['id']}"

            showtime = ShowtimeCreate(
                movie_id=movie_cache[movie_id].id,
                datetime=start_datetime,
                cinema_id=self.cinema_id,
                theatre=theatre,
                ticket_link=ticket_link
            )
            self.showtimes.append(showtime)
        with get_db_context() as session:
            logger.trace(f"Inserting {len(self.movies)} movies and {len(self.showtimes)} showtimes")
            for movie in self.movies:
                crud.create_movie(session=session, movie_create=movie)
            for showtime in self.showtimes:
                crud.create_showtime(session=session, showtime_create=showtime)


def get_movie(show, movies_directors) -> MovieCreate | None:
    title_query = sub(r"\s*\([^)]*\)", "", show['name'].split(' | ')[0].strip())

    # find directorprocess_show
    best_fuzz_ratio = 0
    director = None
    for title, dir in movies_directors:
        fuzz_ratio = fuzz.token_set_ratio(title_query.lower(), title.lower())
        if fuzz_ratio > best_fuzz_ratio:
            best_fuzz_ratio = fuzz_ratio
            director = dir
    if best_fuzz_ratio < 50:
        logger.debug(f"Could not match showtime title {title_query} with movie title {title}, no director found.")
        director = None

    result = find_tmdb_id(title_query=title_query,
                        director_name=director)
    if not result:
        logger.debug(f"No TMDB id found for {title_query}")
        return None
    title, tmdb_id, poster_url = result
    movie = MovieCreate(
        id=tmdb_id,
        title=title,
        poster_link=poster_url
    )
    logger.debug(f"Found TMDB id {tmdb_id} for {title}")

    return movie