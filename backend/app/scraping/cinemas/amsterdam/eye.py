import re
from datetime import datetime

import httpx
import requests
from bs4 import BeautifulSoup
from bs4.element import Tag
from pydantic import BaseModel

from app import crud
from app.api.deps import get_db_context
from app.models import MovieCreate, ShowtimeCreate
from app.scraping import BaseCinemaScraper, logger
from app.scraping.tmdb import find_tmdb_id


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
        self.movies: list[MovieCreate] = []
        self.showtimes: list[ShowtimeCreate] = []
        self.movie_cache: dict[int, MovieCreate] = {}
        with get_db_context() as session:
            self.cinema_id = crud.get_cinema_id_by_name(session=session, name=CINEMA)
            if not self.cinema_id:
                logger.error(f"Cinema {CINEMA} not found in database")
                raise ValueError(f"Cinema {CINEMA} not found in database")

    def scrape(self) -> None:
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
        shows = Response.model_validate(response.json()).data.shows

        for show in shows:
            # logger.trace(f"Proccessing show: {show}")
            self.process_show(show)

        with get_db_context() as session:
            # logger.trace(f"Inserting {len(self.movies)} movies and {len(self.showtimes)} showtimes")
            for movie in self.movies:
                crud.create_movie(session=session, movie_create=movie)
            for showtime in self.showtimes:
                crud.create_showtime(session=session, showtime_create=showtime)

    def process_show(self, show: Show) -> None:
        assert self.cinema_id is not None
        production_type = show.relatedProduction.productionType
        # logger.trace(f"Processing show with production type {production_type}")
        if production_type != "1":
            # logger.trace(f"Skipping show with production type {production_type}, only movies are processed")
            return
        # logger.trace(f"Processing show: {show}")
        url = show.url
        start_datetime_str = show.startDateTime
        # end_datetime = show['endDateTime']
        theatre = show.cinemaRoom
        # ticket_status = show['ticketStatus']
        ticket_url = show.ticketUrl
        title_query = clean_title(show.production[0].title)
        movie_id = show.production[0].id
        start_datetime = datetime.fromisoformat(start_datetime_str).replace(tzinfo=None)

        if movie_id not in self.movie_cache:
            movie = get_movie(title_query=title_query, url=url)
            if not movie:
                return
            self.movie_cache[movie_id] = movie
            self.movies.append(movie)
        else:
            movie = self.movie_cache[movie_id]

        showtime = ShowtimeCreate(
            movie_id=movie.id,
            datetime=start_datetime,
            cinema_id=self.cinema_id,
            theatre=theatre,
            ticket_link=ticket_url,
        )

        self.showtimes.append(showtime)


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
    director = director_str.strip(",")[0]

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

    result = find_tmdb_id(title_query=title_query, director_name=director)
    if not result:
        logger.warning(f"No TMDB id found for {title_query}, skipping")
        return None
    title, tmdb_id, poster_url = result

    logger.debug(f"Found TMDB id {tmdb_id} for {title}")

    return MovieCreate(
        id=int(tmdb_id),
        title=title,
        poster_link=poster_url,
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
