from concurrent.futures import ThreadPoolExecutor, as_completed
from re import split, sub

import requests
from dateutil import parser
from pydantic import BaseModel

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.logger import logger
from app.scraping.title_hints import (
    parse_subtitle_hint_from_title,
    parse_year_hint_from_title,
)
from app.scraping.tmdb_lookup import find_tmdb_id
from app.scraping.tmdb_movie_details import get_tmdb_movie_details
from app.services import movies as movies_services
from app.services import scrape_sync as scrape_sync_service
from app.services import showtimes as showtimes_services

CINEMA = "Kriterion"


class Show(BaseModel):
    id: int
    production_id: int
    name: str
    start_date: str
    director: str | None = None
    duration: int | None = None
    spoken_languages: str | None = None
    subtitle_languages: str | None = None
    is_deleted: str = "false"


class ShowsResponse(BaseModel):
    success: bool
    shows: list[Show]


def clean_title(name: str) -> str:
    title = name.split(" | ")[0].strip()
    return sub(r"\s*\([^)]*\)", "", title).strip()


def parse_directors(director: str | None) -> list[str]:
    if not director:
        return []
    return [
        d.strip() for d in split(r"\s*(?: and | en |,|\|)\s*", director) if d.strip()
    ]


def parse_languages(value: str | None) -> list[str] | None:
    if not value:
        return None
    return [v.strip() for v in value.split(",") if v.strip()] or None


class KriterionScraper(BaseCinemaScraper):
    def __init__(self) -> None:
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_name(
                session=session, name=CINEMA
            )

    def scrape(self) -> list[tuple[str, int]]:
        assert self.cinema_id is not None
        url_shows = "https://www.kriterion.nl/data/shows.json"

        response = requests.get(url_shows)
        response.raise_for_status()

        data = ShowsResponse.model_validate(response.json())
        shows = [show for show in data.shows if show.is_deleted.lower() != "true"]

        shows_by_production_id: dict[int, Show] = {}
        for show in shows:
            shows_by_production_id.setdefault(show.production_id, show)

        movie_cache: dict[int, MovieCreate] = {}
        max_workers = min(len(shows_by_production_id), self.item_concurrency()) or 1
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_production_id = {
                executor.submit(get_movie, show=show): production_id
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
            start_datetime = parser.parse(show.start_date).replace(tzinfo=None)
            ticket_link = (
                "https://tickets.kriterion.nl/kriterion/nl/flow_configs/"
                f"webshop/steps/start/show/{show.id}"
            )
            subtitles = parse_languages(show.subtitle_languages)
            if subtitles is None:
                subtitles = parse_subtitle_hint_from_title(show.name)
            showtimes.append(
                ShowtimeCreate(
                    movie_id=movie.id,
                    datetime=start_datetime,
                    cinema_id=self.cinema_id,
                    ticket_link=ticket_link,
                    subtitles=subtitles,
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


def get_movie(show: Show) -> MovieCreate | None:
    title_query = clean_title(show.name)
    directors = parse_directors(show.director)
    spoken_languages = parse_languages(show.spoken_languages)
    year = parse_year_hint_from_title(show.name)

    tmdb_id = find_tmdb_id(
        title_query=title_query,
        director_names=directors,
        duration_minutes=show.duration,
        spoken_languages=spoken_languages,
        year=year,
    )
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
        letterboxd_slug=None,
        directors=tmdb_directors if tmdb_directors else None,
        release_year=tmdb_details.release_year if tmdb_details is not None else year,
        duration=tmdb_details.runtime_minutes if tmdb_details is not None else None,
        languages=tmdb_details.spoken_languages if tmdb_details is not None else None,
        original_title=(
            tmdb_details.original_title if tmdb_details is not None else None
        ),
        tmdb_last_enriched_at=(
            tmdb_details.enriched_at if tmdb_details is not None else None
        ),
    )
    logger.debug(f"Resolved TMDB id {tmdb_id} for {title_query}")

    return movie
