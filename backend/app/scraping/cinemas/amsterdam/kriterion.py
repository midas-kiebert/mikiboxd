from re import sub

import requests
from dateutil import parser
from pydantic import BaseModel
from rapidfuzz import fuzz

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.letterboxd.load_letterboxd_data import scrape_letterboxd
from app.scraping.logger import logger
from app.scraping.tmdb import find_tmdb_id
from app.services import movies as movies_services
from app.services import showtimes as showtimes_services

CINEMA = "Kriterion"


class MovieAttributes(BaseModel):
    titel: str
    regie: str


class MovieData(BaseModel):
    attributes: MovieAttributes


class MovieResponse(BaseModel):
    data: list[MovieData]


class Show(BaseModel):
    production_id: int
    name: str
    start_date: str
    id: int


class Shows(BaseModel):
    shows: list[Show]


class KriterionScraper(BaseCinemaScraper):
    def __init__(self) -> None:
        self.movies: list[MovieCreate] = []
        self.showtimes: list[ShowtimeCreate] = []
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_name(
                session=session, name=CINEMA
            )

    def scrape(self) -> None:
        assert self.cinema_id is not None
        url_movies = "https://kritsite-cms-mxa7oxwmcq-ez.a.run.app/api/films?populate=*&pagination[page]=1&pagination[pageSize]=1000&sort=release:asc"
        url_showtimes = "https://storage.googleapis.com/kritsite-buffer/shows.json"

        response = requests.get(url_showtimes)
        response.raise_for_status()
        response_movies = requests.get(url_movies)
        response_movies.raise_for_status()

        data: Shows = Shows.model_validate(response.json())
        shows = data.shows

        movies_data = MovieResponse.model_validate(response_movies.json()).data
        movies_attributes = [m.attributes for m in movies_data]

        movies_directors: list[tuple[str, str]] = []

        for attrs in movies_attributes:
            title = sub(
                r"\s*\([^)]*\)", "", attrs.titel.split(" | ")[0].strip()
            )  # Take the first part of the title if multiple are listed
            director = (
                attrs.regie.split(" and ")[0]
                .split(",")[0]
                .split(" | ")[0]
                .split(" en ")[0]
                .strip()
            )  # Take the first director if multiple are listed
            movies_directors.append((title, director))
            # logger.trace(f"title: {title}, director: {director}")

        movie_cache: dict[int, MovieCreate] = {}
        for show in shows:
            movie_id = show.production_id
            if movie_id not in movie_cache:
                movie = get_movie(show=show, movies_directors=movies_directors)
                if not movie:
                    # logger.trace(f"Could not process show {show}")
                    logger.warning(f"Could not process show {show.name}")
                    continue
                self.movies.append(movie)
                movie_cache[movie_id] = movie
            datetime_str = show.start_date
            start_datetime = parser.parse(datetime_str).replace(tzinfo=None)
            ticket_link = f"https://tickets.kriterion.nl/kriterion/nl/flow_configs/webshop/steps/start/show/{show.id}"

            showtime = ShowtimeCreate(
                movie_id=movie_cache[movie_id].id,
                datetime=start_datetime,
                cinema_id=self.cinema_id,
                ticket_link=ticket_link,
            )
            self.showtimes.append(showtime)
        with get_db_context() as session:
            # logger.trace(f"Inserting {len(self.movies)} movies and {len(self.showtimes)} showtimes")
            for movie_create in self.movies:
                movies_services.insert_movie_if_not_exists(
                    session=session, movie_create=movie_create
                )
            for showtime in self.showtimes:
                showtimes_services.insert_showtime_if_not_exists(
                    session=session, showtime_create=showtime
                )


def get_movie(
    show: Show, movies_directors: list[tuple[str, str]]
) -> MovieCreate | None:
    title_query = sub(r"\s*\([^)]*\)", "", show.name.split(" | ")[0].strip())

    # find directorprocess_show
    best_fuzz_ratio = 0.0
    director = None
    for title, dir in movies_directors:
        fuzz_ratio = fuzz.token_set_ratio(title_query.lower(), title.lower())
        if fuzz_ratio > best_fuzz_ratio:
            best_fuzz_ratio = fuzz_ratio
            director = dir
    if best_fuzz_ratio < 50:
        logger.debug(
            f"Could not match showtime title {title_query} with movie title {title}, no director found."
        )
        director = None

    tmdb_id = find_tmdb_id(title_query=title_query, director_name=director)
    if tmdb_id is None:
        logger.debug(f"No TMDB id found for {title_query}")
        return None

    letterboxd_data = scrape_letterboxd(tmdb_id)
    if letterboxd_data is None:
        logger.debug(f"No Letterboxd data found for {title_query}")
        return None

    movie = MovieCreate(
        id=int(tmdb_id),
        title=letterboxd_data.title,
        poster_link=letterboxd_data.poster_url,
        letterboxd_slug=letterboxd_data.slug,
        top250=letterboxd_data.top250,
        directors=letterboxd_data.directors,
        release_year=letterboxd_data.release_year,
        rating=letterboxd_data.rating,
    )
    logger.debug(f"Found TMDB id {tmdb_id} for {title}")

    return movie
