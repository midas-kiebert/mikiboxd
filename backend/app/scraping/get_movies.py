from collections.abc import Collection
from datetime import datetime
from typing import Any

import aiohttp
import requests
from pydantic import BaseModel

from app.scraping.cineville_client import (
    CinevilleFetchError,
    post_json_with_retry,
)
from app.scraping.logger import logger


class Film(BaseModel):
    id: str
    slug: str
    title: str
    cast: list[str] | None
    directors: list[str] | None
    duration: int | None = None
    releaseYear: int | None = None
    spokenLanguages: list[str] | None = None


class FilmResponse(BaseModel):
    data: list[Film]


class ResponseData(BaseModel):
    films: FilmResponse


class Response(BaseModel):
    data: ResponseData


def _movies_payload() -> dict:
    return {
        "operationName": "films",
        "query": """query films($filters: FilmsFilters, $page: CursorPagination) {
    films(
        filters: $filters
        page: $page
    ) {
        count
        totalCount
        data {
        ...film
        }
        ...pageInfo
    }
    }
    fragment film on Film {
    id
    slug
    title
    cast
    directors
    duration
    releaseYear
    spokenLanguages
    }
    fragment pageInfo on ListResponse {
    __typename
    count
    totalCount
    previous
    next
    }""",
        "variables": {
            "filters": {
                "event": {
                    "startDate": {
                        "gte": datetime.utcnow().isoformat(),
                    }
                }
            },
            "page": {"limit": 1000},
        },
    }


async def get_movies_json_async(
    session: aiohttp.ClientSession | None = None,
) -> list[Film]:
    url = "https://cineville.nl/api/graphql"
    headers = {
        "content-type": "application/json",
    }
    payload = _movies_payload()

    close_session = session is None
    if close_session:
        session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=20))

    assert session is not None
    try:
        response_json = await post_json_with_retry(
            session=session,
            url=url,
            headers=headers,
            payload=payload,
            timeout=aiohttp.ClientTimeout(total=20),
            context="films fetch",
        )
    except CinevilleFetchError as e:
        # The whole cineville scrape depends on this list; an empty return makes
        # every cineville stream record a failed run (which never deletes).
        logger.warning(f"Failed to fetch movies data. Error: {e}")
        return []
    finally:
        if close_session:
            await session.close()

    try:
        movies_response = Response.model_validate(response_json)
    except Exception as e:
        logger.warning(f"Error parsing movies response. Error: {e}")
        return []

    return movies_response.data.films.data


PRODUCTIONS_SEARCH_URL = "https://api.cineville.nl/productions/search"
# Ids per request; one request covers today's ~700 films with room to spare.
PRODUCTIONS_CHUNK_SIZE = 1000


def _film_from_production(production: dict[str, Any]) -> Film:
    attributes = production.get("attributes") or {}
    return Film(
        id=production["id"],
        slug=production["slug"],
        title=production["title"],
        cast=attributes.get("cast"),
        directors=attributes.get("directors"),
        duration=attributes.get("duration"),
        releaseYear=attributes.get("releaseYear"),
        spokenLanguages=attributes.get("spokenLanguages"),
    )


async def get_films_by_production_ids_async(
    session: aiohttp.ClientSession,
    production_ids: Collection[str],
) -> list[Film]:
    """The films behind these production ids, from Cineville's REST API.

    Replaces the website's GraphQL `films` query (`get_movies_json_async`),
    which went down with a server-side 500 on 23 Sep 2026 and took every
    Cineville scrape with it. api.cineville.nl — the same API the event listing
    comes from — serves the same fields. Raises `CinevilleFetchError` when a
    request keeps failing, like the event listing, so the run fails as a whole.
    """
    ids = sorted(production_ids)
    films: list[Film] = []
    for start in range(0, len(ids), PRODUCTIONS_CHUNK_SIZE):
        chunk = ids[start : start + PRODUCTIONS_CHUNK_SIZE]
        response_json = await post_json_with_retry(
            session=session,
            url=f"{PRODUCTIONS_SEARCH_URL}?page[limit]={len(chunk)}",
            headers={"Content-Type": "application/json"},
            payload={"id": {"in": chunk}},
            timeout=aiohttp.ClientTimeout(total=60),
            context=f"productions fetch ({len(chunk)} ids)",
        )
        films.extend(
            _film_from_production(production)
            for production in response_json["_embedded"]["productions"]
            if production.get("productionTypeId", "film") == "film"
        )
    return films


def get_movies_json() -> list[Film]:
    url = "https://cineville.nl/api/graphql"

    headers = {
        "content-type": "application/json",
    }

    payload = _movies_payload()

    try:
        res = requests.post(url, headers=headers, json=payload, timeout=10)
        res.raise_for_status()
    except requests.RequestException as e:
        logger.warning(f"Failed to fetch movies data. Error: {e}")
        return []

    try:
        movies_response = Response.model_validate(res.json())
    except Exception as e:
        logger.warning(f"Error parsing movies response. Error: {e}")
        return []

    return movies_response.data.films.data


if __name__ == "__main__":
    movies = get_movies_json()
    print(movies[0])
