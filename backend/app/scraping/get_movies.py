import asyncio
from datetime import datetime

import aiohttp
import requests
from pydantic import BaseModel

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
        session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))

    assert session is not None
    try:
        async with session.post(url, headers=headers, json=payload) as response:
            response.raise_for_status()
            response_json = await response.json()
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
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
