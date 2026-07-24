from datetime import datetime

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
