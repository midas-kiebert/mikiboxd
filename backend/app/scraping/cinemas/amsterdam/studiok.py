import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from re import sub

import requests
from bs4 import BeautifulSoup, Tag

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.models.movie import MovieCreate
from app.models.showtime import ShowtimeCreate
from app.scraping.base_cinema_scraper import BaseCinemaScraper
from app.scraping.date_conversion import get_closest_exact_date
from app.scraping.logger import logger
from app.scraping.subtitles import parse_subtitle_label
from app.scraping.title_hints import (
    parse_subtitle_hint_from_title,
    parse_year_hint_from_title,
)
from app.scraping.tmdb_lookup import find_tmdb_id
from app.scraping.tmdb_movie_details import get_tmdb_movie_details
from app.services import movies as movies_services
from app.services import scrape_sync as scrape_sync_service
from app.services import showtimes as showtimes_services

CINEMA = "Studio/K"
FILMS_URL = "https://studio-k.nu/films/"
FILM_SLUG_RE = re.compile(r"https://studio-k\.nu/film/([^\"'/]+)/")


def extract_label_value(soup: BeautifulSoup, label: str) -> str | None:
    """Return the text following a ``<strong>label</strong>`` spec entry."""
    for strong in soup.find_all("strong"):
        if not (isinstance(strong, Tag) and strong.get_text(strip=True) == label):
            continue
        parent = strong.parent
        if not isinstance(parent, Tag):
            return None
        inner_strong = parent.find("strong")
        if isinstance(inner_strong, Tag):
            inner_strong.extract()
        return sub(r"\s+", " ", parent.get_text(strip=True)).strip() or None
    return None


def split_names(value: str | None) -> list[str]:
    if not value:
        return []
    return [name.strip() for name in value.split(",") if name.strip()]


def parse_minutes(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"\d+", value)
    return int(match.group()) if match else None


def parse_year(value: str | None) -> int | None:
    if value and value.strip().isdigit():
        return int(value.strip())
    return None


def extract_film_slugs(html: str) -> list[str]:
    seen: dict[str, None] = {}
    for slug in FILM_SLUG_RE.findall(html):
        seen.setdefault(slug, None)
    return list(seen)


class StudioKScraper(BaseCinemaScraper):
    def __init__(self) -> None:
        with get_db_context() as session:
            self.cinema_id = cinema_crud.get_cinema_id_by_name(
                session=session, name=CINEMA
            )
            if not self.cinema_id:
                logger.error(f"Cinema {CINEMA} not found in database")
                raise ValueError(f"Cinema {CINEMA} not found in database")

    def _process_film_slug(
        self, slug: str
    ) -> tuple[MovieCreate, list[ShowtimeCreate]] | None:
        assert self.cinema_id is not None
        url = f"https://studio-k.nu/film/{slug}/"
        response = requests.get(url, timeout=15)
        response.raise_for_status()

        soup = BeautifulSoup(response.text, "html.parser")
        h1 = soup.find("h1")
        if not isinstance(h1, Tag):
            logger.warning(f"No title found for Studio/K film {slug}, skipping")
            return None
        title_query = h1.get_text(strip=True)

        directors = split_names(extract_label_value(soup, "Regie:"))
        cast = split_names(extract_label_value(soup, "Cast:"))
        actor = cast[0] if cast else None
        spoken_languages = split_names(extract_label_value(soup, "Taal:")) or None
        fallback_subtitles = parse_subtitle_label(
            extract_label_value(soup, "Ondertiteling:")
        )
        if fallback_subtitles is None:
            fallback_subtitles = parse_subtitle_hint_from_title(title_query)
        duration = parse_minutes(extract_label_value(soup, "Speelduur:"))
        year = parse_year(
            extract_label_value(soup, "Jaar:")
        ) or parse_year_hint_from_title(title_query)

        tmdb_id = find_tmdb_id(
            title_query=title_query,
            director_names=directors,
            actor_name=actor,
            year=year,
            duration_minutes=duration,
            spoken_languages=spoken_languages,
        )
        if tmdb_id is None:
            logger.warning(f"No TMDB id found for {title_query}, skipping")
            return None

        tmdb_details = get_tmdb_movie_details(tmdb_id)
        if tmdb_details is None:
            logger.warning(
                f"TMDB details not found for TMDB ID {tmdb_id}; using fallback metadata."
            )

        tmdb_directors = (
            tmdb_details.directors if tmdb_details is not None else directors
        )
        movie = MovieCreate(
            id=int(tmdb_id),
            title=tmdb_details.title if tmdb_details is not None else title_query,
            letterboxd_slug=None,
            directors=tmdb_directors if tmdb_directors else None,
            release_year=(
                tmdb_details.release_year if tmdb_details is not None else year
            ),
            duration=(
                tmdb_details.runtime_minutes if tmdb_details is not None else duration
            ),
            languages=(
                tmdb_details.spoken_languages
                if tmdb_details is not None
                else spoken_languages
            ),
            original_title=(
                tmdb_details.original_title if tmdb_details is not None else None
            ),
            tmdb_last_enriched_at=(
                tmdb_details.enriched_at if tmdb_details is not None else None
            ),
        )

        showtimes = self._parse_showtimes(
            soup=soup,
            movie_id=movie.id,
            fallback_subtitles=fallback_subtitles,
            title_query=title_query,
        )
        return movie, showtimes

    def _parse_showtimes(
        self,
        *,
        soup: BeautifulSoup,
        movie_id: int,
        fallback_subtitles: list[str] | None,
        title_query: str,
    ) -> list[ShowtimeCreate]:
        assert self.cinema_id is not None
        showtimes: list[ShowtimeCreate] = []
        shows_ul = soup.find("ul", id="shows")
        if not isinstance(shows_ul, Tag):
            return showtimes

        for day_li in shows_ul.find_all("li", recursive=False):
            if not isinstance(day_li, Tag):
                continue
            day_link = day_li.find("a", class_="sday")
            times_ul = day_li.find("ul")
            if not isinstance(day_link, Tag) or not isinstance(times_ul, Tag):
                continue
            day_text = day_link.get_text(strip=True)

            for show_li in times_ul.find_all("li", recursive=False):
                if not isinstance(show_li, Tag):
                    continue
                time_tag = show_li.find("span", class_="stime")
                ticket_tag = show_li.find("a", class_="tickets")
                if not isinstance(time_tag, Tag) or not isinstance(ticket_tag, Tag):
                    continue
                ticket_link = ticket_tag.get("href")
                if not isinstance(ticket_link, str):
                    continue

                try:
                    showtime_dt = get_closest_exact_date(
                        f"{day_text} {time_tag.get_text(strip=True)}"
                    )
                except ValueError:
                    logger.warning(
                        f"Could not parse Studio/K showtime '{day_text} "
                        f"{time_tag.get_text(strip=True)}' for {title_query}, skipping"
                    )
                    continue

                subtitles_tag = show_li.find("span", class_="subtitles")
                if isinstance(subtitles_tag, Tag):
                    language_word = next(subtitles_tag.stripped_strings, None)
                    subtitles = parse_subtitle_label(language_word)
                else:
                    subtitles = fallback_subtitles

                showtimes.append(
                    ShowtimeCreate(
                        movie_id=movie_id,
                        datetime=showtime_dt,
                        cinema_id=self.cinema_id,
                        ticket_link=ticket_link,
                        subtitles=subtitles,
                    )
                )
        return showtimes

    def scrape(self) -> list[tuple[str, int]]:
        assert self.cinema_id is not None
        response = requests.get(FILMS_URL, timeout=15)
        response.raise_for_status()

        slugs = extract_film_slugs(response.text)
        if not slugs:
            logger.debug("No film slugs found for Studio/K")
            return []

        max_workers = min(len(slugs), self.item_concurrency()) or 1
        movies_by_id: dict[int, MovieCreate] = {}
        showtimes: list[ShowtimeCreate] = []
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_slug = {
                executor.submit(self._process_film_slug, slug): slug for slug in slugs
            }
            for future in as_completed(future_to_slug):
                slug = future_to_slug[future]
                try:
                    result = future.result()
                except Exception:
                    logger.exception(f"Could not process Studio/K film {slug}")
                    continue
                if result is None:
                    continue
                movie, movie_showtimes = result
                movies_by_id[movie.id] = movie
                showtimes.extend(movie_showtimes)

        observed_presences: list[tuple[str, int]] = []
        with get_db_context() as session:
            for movie_create in movies_by_id.values():
                movies_services.upsert_movie(
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


if __name__ == "__main__":
    scraper = StudioKScraper()
    scraper.scrape()
