import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

import requests
from bs4 import BeautifulSoup
from bs4.element import Tag

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.letterboxd.load_letterboxd_data import (
    is_letterboxd_temporarily_blocked,
    scrape_letterboxd,
)
from app.scraping.logger import logger
from app.scraping.tmdb import find_tmdb_id
from app.services import movies as movies_service
from app.services import scrape_sync as scrape_sync_service
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
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_name(
                session=session, name=CINEMA
            )

    def _process_film_element(
        self,
        film_element: Tag,
    ) -> tuple[MovieCreate, list[ShowtimeCreate]] | None:
        assert self.cinema_id is not None
        raw_title = film_element.get("data-title")
        if raw_title is None or not isinstance(raw_title, str):
            return None
        title_query = clean_title(raw_title)
        production_id = film_element.get("data-productionid")
        if not production_id or production_id == "0":
            return None

        director_element = film_element.find(lambda tag: tag.string == "Regie")
        if not isinstance(director_element, Tag):
            logger.warning(f"Could not find director for {title_query} in {CINEMA}")
            return None
        director_sibling = director_element.next_sibling
        if not isinstance(director_sibling, str):
            logger.warning(f"Could not parse director for {title_query} in {CINEMA}")
            return None
        directors = [
            director.strip() for director in director_sibling.strip().split(",")
        ]

        cast_element = film_element.find(lambda tag: tag.string == "Cast")
        if isinstance(cast_element, Tag):
            actor_sibling = cast_element.next_sibling
            actor = (
                actor_sibling.strip().split(",")[0]
                if isinstance(actor_sibling, str)
                else None
            )
        else:
            logger.debug(f"Could not find actor for {title_query} in {CINEMA}")
            actor = None

        tmdb_id = find_tmdb_id(
            title_query=title_query,
            director_names=directors,
            actor_name=actor,
        )
        if tmdb_id is None:
            logger.warning(f"No TMDB id found for {title_query}, skipping")
            return None

        letterboxd_data = scrape_letterboxd(tmdb_id)
        if letterboxd_data is None:
            if is_letterboxd_temporarily_blocked():
                logger.debug(
                    f"Letterboxd temporarily blocked; skipping TMDB ID {tmdb_id}"
                )
            else:
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

        showtimes_url = (
            "https://tickets.fchyena.nl/fchyena/nl/flow_configs/1/z_events_list"
            f"?production_id={production_id}"
        )
        showtimes_response = requests.get(showtimes_url)
        showtimes_response.raise_for_status()
        showtimes_soup = BeautifulSoup(showtimes_response.text, "html.parser")
        rows = showtimes_soup.find_all("tr")
        showtimes: list[ShowtimeCreate] = []
        for row in rows:
            if not isinstance(row, Tag):
                continue
            dt, ticket_link = parse_showtime(row)
            showtimes.append(
                ShowtimeCreate(
                    movie_id=movie.id,
                    datetime=dt,
                    cinema_id=self.cinema_id,
                    ticket_link=ticket_link,
                )
            )
        return movie, showtimes

    def scrape(self) -> list[tuple[str, int]]:
        assert self.cinema_id is not None
        url = "https://fchyena.nl/films"
        response = requests.get(url)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        film_elements = soup.find_all("li", class_="film")

        if not film_elements:
            logger.debug("No films found in FC Hyena")

        work_items = [film for film in film_elements if isinstance(film, Tag)]
        max_workers = min(len(work_items), self.item_concurrency()) or 1
        movies_by_id: dict[int, MovieCreate] = {}
        showtimes: list[ShowtimeCreate] = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [
                executor.submit(self._process_film_element, film_element)
                for film_element in work_items
            ]
            for future in as_completed(futures):
                try:
                    result = future.result()
                except Exception:
                    logger.exception("Error processing FC Hyena film entry")
                    continue
                if result is None:
                    continue
                movie, movie_showtimes = result
                movies_by_id[movie.id] = movie
                showtimes.extend(movie_showtimes)

        observed_presences: list[tuple[str, int]] = []
        with get_db_context() as session:
            for movie_create in movies_by_id.values():
                movies_service.insert_movie_if_not_exists(
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
