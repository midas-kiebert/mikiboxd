import requests
from re import sub
from datetime import datetime
from app.models import MovieCreate, ShowtimeCreate
from app.scraping.tmdb import find_tmdb_id
from bs4 import BeautifulSoup
from app.scraping import BaseCinemaScraper
from app.scraping import logger
import re
from app import crud
from app.api.deps import get_db_context

from pydantic import BaseModel

from typing import Optional

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

CINEMA = "De Uitkijk"

def clean_title(title: str) -> str:
    title = title.lower()
    title = re.sub(r'\(.*\)', '', title) # Remove everything in parentheses
    title = re.sub(r'^.*?\bpresents?:?\s*', '', title) # Remove everything before "presents"
    title = re.sub(r'\|.*$', '', title) # Remove everything starting from "|"
    title = re.sub(r'\s+', ' ', title).strip() # Normalize whitespace
    return title


class Show(BaseModel):
    start_date: str
    title: str
    slug: str

class Day(BaseModel):
    shows: list[Show]

class Response(BaseModel):
    next: Optional[str]
    shows: list[Day]




class UitkijkScraper(BaseCinemaScraper):
    def __init__(self) -> None:
        self.movies: list[MovieCreate] = []
        self.showtimes: list[ShowtimeCreate] = []
        with get_db_context() as session:
            self.cinema_id = crud.get_cinema_id_by_name(session=session, name=CINEMA)
            if not self.cinema_id:
                logger.error(f"Cinema {CINEMA} not found in database")
                raise ValueError(f"Cinema {CINEMA} not found in database")


    def scrape(self) -> None:
        if not self.cinema_id:
            raise ValueError(f"Cinema id not set")

        url: Optional[str] = "https://api.uitkijk.nl/z-tickets/ladder?offset=0&limit=20"
        logger.trace(f"{url = }")

        movie_cache: dict[str, MovieCreate] = {}

        while url:
            response = requests.get(url)
            response.raise_for_status()

            data: Response = response.json()
            url = data.next

            if not data.shows: continue

            for day in data.shows:
                if not day.shows: continue
                for show in day.shows:
                    title_query = clean_title(show.title)
                    start_datetime_str = show.start_date
                    dt = datetime.strptime(start_datetime_str, "%Y-%m-%dT%H:%M:%S.%fZ")
                    start_datetime = dt.replace(tzinfo=None)
                    slug = show.slug

                    if not slug in movie_cache:
                        movie =  get_movie(slug=slug, title_query=title_query)
                        if not movie: continue
                        movie_cache[slug] = movie
                        self.movies.append(movie)

                    showtime = ShowtimeCreate(
                        movie_id=movie_cache[slug].id,
                        datetime=start_datetime,
                        cinema_id=self.cinema_id,
                        theatre="Grote Zaal",
                        ticket_link=f"https://www.uitkijk.nl/film/{slug}"
                    )
                    self.showtimes.append(showtime)
        with get_db_context() as session:
            logger.trace(f"Inserting {len(self.movies)} movies and {len(self.showtimes)} showtimes")
            for movie in self.movies:
                crud.create_movie(session=session, movie_create=movie)
            for showtime in self.showtimes:
                crud.create_showtime(session=session, showtime_create=showtime)


def get_movie(slug: str, title_query: str) -> Optional[MovieCreate]:
    logger.trace(f"Processing movie: {slug}")
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
    director = sub(r'\s+', ' ', li.get_text(strip=True).encode("latin1").decode("utf-8").split(",")[0])
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
        actor = sub(r"\s*\([^)]*\)", "", sub(r'\s+', ' ', li.get_text(strip=True).encode("latin1").decode("utf-8").split(",")[0]))
    except Exception:
        actor = None

    logger.trace(f"{title_query = }, {director = }, {actor = }")

    result = find_tmdb_id(title_query=title_query,
                    director_name=director,
                    actor_name=actor)
    if not result:
        logger.warning(f"No TMDB id found for {title_query}, skipping")
        return None
    title, tmdb_id, poster_url = result

    movie = MovieCreate(
        id=int(tmdb_id),
        title=title,
        poster_link=poster_url
    )
    logger.debug(f"Found TMDB id {tmdb_id} for {title}")
    return movie