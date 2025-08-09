import json
from datetime import datetime

import requests
from pydantic import BaseModel


class Film(BaseModel):
    id: str
    slug: str
    title: str
    cast: list[str] | None
    directors: list[str] | None

class FilmResponse(BaseModel):
    data: list[Film]
class ResponseData(BaseModel):
    films: FilmResponse
class Response(BaseModel):
    data: ResponseData



def get_movies_json() -> list[Film]:
    url = "https://cineville.nl/api/graphql"

    headers = {
        "content-type": "application/json",
    }

    payload = {
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

    movies_response = Response.model_validate(
        requests.post(
            url,
            headers=headers,
            data=json.dumps(payload)
        ).json()
    )
    movies_data = movies_response.data.films.data

    return movies_data

if __name__ == "__main__":
    movies = get_movies_json()
