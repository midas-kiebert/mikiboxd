import re

import requests
from bs4 import BeautifulSoup
from bs4.element import Tag

from app import crud
from app.api.deps import get_db_context
from app.models import MovieCreate, ShowtimeCreate
from app.scraping import BaseCinemaScraper
from app.scraping.date_conversion import get_closest_exact_date
from app.scraping.logger import logger
from app.scraping.tmdb import find_tmdb_id

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
        self.movies: list[MovieCreate] = []
        self.showtimes: list[ShowtimeCreate] = []
        with get_db_context() as session:
            self.cinema_id = crud.get_cinema_id_by_name(session=session, name=CINEMA)
            if not self.cinema_id:
                logger.error(f"Cinema {CINEMA} not found in database")
                raise ValueError(f"Cinema {CINEMA} not found in database")

    def scrape(self) -> None:
        assert self.cinema_id is not None
        url = "https://lab111.nl/programma"
        response = requests.get(url)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")

        film_divs = soup.find_all("div", class_="row filmdetails")

        if not film_divs:
            logger.debug("No film divs found in LAB111")
            return

        for div in film_divs:
            if not isinstance(div, Tag):
                logger.warning("Skipping non-Tag element in film divs")
                continue
            raw_title = div.get("data-title")
            if raw_title is None or not isinstance(raw_title, str):
                logger.warning("Skipping div without a valid data-title attribute")
                continue
            title_query = clean_title(raw_title)
            director = extract_name(div, "Regisseur:")  # Extract director name
            actor = extract_name(div, "Acteurs:")  # Extract actor name

            # Try to find the tmdb_id
            result = find_tmdb_id(
                title_query=title_query, director_name=director, actor_name=actor
            )
            if not result:
                logger.warning(f"No TMDB id found for {title_query}, skipping")
                continue
            title, tmdb_id, poster_url = result

            # Get film from the database, check on id first, title as backup.
            # Add into the database if needed
            movie = MovieCreate(id=int(tmdb_id), title=title, poster_link=poster_url)
            self.movies.append(movie)
            # logger.debug(f"Found TMDB id {tmdb_id} for {title}")

            days = div.find_all("tr", class_="day")
            # logger.trace(f"Found {len(days)} showtimes for {title}")
            for day in days:
                assert isinstance(day, Tag)
                # Get Theatre
                theatre_element = day.find_next("span", class_="theatre_name")
                if not theatre_element or not isinstance(theatre_element, Tag):
                    logger.warning(f"No theatre name found for {title}, skipping")
                    continue
                theatre = theatre_element.get_text(strip=True)

                # Get the date and ticket link
                links = day.find_all("a")
                if len(links) == 0:
                    logger.debug(f"No links found for {title} on {theatre}, skipping")
                    continue
                link = links[0]
                assert isinstance(link, Tag)
                potential_showtime = link.get_text(strip=True)
                date = get_closest_exact_date(potential_showtime)
                ticket_link = link["href"]
                assert isinstance(ticket_link, str)
                showtime = ShowtimeCreate(
                    movie_id=movie.id,
                    datetime=date,
                    cinema_id=self.cinema_id,
                    theatre=theatre,
                    ticket_link=ticket_link,
                )
                self.showtimes.append(showtime)
        with get_db_context() as session:
            # logger.trace(f"Inserting {len(self.movies)} movies and {len(self.showtimes)} showtimes")
            for movie in self.movies:
                crud.create_movie(session=session, movie_create=movie)
            for showtime in self.showtimes:
                crud.create_showtime(session=session, showtime_create=showtime)


def extract_name(tag: Tag, label: str) -> str | None:
    for bold_tag in tag.find_all("b"):
        if not isinstance(bold_tag, Tag):
            continue
        text = bold_tag.get_text(strip=True)
        if not text.startswith(label):
            continue
        parent_div = bold_tag.find_parent("div")
        if parent_div is None or not isinstance(parent_div, Tag):
            return None
        inner_text = list(parent_div.stripped_strings)
        if len(inner_text) < 2:
            return None
        names = inner_text[1].strip().split(", ")
        if not names:
            return None
        name = names[0].strip()
        return name
    return None


if __name__ == "__main__":
    scraper = LAB111Scraper()
    scraper.scrape()
