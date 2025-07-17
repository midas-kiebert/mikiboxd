import unicodedata
from collections.abc import Sequence

import requests
from rapidfuzz import fuzz
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from app.core.config import settings
from app.scraping.logger import logger

TMDB_API_KEY = settings.TMDB_KEY
SEARCH_PERSON_URL = "https://api.themoviedb.org/3/search/person"
CREDITS_URL_TEMPLATE = "https://api.themoviedb.org/3/person/{id}/movie_credits"
MOVIE_URL_TEMPLATE = "https://api.themoviedb.org/3/movie/{id}"
LETTERBOXD_SEARCH_URL = "https://letterboxd.com/search/"
TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/movie"

FUZZ_THRESHOLD = 60  # Minimum score for a match

session = requests.Session()
retry = Retry(total=15, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
session.mount("https://", HTTPAdapter(max_retries=retry))


def get_person_ids(name: str) -> Sequence[str]:
    response = session.get(
        SEARCH_PERSON_URL, params={"api_key": TMDB_API_KEY, "query": name}
    ).json()

    results = response.get("results", [])
    if not results:
        logger.warning(f"{name} could not be found on TMDB.")
        return []

    return [result["id"] for result in results]


def search_tmdb(title: str) -> list[dict[str, str]]:
    params = {
        "api_key": TMDB_API_KEY,
        "query": title,
    }

    response = requests.get(TMDB_SEARCH_URL, params=params)
    results: list[dict[str, str]] = response.json().get("results", [])
    return results


def get_persons_movies(
    person_id: str, job: str = "Director", year: int | None = None
) -> list[dict[str, str]]:
    credits_url = CREDITS_URL_TEMPLATE.format(id=person_id)
    response = session.get(credits_url, params={"api_key": TMDB_API_KEY}).json()

    movies: list[dict[str, str]] = []

    if job == "Director":
        crew = response.get("crew", [])
        movies = [movie for movie in crew if movie["job"] == job]
    elif job == "Actor":
        movies = response.get("cast", [])

    if year:
        allowed_years = {str(y) for y in range(year - 2, year + 3)}
        movies = [m for m in movies if m.get("release_date", "")[:4] in allowed_years]

    return movies


def strip_accents(text: str) -> str:
    return "".join(
        c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)
    )


def find_tmdb_id(
    title_query: str,
    director_name: str | None = None,
    actor_name: str | None = None,
    year: int | None = None,
) -> tuple[str, str, str] | None:
    directed_movies: list[dict[str, str]] = []
    if director_name:
        director_name = strip_accents(director_name)
        director_ids = get_person_ids(director_name)
        # logger.trace(f"Director ids: {director_ids}")
        for director_id in director_ids:
            directed_movies += get_persons_movies(director_id, "Director", year)
    # logger.trace(f"Directed movies: {[m['title'] for m in directed_movies]}")
    potential_movies: list[dict[str, str]] = []
    if actor_name:
        actor_ids = get_person_ids(actor_name)
        # logger.trace(f"Actor ids: {actor_ids}")
        if not actor_ids:
            potential_movies = directed_movies
        for actor_id in actor_ids:
            acted_movies: list[dict[str, str]] = get_persons_movies(
                actor_id, "Actor", year
            )
            # only add movies where the director also matches
            if directed_movies:
                potential_movies += [
                    m
                    for m in acted_movies
                    if m["id"] in [dm["id"] for dm in directed_movies]
                ]
            else:
                potential_movies += acted_movies
    else:
        potential_movies = directed_movies

    # logger.trace(f"Potential movies for query {title_query}, {director_name}, {actor_name}: {[m['title'] for m in potential_movies]}")

    if not director_name and not actor_name:
        # If no director or actor is specified, search for the title directly
        potential_movies = search_tmdb(title_query)
        if potential_movies:
            best = potential_movies[0]
            logger.debug(
                f"No director or actor specified, using first search result: {best['title']}"
            )
            return (
                best["title"],
                best["id"],
                f"https://image.tmdb.org/t/p/w342{best['poster_path']}",
            )

    if not potential_movies:
        logger.debug(
            f"No potential movies found for '{title_query}' with director '{director_name}' and actor '{actor_name}'."
        )
        return None

    # see if one of them matches with just a search:
    search_results = search_tmdb(title_query)
    # logger.trace(search_results)
    if search_results:
        # Filter out movies that are not in the potential movies
        search_ids = {m["id"] for m in search_results}
        # logger.trace(f"Search ids: {search_ids}")
        potential_movies_filtered = [
            m for m in potential_movies if m["id"] in search_ids
        ]
        # logger.trace(potential_movies_filtered)
        if potential_movies_filtered:
            potential_movies_filtered.sort(key=lambda m: m["popularity"])
            best = potential_movies_filtered[-1]
            # logger.trace(f"Found matching movie in search results: {best['title']}")
            return (
                best["title"],
                best["id"],
                f"https://image.tmdb.org/t/p/w342{best['poster_path']}",
            )

    logger.debug(
        f"No direct match found for '{title_query}' with director '{director_name}' and actor '{actor_name}'. Fuzzy matching..."
    )

    # Score by fuzzy match
    scored = [
        (
            max(
                fuzz.token_set_ratio(title_query.lower(), m["title"].lower()),
                fuzz.token_set_ratio(title_query.lower(), m["original_title"].lower()),
            ),
            m,
        )
        for m in potential_movies
    ]
    best_score, best = max(scored, key=lambda x: x[0])

    if best_score < FUZZ_THRESHOLD:
        logger.debug(
            f"Best match score ({best['title']}) for '{title_query}' is below threshold: {best_score}."
        )
        return None

    poster_url = f"https://image.tmdb.org/t/p/w342{best['poster_path']}"

    return best["title"], best["id"], poster_url


if __name__ == "__main__":
    # Example
    tmdb_id = find_tmdb_id(
        "the adventures of tintin",
        director_name="Steven Spielberg",
        actor_name="sdgsgdfgfdg",
    )
    logger.debug(tmdb_id)
    # logger.debug()
    # print(f"letterboxd.com/tmdb/{tmdb_id}/")
    # logger.debug(search_tmdb("the-graduate")[1])
