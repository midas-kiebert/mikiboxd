import re
from datetime import datetime
from re import sub

import requests
import urllib3
from bs4 import BeautifulSoup
from pydantic import BaseModel

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.letterboxd.load_letterboxd_data import scrape_letterboxd
from app.scraping.logger import logger
from app.scraping.tmdb import find_tmdb_id
from app.services import movies as movies_services
from app.services import scrape_sync as scrape_sync_service
from app.services import showtimes as showtimes_services

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

CINEMA = "De Uitkijk"


def clean_title(title: str) -> str:
    title = title.lower()
    title = re.sub(r"\(.*\)", "", title)  # Remove everything in parentheses
    title = re.sub(
        r"^.*?\bpresents?:?\s*", "", title
    )  # Remove everything before "presents"
    title = re.sub(r"\|.*$", "", title)  # Remove everything starting from "|"
    title = re.sub(r"\s+", " ", title).strip()  # Normalize whitespace
    return title


class Show(BaseModel):
    start_date: str
    title: str
    slug: str


class Day(BaseModel):
    shows: list[Show]


class Response(BaseModel):
    next: str | None
    shows: list[Day]


class UitkijkScraper(BaseCinemaScraper):
    def __init__(self) -> None:
        self.movies: list[MovieCreate] = []
        self.showtimes: list[ShowtimeCreate] = []
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_name(
                session=session, name=CINEMA
            )
            if not self.cinema_id:
                logger.error(f"Cinema {CINEMA} not found in database")
                raise ValueError(f"Cinema {CINEMA} not found in database")

    def scrape(self) -> list[tuple[str, int]]:
        if not self.cinema_id:
            raise ValueError("Cinema id not set")

        url: str | None = "https://api.uitkijk.nl/z-tickets/ladder?offset=0&limit=20"
        # logger.trace(f"{url = }")

        movie_cache: dict[str, MovieCreate] = {}

        while url:
            response = requests.get(url, verify=False)
            response.raise_for_status()

            data = Response.model_validate(response.json())
            url = data.next

            if not data.shows:
                continue

            for day in data.shows:
                if not day.shows:
                    continue
                for show in day.shows:
                    title_query = clean_title(show.title)
                    start_datetime_str = show.start_date
                    dt = datetime.strptime(start_datetime_str, "%Y-%m-%dT%H:%M:%S.%fZ")
                    start_datetime = dt.replace(tzinfo=None)
                    slug = show.slug

                    if slug not in movie_cache:
                        movie = get_movie(slug=slug, title_query=title_query)
                        if not movie:
                            continue
                        movie_cache[slug] = movie
                        self.movies.append(movie)

                    showtime = ShowtimeCreate(
                        movie_id=movie_cache[slug].id,
                        datetime=start_datetime,
                        cinema_id=self.cinema_id,
                        ticket_link=f"https://www.uitkijk.nl/film/{slug}",
                    )
                    self.showtimes.append(showtime)
        observed_presences: list[tuple[str, int]] = []
        with get_db_context() as session:
            # logger.trace(f"Inserting {len(self.movies)} movies and {len(self.showtimes)} showtimes")
            for movie_create in self.movies:
                movies_services.insert_movie_if_not_exists(
                    session=session, movie_create=movie_create
                )
            for showtime_create in self.showtimes:
                showtime = showtimes_services.upsert_showtime(
                    session=session, showtime_create=showtime_create
                )
                source_event_key = scrape_sync_service.fallback_source_event_key(
                    movie_id=showtime_create.movie_id,
                    cinema_id=showtime_create.cinema_id,
                    dt=showtime_create.datetime,
                    ticket_link=showtime_create.ticket_link,
                )
                observed_presences.append((source_event_key, showtime.id))
        return observed_presences


def get_movie(slug: str, title_query: str) -> MovieCreate | None:
    # logger.trace(f"Processing movie: {slug}")
    film_url = f"https://www.uitkijk.nl/film/{slug}"
    response = requests.get(film_url, verify=False)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")
    director_elements = soup.find_all("strong", string="Regie:")
    if not director_elements:
        logger.warning(f"No director found for {slug}, skipping")
        return None
    director_element = director_elements[0]
    li = director_element.parent
    if not li:
        logger.warning(f"No director parent found for {slug}, skipping")
        return None
    strong_tag = li.find("strong")
    if not strong_tag:
        logger.warning(f"No strong tag found for {slug}, skipping")
        return None
    strong_tag.extract()  # removes the <strong> from the DOM
    directors = [
        sub(r"\s+", " ", name)
        for name in li.get_text(strip=True).encode("latin1").decode("utf-8").split(",")
    ]
    try:
        actor_element = soup.find_all("strong", string="Cast:")[0]
        li = actor_element.parent
        if not li:
            logger.warning(f"No actor parent found for {slug}, skipping")
            raise Exception("No actor parent found")
        strong_tag = li.find("strong")
        if not strong_tag:
            logger.warning(f"No strong tag found for {slug}, skipping")
            raise Exception("No strong tag found")
        strong_tag.extract()  # removes the <strong> from the DOM
        actor = sub(
            r"\s*\([^)]*\)",
            "",
            sub(
                r"\s+",
                " ",
                li.get_text(strip=True).encode("latin1").decode("utf-8").split(",")[0],
            ),
        )
    except Exception:
        actor = None

    # logger.trace(f"{title_query = }, {director = }, {actor = }")

    tmdb_id = find_tmdb_id(
        title_query=title_query, director_names=directors, actor_name=actor
    )
    if tmdb_id is None:
        logger.warning(f"No TMDB id found for {title_query}, skipping")
        return None

    letterboxd_data = scrape_letterboxd(tmdb_id)
    if letterboxd_data is None:
        logger.warning(f"No Letterboxd data found for {title_query}, skipping")
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
    logger.debug(f"Found TMDB id {tmdb_id} for {letterboxd_data.title}")
    return movie
