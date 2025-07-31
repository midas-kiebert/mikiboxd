import re
from datetime import datetime

import requests
from bs4 import BeautifulSoup
from bs4.element import Tag

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping import BaseCinemaScraper
from app.scraping.logger import logger
from app.scraping.tmdb import find_tmdb_id
from app.services import movies as movies_service
from app.services import showtimes as showtimes_service

CINEMA = "FC Hyena"


def clean_title(title: str) -> str:
    title = title.lower()
    title = re.sub(r"\(.*\)", "", title)  # Remove everything in parentheses
    title = re.sub(r"\b-.*$", "", title)  # Remove everything starting from "-"
    title = re.sub(r"\s+", " ", title).strip()  # Normalize whitespace
    return title


class FCHyenaScraper(BaseCinemaScraper):
    def __init__(self) -> None:
        self.movies: list[MovieCreate] = []
        self.showtimes: list[ShowtimeCreate] = []
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_name(
                session=session, name=CINEMA
            )

    def scrape(self) -> None:
        assert self.cinema_id is not None
        url = "https://fchyena.nl/films"
        response = requests.get(url)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        film_elements = soup.find_all("li", class_="film")

        if not film_elements:
            logger.debug("No films found in FC Hyena")

        for film_element in film_elements:
            assert isinstance(film_element, Tag)
            raw_title = film_element.get("data-title")
            assert raw_title is not None and isinstance(raw_title, str)
            title_query = clean_title(raw_title)
            production_id = film_element.get("data-productionid")
            # logger.trace(f"{production_id = }")
            if not production_id or production_id == "0":
                continue
            director_element = film_element.find(lambda tag: tag.string == "Regie")
            assert isinstance(director_element, Tag)
            director_sibling = director_element.next_sibling
            assert isinstance(director_sibling, str)
            director = director_sibling.strip()
            cast_element = film_element.find(lambda tag: tag.string == "Cast")
            try:
                assert isinstance(cast_element, Tag)
                actor_sibling = cast_element.next_sibling
                assert isinstance(actor_sibling, str)
                actor = actor_sibling.strip().split(",")[0]
            except Exception:
                logger.debug(f"Could not find actor for {title_query} in {CINEMA}")
                actor = None
            # logger.trace(f"{director = }, {actor = }")

            result = find_tmdb_id(
                title_query=title_query, director_name=director, actor_name=actor
            )
            if not result:
                logger.warning(f"No TMDB id found for {title_query}, skipping")
                continue
            title, tmdb_id, poster_url = result

            logger.debug(f"Found TMDB id {tmdb_id} for {title}")
            movie = MovieCreate(id=int(tmdb_id), title=title, poster_link=poster_url)
            self.movies.append(movie)

            showtimes_url = f"https://tickets.fchyena.nl/fchyena/nl/flow_configs/1/z_events_list?production_id={production_id}"
            showtimes_response = requests.get(showtimes_url)
            showtimes_response.raise_for_status()
            showtimes_soup = BeautifulSoup(showtimes_response.text, "html.parser")
            rows = showtimes_soup.find_all("tr")
            for row in rows:
                # with logger.catch(message="Error loading showtime in FC Hyena!"):
                assert isinstance(row, Tag)
                dt, ticket_link = parse_showtime(row)
                showtime = ShowtimeCreate(
                    movie_id=movie.id,
                    datetime=dt,
                    cinema_id=self.cinema_id,
                    ticket_link=ticket_link,
                )
                self.showtimes.append(showtime)
        with get_db_context() as session:
            # logger.trace(f"{len(self.movies) = }, {len(self.showtimes) = }")
            for movie_create in self.movies:
                movies_service.insert_movie_if_not_exists(
                    session=session, movie_create=movie_create
                )
            for showtime_create in self.showtimes:
                showtimes_service.insert_showtime_if_not_exists(
                    session=session, showtime_create=showtime_create
                )


def parse_showtime(row: Tag) -> tuple[datetime, str]:
    date_element, button = row.find_all("p")
    date_str = date_element.text
    dt = get_datetime(date_str)
    link_element = button.find_next("a")
    assert isinstance(link_element, Tag)
    ticket_link = f"https://tickets.fchyena.nl{link_element.get('href')}"
    return dt, ticket_link


months: dict[str, int] = {
    "januari": 1,
    "februari": 2,
    "maart": 3,
    "april": 4,
    "mei": 5,
    "juni": 6,
    "juli": 7,
    "augustus": 8,
    "september": 9,
    "oktober": 10,
    "november": 11,
    "december": 12,
}


def get_datetime(date_str: str) -> datetime:
    parts = date_str.split()
    day = int(parts[1])
    month = months[parts[2].lower()]
    year = int(parts[3].rstrip(","))
    time_str = parts[4]

    dt_str = f"{day}-{month}-{year} {time_str}"

    dt = datetime.strptime(dt_str, "%d-%m-%Y %H:%M")
    # logger.trace(f"{dt = }")
    return dt
