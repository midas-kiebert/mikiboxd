import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import httpx
import requests
from bs4 import BeautifulSoup
from bs4.element import Tag
from pydantic import BaseModel

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.logger import logger
from app.scraping.tmdb import find_tmdb_id, get_tmdb_movie_details
from app.services import movies as movies_service
from app.services import scrape_sync as scrape_sync_service
from app.services import showtimes as showtimes_service
from app.utils import now_amsterdam_naive


class RelatedProduction(BaseModel):
    productionType: str


class Production(BaseModel):
    title: str
    id: int


class Show(BaseModel):
    relatedProduction: RelatedProduction
    url: str
    startDateTime: str
    cinemaRoom: str
    ticketUrl: str
    production: list[Production]


class Data(BaseModel):
    shows: list[Show]


class Response(BaseModel):
    data: Data


CINEMA = "Eye"


def clean_title(title: str) -> str:
    title = title.lower()
    title = re.sub(r"\(.*\)", "", title)  # Remove everything in parentheses
    title = re.sub(r"\s+", " ", title).strip()  # Normalize whitespace
    return title


class EyeScraper(BaseCinemaScraper):
    def __init__(self) -> None:
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_name(
                session=session, name=CINEMA
            )

    def scrape(self) -> list[tuple[str, int]]:
        # logger.trace(f"Running eye scraper")
        current_datetime = datetime.now().strftime("%Y-%m-%d %H:%M")

        variables = {
            "site": "eyeEnglish",
            "startDateTime": f"> {current_datetime}",
            "sort": "DATE",
            "limit": 1000,
        }

        with httpx.Client(http2=True) as client:
            response = client.post(
                "https://service.eyefilm.nl/graphql",
                headers=HEADERS,
                json={"query": QUERY, "variables": variables, "operationName": "shows"},
            )
        response.raise_for_status()
        shows = Response.model_validate(response.json()).data.shows

        valid_shows: list[Show] = []
        movie_inputs: dict[int, tuple[str, str]] = {}
        for show in shows:
            production_type = show.relatedProduction.productionType
            if production_type != "1" or not show.production:
                continue
            production = show.production[0]
            valid_shows.append(show)
            movie_inputs.setdefault(
                production.id,
                (clean_title(production.title), show.url),
            )

        movies_by_production_id: dict[int, MovieCreate] = {}
        max_workers = min(len(movie_inputs), self.item_concurrency()) or 1
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_production_id = {
                executor.submit(
                    get_movie, title_query=title_query, url=url
                ): production_id
                for production_id, (title_query, url) in movie_inputs.items()
            }
            for future in as_completed(future_to_production_id):
                production_id = future_to_production_id[future]
                try:
                    movie = future.result()
                except Exception:
                    logger.exception(
                        f"Failed to process Eye production {production_id}"
                    )
                    continue
                if movie is None:
                    continue
                movies_by_production_id[production_id] = movie

        movies_by_id: dict[int, MovieCreate] = {}
        showtimes: list[ShowtimeCreate] = []
        for show in valid_shows:
            production = show.production[0]
            movie = movies_by_production_id.get(production.id)
            if movie is None:
                continue
            start_datetime = datetime.fromisoformat(show.startDateTime).replace(
                tzinfo=None
            )
            showtimes.append(
                ShowtimeCreate(
                    movie_id=movie.id,
                    datetime=start_datetime,
                    cinema_id=self.cinema_id,
                    ticket_link=show.ticketUrl,
                )
            )
            movies_by_id[movie.id] = movie

        observed_presences: list[tuple[str, int]] = []
        with get_db_context() as session:
            for movie_create in movies_by_id.values():
                movies_service.upsert_movie(
                    session=session,
                    movie_create=movie_create,
                    commit=False,
                )
            for showtime_create in showtimes:
                showtime = showtimes_service.upsert_showtime(
                    session=session,
                    showtime_create=showtime_create,
                    commit=False,
                )
                source_event_key = scrape_sync_service.fallback_source_event_key(
                    movie_id=showtime_create.movie_id,
                    cinema_id=showtime_create.cinema_id,
                    dt=showtime_create.datetime,
                    ticket_link=showtime_create.ticket_link,
                )
                observed_presences.append((source_event_key, showtime.id))
            session.commit()
        return observed_presences


def get_movie(title_query: str, url: str) -> MovieCreate | None:
    # logger.trace(f"Processing movie: {title_query}")
    response = requests.get(url)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    director_element = soup.find(lambda tag: tag.string == "Director")
    if director_element is None:
        return None
    sibling = director_element.find_next_sibling()
    assert isinstance(sibling, Tag)
    director_str = sibling.string
    if director_str is None:
        return None
    directors = director_str.strip().split(",")

    original_title_element = soup.find(lambda tag: tag.string == "Original title")
    try:
        assert isinstance(original_title_element, Tag)
        sibling = original_title_element.find_next_sibling()
        assert isinstance(sibling, Tag)
        original_title = sibling.string
        # logger.trace(f"Found original title for {title_query} to be {original_title}.")
    except Exception:
        logger.debug(f"Did not find original title for {title_query}")
        original_title = None

    if original_title:
        title_query = original_title

    tmdb_id = find_tmdb_id(title_query=title_query, director_names=directors)
    if tmdb_id is None:
        logger.warning(f"No TMDB id found for {title_query}, skipping")
        return None

    tmdb_details = get_tmdb_movie_details(tmdb_id)
    if tmdb_details is None:
        logger.warning(
            f"TMDB details not found for TMDB ID {tmdb_id}; using fallback metadata."
        )

    tmdb_directors = (
        tmdb_details.directors if tmdb_details is not None else list(directors)
    )
    return MovieCreate(
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


QUERY = """
            query shows(
                $site: String!
                $startDateTime: String
                $sort: ShowSortEnum
                $limit: Int
            ) {
                shows: show(
                site: $site
                startDateTime: $startDateTime
                sort: $sort
                limit: $limit
                ) {
                url
                startDateTime
                endDateTime
                cinemaRoom
                ticketStatus
                ticketUrl
                production {
                    id
                    title
                }
                relatedProduction {
                    productionType
                }
                }
            }
            """

HEADERS = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:137.0) Gecko/20100101 Firefox/137.0",
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.5",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Referer": "https://www.eyefilm.nl/",
    "Origin": "https://www.eyefilm.nl",
    "Connection": "keep-alive",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-site",
    "Priority": "u=4",
    "TE": "trailers",
}
