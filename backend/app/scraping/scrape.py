import asyncio
from collections import defaultdict
from datetime import datetime
from typing import Any

import aiohttp

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.cinemas.amsterdam.eye import EyeScraper
from app.scraping.cinemas.amsterdam.fchyena import FCHyenaScraper
from app.scraping.cinemas.amsterdam.filmhallen import FilmHallenScraper
from app.scraping.cinemas.amsterdam.kriterion import KriterionScraper
from app.scraping.cinemas.amsterdam.lab111 import LAB111Scraper
from app.scraping.cinemas.amsterdam.themovies import TheMoviesScraper
from app.scraping.cinemas.amsterdam.uitkijk import UitkijkScraper
from app.scraping.logger import logger
from app.scraping.tmdb import find_tmdb_id_async
from app.services import movies as movies_service
from app.services import scrape_sync as scrape_sync_service
from app.services import showtimes as showtimes_service
from app.utils import clean_title, now_amsterdam_naive, to_amsterdam_time

from . import get_movies, get_showtimes
from .letterboxd.load_letterboxd_data import (
    LetterboxdMovieData,
    scrape_letterboxd_async,
)

SCRAPERS = [
    EyeScraper,
    FCHyenaScraper,
    LAB111Scraper,
    UitkijkScraper,
    KriterionScraper,
    TheMoviesScraper,
    FilmHallenScraper,
]

CINEVILLE_CONCURRENCY = 6
CINEMA_SCRAPER_CONCURRENCY = 3


def _persist_cineville_movie_results(
    *,
    tmdb_id: int,
    letterboxd_data: LetterboxdMovieData,
    showtimes_data: list[get_showtimes.ShowtimeResponse],
    default_started_at: datetime,
) -> tuple[
    dict[str, list[scrape_sync_service.ObservedPresence]],
    dict[str, list[str]],
    dict[str, datetime],
]:
    observed_by_stream: dict[str, list[scrape_sync_service.ObservedPresence]] = defaultdict(list)
    stream_errors: dict[str, list[str]] = defaultdict(list)
    stream_started_at: dict[str, datetime] = {}

    movie = MovieCreate(
        title=letterboxd_data.title,
        id=tmdb_id,
        poster_link=letterboxd_data.poster_url,
        letterboxd_slug=letterboxd_data.slug,
        top250=letterboxd_data.top250,
        directors=letterboxd_data.directors,
        release_year=letterboxd_data.release_year,
        rating=letterboxd_data.rating,
        original_title=letterboxd_data.original_title,
    )

    with get_db_context() as session:
        movies_service.upsert_movie(
            session=session,
            movie_create=movie,
        )
        logger.info(
            f"Inserted movie: {letterboxd_data.title} (TMDB ID: {tmdb_id}, Letterboxd slug: {letterboxd_data.slug})"
        )

        cinema_id_by_name: dict[str, int] = {}
        for showtime_data in showtimes_data:
            source_stream: str | None = None
            start_date = None
            venue_name = showtime_data.venueName
            try:
                start_date = to_amsterdam_time(showtime_data.startDate)
                ticket_url = showtime_data.ticketUrl

                cinema_id = cinema_id_by_name.get(venue_name)
                if cinema_id is None:
                    cinema_id = cinema_crud.get_cinema_id_by_name(
                        session=session,
                        name=venue_name,
                    )
                    cinema_id_by_name[venue_name] = cinema_id

                source_stream = f"cineville:{cinema_id}"
                stream_started_at.setdefault(source_stream, default_started_at)

                showtime = ShowtimeCreate(
                    datetime=start_date,
                    ticket_link=ticket_url,
                    movie_id=tmdb_id,
                    cinema_id=cinema_id,
                )
                db_showtime = showtimes_service.upsert_showtime(
                    session=session,
                    showtime_create=showtime,
                )
                observed_by_stream[source_stream].append(
                    scrape_sync_service.ObservedPresence(
                        source_event_key=f"event:{showtime_data.id}",
                        showtime_id=db_showtime.id,
                    )
                )
                logger.info(
                    f"Inserted showtime for movie: {letterboxd_data.title} at {venue_name} on {start_date}"
                )
            except Exception as e:
                if source_stream is not None:
                    stream_errors[source_stream].append(str(e))
                logger.error(
                    f"Failed to insert showtime for movie: {letterboxd_data.title} at {venue_name} on {start_date}. Error: {e}"
                )
    return observed_by_stream, stream_errors, stream_started_at


async def _process_cineville_movie_async(
    *,
    movie_data: Any,
    session: aiohttp.ClientSession,
    default_started_at: datetime,
) -> tuple[
    dict[str, list[scrape_sync_service.ObservedPresence]],
    dict[str, list[str]],
    dict[str, datetime],
]:
    movie_title = getattr(movie_data, "title", "<unknown>")
    try:
        title_query = clean_title(movie_data.title)
        actors = movie_data.cast
        actor = actors[0] if actors else None
        directors = movie_data.directors or []

        tmdb_id = await find_tmdb_id_async(
            session=session,
            title_query=title_query,
            actor_name=actor,
            director_names=directors,
        )
        if tmdb_id is None:
            logger.warning(f"TMDB ID not found for movie: {title_query}")
            return defaultdict(list), defaultdict(list), {}

        letterboxd_data = await scrape_letterboxd_async(
            tmdb_id=tmdb_id,
            session=session,
        )
        if letterboxd_data is None:
            logger.warning(f"Letterboxd data not found for TMDB ID: {tmdb_id}")
            return defaultdict(list), defaultdict(list), {}

        showtimes_data = await get_showtimes.get_showtimes_json_async(
            productionId=movie_data.id,
            session=session,
        )
        return await asyncio.to_thread(
            _persist_cineville_movie_results,
            tmdb_id=tmdb_id,
            letterboxd_data=letterboxd_data,
            showtimes_data=showtimes_data,
            default_started_at=default_started_at,
        )
    except Exception:
        logger.exception(f"Failed processing Cineville movie {movie_title}")
        return defaultdict(list), defaultdict(list), {}


async def scrape_cineville_async() -> None:
    default_started_at = now_amsterdam_naive()
    observed_by_stream: dict[str, list[scrape_sync_service.ObservedPresence]] = (
        defaultdict(list)
    )
    stream_errors: dict[str, list[str]] = defaultdict(list)
    stream_started_at: dict[str, datetime] = {}
    semaphore = asyncio.Semaphore(CINEVILLE_CONCURRENCY)

    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20)) as session:
        movies_data = await get_movies.get_movies_json_async(session=session)

        async def process_movie(movie_data: Any):
            async with semaphore:
                return await _process_cineville_movie_async(
                    movie_data=movie_data,
                    session=session,
                    default_started_at=default_started_at,
                )

        results = await asyncio.gather(
            *(process_movie(movie_data) for movie_data in movies_data),
            return_exceptions=True,
        )

    for result in results:
        if isinstance(result, Exception):
            logger.error(f"Cineville worker failed: {result}")
            continue
        observed_local, errors_local, started_local = result
        for source_stream, observed in observed_local.items():
            observed_by_stream[source_stream].extend(observed)
        for source_stream, errors in errors_local.items():
            stream_errors[source_stream].extend(errors)
        for source_stream, started_at in started_local.items():
            stream_started_at.setdefault(source_stream, started_at)

    with get_db_context() as session:
        cineville_streams = {
            f"cineville:{cinema.id}"
            for cinema in cinema_crud.get_cinemas(session=session)
            if cinema.cineville
        }

    all_streams = set(cineville_streams)
    all_streams.update(observed_by_stream.keys())
    all_streams.update(stream_errors.keys())

    for source_stream in all_streams:
        started_at = stream_started_at.get(source_stream, default_started_at)
        errors = stream_errors.get(source_stream, [])
        if errors:
            with get_db_context() as session:
                scrape_sync_service.record_failed_run(
                    session=session,
                    source_stream=source_stream,
                    error="; ".join(errors),
                    started_at=started_at,
                )
            continue

        observed = observed_by_stream.get(source_stream, [])
        with get_db_context() as session:
            status, deleted_count = scrape_sync_service.record_success_run(
                session=session,
                source_stream=source_stream,
                observed_presences=observed,
                started_at=started_at,
            )
        logger.info(
            f"Cineville sync for {source_stream}: status={status.value}, observed={len(observed)}, deleted={deleted_count}"
        )


def scrape_cineville() -> None:
    asyncio.run(scrape_cineville_async())


async def _run_single_cinema_scraper(
    scraper_class: type[BaseCinemaScraper],
) -> None:
    started_at = now_amsterdam_naive()
    source_stream = f"cinema_scraper:{scraper_class.__name__}"
    try:
        scraper: BaseCinemaScraper = await asyncio.to_thread(scraper_class)
        cinema_id = getattr(scraper, "cinema_id", None)
        if cinema_id is not None:
            source_stream = f"cinema_scraper:{cinema_id}"

        observed_pairs = await asyncio.to_thread(scraper.scrape)
        observed = [
            scrape_sync_service.ObservedPresence(
                source_event_key=source_event_key,
                showtime_id=showtime_id,
            )
            for source_event_key, showtime_id in observed_pairs
        ]
        with get_db_context() as session:
            status, deleted_count = scrape_sync_service.record_success_run(
                session=session,
                source_stream=source_stream,
                observed_presences=observed,
                started_at=started_at,
            )
        logger.info(
            f"Cinema scraper sync for {source_stream}: status={status.value}, observed={len(observed)}, deleted={deleted_count}"
        )
    except Exception as e:
        with get_db_context() as session:
            scrape_sync_service.record_failed_run(
                session=session,
                source_stream=source_stream,
                error=str(e),
                started_at=started_at,
            )
        logger.exception(f"Error occurred while scraping with {scraper_class.__name__}")


async def run_cinema_scrapers_async() -> None:
    semaphore = asyncio.Semaphore(CINEMA_SCRAPER_CONCURRENCY)

    async def run_with_limit(scraper_class: type[BaseCinemaScraper]) -> None:
        async with semaphore:
            await _run_single_cinema_scraper(scraper_class)

    await asyncio.gather(*(run_with_limit(scraper_class) for scraper_class in SCRAPERS))


def run_cinema_scrapers() -> None:
    asyncio.run(run_cinema_scrapers_async())


if __name__ == "__main__":
    logger.info("Starting Cineville scraping...")
    scrape_cineville()
    logger.info("Cineville scraping completed.")
    logger.info("Starting cinema scrapers...")
    run_cinema_scrapers()
    logger.info("Cinema scrapers completed.")
