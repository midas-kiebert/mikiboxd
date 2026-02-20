import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from re import sub
from typing import Any

import requests

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

# Generic scraper for cinemas using the Eagerly website.


def clean_title(title: str) -> str:
    title = title.lower()
    title = re.sub(r"-\d{4}$", "", title)  # Remove trailing -YEAR (e.g., -1967)
    title = re.sub(r"-ov$", "", title)  # Remove trailing -ov
    title = title.replace("-", " ")  # Replace all hyphens with spaces
    title = re.sub(r"\s+", " ", title).strip()  # Normalize whitespace
    return title


class GenericEagerlyScraper(BaseCinemaScraper):
    def __init__(self, cinema: str, url_base: str, theatre_filter: str = "") -> None:
        self.cinema = cinema
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_name(
                session=session, name=cinema
            )
            if not self.cinema_id:
                logger.error(f"Cinema {cinema} not found in database")
                raise ValueError(f"Cinema {cinema} not found in database")

        self.url_base = url_base
        self.url = f"{url_base}/fk-feed/agenda"
        self.theatre_filter = theatre_filter  # For Leiden

    def _process_movie_entry(
        self,
        *,
        slug: str,
        value: dict[str, Any],
    ) -> tuple[MovieCreate, list[ShowtimeCreate]] | None:
        if not value.get("times"):
            return None

        title_query = clean_title(slug)
        directors_raw = value.get("director_name")
        directors_value = (
            directors_raw.get("value") if isinstance(directors_raw, dict) else None
        )
        directors = (
            [director.strip() for director in directors_value.split(",")]
            if isinstance(directors_value, str) and directors_value
            else []
        )

        starring_short = value.get("starring_short")
        actor = None
        if isinstance(starring_short, str) and starring_short:
            actor = sub(r"\s*\([^)]*\)", "", starring_short.split(",")[0].strip())

        tmdb_id = find_tmdb_id(
            title_query=title_query,
            director_names=directors,
            actor_name=actor,
        )
        if not tmdb_id:
            logger.warning(f"No TMDB ID found for {title_query}, skipping")
            return None

        tmdb_details = get_tmdb_movie_details(tmdb_id)
        if tmdb_details is None:
            logger.warning(
                f"TMDB details not found for TMDB ID {tmdb_id}; using fallback metadata."
            )

        tmdb_title = (
            tmdb_details.title
            if tmdb_details is not None
            else slug.replace("-", " ").strip()
        )
        tmdb_directors = (
            tmdb_details.directors if tmdb_details is not None else list(directors)
        )
        movie = MovieCreate(
            id=int(tmdb_id),
            title=tmdb_title,
            letterboxd_slug=None,
            directors=tmdb_directors if tmdb_directors else None,
            release_year=(
                tmdb_details.release_year if tmdb_details is not None else None
            ),
            original_title=(
                tmdb_details.original_title if tmdb_details is not None else None
            ),
            tmdb_last_enriched_at=(
                tmdb_details.enriched_at if tmdb_details is not None else None
            ),
        )

        showtimes: list[ShowtimeCreate] = []
        for time in value["times"]:
            theatre = time["location"]
            if not theatre.startswith(self.theatre_filter):
                continue
            date = datetime.strptime(time["program_start"], "%Y%m%d%H%M")
            ticket_link = f"{self.url_base}/tickets/{time['provider_id']}"
            assert self.cinema_id is not None
            showtimes.append(
                ShowtimeCreate(
                    movie_id=movie.id,
                    datetime=date,
                    cinema_id=self.cinema_id,
                    ticket_link=ticket_link,
                )
            )

        logger.debug(f"Resolved TMDB id {tmdb_id} for {movie.title}")
        return movie, showtimes

    def scrape(self) -> list[tuple[str, int]]:
        # logger.trace(f"Running {self.cinema} scraper...")
        response = requests.get(self.url)
        response.raise_for_status()

        data = response.json()

        if not data:
            logger.debug(f"No data found for cinema {self.cinema}")
            raise Exception

        work_items = [
            (slug, value)
            for slug, value in data.items()
            if isinstance(value, dict) and value.get("times")
        ]
        max_workers = min(len(work_items), self.item_concurrency()) or 1
        movies_by_id: dict[int, MovieCreate] = {}
        showtimes: list[ShowtimeCreate] = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [
                executor.submit(
                    self._process_movie_entry,
                    slug=slug,
                    value=value,
                )
                for slug, value in work_items
            ]
            for future in as_completed(futures):
                try:
                    result = future.result()
                except Exception:
                    logger.exception(
                        f"Error processing movie entry for cinema {self.cinema}"
                    )
                    continue
                if result is None:
                    continue
                movie, movie_showtimes = result
                movies_by_id[movie.id] = movie
                showtimes.extend(movie_showtimes)

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
