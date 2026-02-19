from concurrent.futures import ThreadPoolExecutor, as_completed
from re import split, sub

import requests
from dateutil import parser
from pydantic import BaseModel
from rapidfuzz import fuzz

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.logger import logger
from app.scraping.tmdb import find_tmdb_id, get_tmdb_movie_details
from app.services import movies as movies_services
from app.services import scrape_sync as scrape_sync_service
from app.services import showtimes as showtimes_services
from app.utils import now_amsterdam_naive

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
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_name(
                session=session, name=CINEMA
            )

    def scrape(self) -> list[tuple[str, int]]:
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

        movies_directors: list[tuple[str, list[str]]] = []

        for attrs in movies_attributes:
            title = sub(
                r"\s*\([^)]*\)", "", attrs.titel.split(" | ")[0].strip()
            )  # Take the first part of the title if multiple are listed
            directors = [
                director.strip()
                for director in split(r"\s*(?: and | en |,|\|)\s*", attrs.regie)
            ]
            movies_directors.append((title, directors))
            # logger.trace(f"title: {title}, director: {director}")

        shows_by_production_id: dict[int, Show] = {}
        for show in shows:
            shows_by_production_id.setdefault(show.production_id, show)

        movie_cache: dict[int, MovieCreate] = {}
        max_workers = min(len(shows_by_production_id), self.item_concurrency()) or 1
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_production_id = {
                executor.submit(
                    get_movie,
                    show=show,
                    movies_directors=movies_directors,
                ): production_id
                for production_id, show in shows_by_production_id.items()
            }
            for future in as_completed(future_to_production_id):
                production_id = future_to_production_id[future]
                try:
                    movie = future.result()
                except Exception:
                    logger.exception(
                        f"Could not process Kriterion production {production_id}"
                    )
                    continue
                if movie is None:
                    show = shows_by_production_id[production_id]
                    logger.warning(f"Could not process show {show.name}")
                    continue
                movie_cache[production_id] = movie

        movies_by_id: dict[int, MovieCreate] = {}
        showtimes: list[ShowtimeCreate] = []
        for show in shows:
            movie = movie_cache.get(show.production_id)
            if movie is None:
                continue
            datetime_str = show.start_date
            start_datetime = parser.parse(datetime_str).replace(tzinfo=None)
            ticket_link = (
                "https://tickets.kriterion.nl/kriterion/nl/flow_configs/"
                f"webshop/steps/start/show/{show.id}"
            )
            showtimes.append(
                ShowtimeCreate(
                    movie_id=movie.id,
                    datetime=start_datetime,
                    cinema_id=self.cinema_id,
                    ticket_link=ticket_link,
                )
            )
            movies_by_id[movie.id] = movie

        observed_presences: list[tuple[str, int]] = []
        with get_db_context() as session:
            for movie_create in movies_by_id.values():
                movies_services.upsert_movie(
                    session=session,
                    movie_create=movie_create,
                    commit=False,
                )
            for showtime in showtimes:
                db_showtime = showtimes_services.upsert_showtime(
                    session=session,
                    showtime_create=showtime,
                    commit=False,
                )
                source_event_key = scrape_sync_service.fallback_source_event_key(
                    movie_id=showtime.movie_id,
                    cinema_id=showtime.cinema_id,
                    dt=showtime.datetime,
                    ticket_link=showtime.ticket_link,
                )
                observed_presences.append((source_event_key, db_showtime.id))
            session.commit()
        return observed_presences


def get_movie(
    show: Show, movies_directors: list[tuple[str, list[str]]]
) -> MovieCreate | None:
    title_query = sub(r"\s*\([^)]*\)", "", show.name.split(" | ")[0].strip())

    # find directorprocess_show
    best_fuzz_ratio = 0.0
    directors: list[str] = []
    for title, dirs in movies_directors:
        fuzz_ratio = fuzz.token_set_ratio(title_query.lower(), title.lower())
        if fuzz_ratio > best_fuzz_ratio:
            best_fuzz_ratio = fuzz_ratio
            directors = dirs
    if best_fuzz_ratio < 50:
        logger.debug(
            f"Could not match showtime title {title_query} with movie title {title}, no director found."
        )
        directors = []

    tmdb_id = find_tmdb_id(title_query=title_query, director_names=directors)
    if tmdb_id is None:
        logger.debug(f"No TMDB id found for {title_query}")
        return None

    tmdb_details = get_tmdb_movie_details(tmdb_id)
    if tmdb_details is None:
        logger.warning(
            f"TMDB details not found for TMDB ID {tmdb_id}; using fallback metadata."
        )

    tmdb_directors = (
        tmdb_details.directors if tmdb_details is not None else list(directors)
    )
    movie = MovieCreate(
        id=int(tmdb_id),
        title=tmdb_details.title if tmdb_details is not None else title_query,
        poster_link=tmdb_details.poster_url if tmdb_details is not None else None,
        letterboxd_slug=None,
        directors=tmdb_directors if tmdb_directors else None,
        release_year=tmdb_details.release_year if tmdb_details is not None else None,
        original_title=(
            tmdb_details.original_title if tmdb_details is not None else None
        ),
        tmdb_last_enriched_at=(
            now_amsterdam_naive() if tmdb_details is not None else None
        ),
    )
    logger.debug(f"Resolved TMDB id {tmdb_id} for {title_query}")

    return movie
