import re
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests
from bs4 import BeautifulSoup
from bs4.element import Tag

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.date_conversion import get_closest_exact_date
from app.scraping.letterboxd.load_letterboxd_data import (
    is_letterboxd_temporarily_blocked,
    scrape_letterboxd,
)
from app.scraping.logger import logger
from app.scraping.tmdb import find_tmdb_id
from app.services import movies as movies_services
from app.services import scrape_sync as scrape_sync_service
from app.services import showtimes as showtimes_services

CINEMA = "LAB111"


def clean_title(title: str) -> str:
    title = title.lower()
    title = re.sub(r"\(.*\)", "", title)  # Remove everything in parentheses
    title = re.sub(
        r"^.*?\bpresents?:?\s*", "", title
    )  # Remove everything before "presents"
    title = re.sub(r"\bincl\..*$", "", title)  # Remove everything starting from "incl."
    title = re.sub(r"\s+", " ", title).strip()  # Normalize whitespace
    return title


class LAB111Scraper(BaseCinemaScraper):
    def __init__(self) -> None:
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_name(
                session=session, name=CINEMA
            )
            if not self.cinema_id:
                logger.error(f"Cinema {CINEMA} not found in database")
                raise ValueError(f"Cinema {CINEMA} not found in database")

    def _process_film_div(
        self,
        div: Tag,
    ) -> tuple[MovieCreate, list[ShowtimeCreate]] | None:
        assert self.cinema_id is not None
        raw_title = div.get("data-title")
        if raw_title is None or not isinstance(raw_title, str):
            logger.warning("Skipping div without a valid data-title attribute")
            return None
        title_query = clean_title(raw_title)
        directors = extract_name(div, "Regisseur:")
        actors = extract_name(div, "Acteurs:")
        actor = actors[0] if actors else None

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
                logger.warning(
                    f"No Letterboxd data found for TMDB id {tmdb_id}, skipping"
                )
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

        showtimes: list[ShowtimeCreate] = []
        days = div.find_all("tr", class_="day")
        for day in days:
            if not isinstance(day, Tag):
                continue
            links = day.find_all("a")
            if len(links) == 0:
                logger.debug(f"No links found for {letterboxd_data.title}, skipping")
                continue
            link = links[0]
            if not isinstance(link, Tag):
                continue
            potential_showtime = link.get_text(strip=True)
            date = get_closest_exact_date(potential_showtime)
            ticket_link = link["href"]
            if not isinstance(ticket_link, str):
                continue
            showtimes.append(
                ShowtimeCreate(
                    movie_id=movie.id,
                    datetime=date,
                    cinema_id=self.cinema_id,
                    ticket_link=ticket_link,
                )
            )
        return movie, showtimes

    def scrape(self) -> list[tuple[str, int]]:
        assert self.cinema_id is not None
        url = "https://lab111.nl/programma"
        response = requests.get(url)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        film_divs = soup.find_all("div", class_="row filmdetails")

        if not film_divs:
            logger.debug("No film divs found in LAB111")
            return []

        work_items: list[Tag] = []
        for div in film_divs:
            if not isinstance(div, Tag):
                logger.warning("Skipping non-Tag element in film divs")
                continue
            work_items.append(div)

        max_workers = min(len(work_items), self.item_concurrency()) or 1
        movies_by_id: dict[int, MovieCreate] = {}
        showtimes: list[ShowtimeCreate] = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [
                executor.submit(self._process_film_div, div) for div in work_items
            ]
            for future in as_completed(futures):
                try:
                    result = future.result()
                except Exception:
                    logger.exception("Error processing LAB111 film entry")
                    continue
                if result is None:
                    continue
                movie, movie_showtimes = result
                movies_by_id[movie.id] = movie
                showtimes.extend(movie_showtimes)

        observed_presences: list[tuple[str, int]] = []
        with get_db_context() as session:
            for movie_create in movies_by_id.values():
                movies_services.insert_movie_if_not_exists(
                    session=session,
                    movie_create=movie_create,
                    commit=False,
                )
            for showtime_create in showtimes:
                showtime = showtimes_services.upsert_showtime(
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


def extract_name(tag: Tag, label: str) -> list[str]:
    for bold_tag in tag.find_all("b"):
        if not isinstance(bold_tag, Tag):
            continue
        text = bold_tag.get_text(strip=True)
        if not text.startswith(label):
            continue
        parent_div = bold_tag.find_parent("div")
        if parent_div is None or not isinstance(parent_div, Tag):
            return []
        inner_text = list(parent_div.stripped_strings)
        if len(inner_text) < 2:
            return []
        names = [name.strip() for name in inner_text[1].strip().split(", ")]
        return names
    return []


if __name__ == "__main__":
    scraper = LAB111Scraper()
    scraper.scrape()
