import json
from datetime import datetime

import requests


def get_movies_json():
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

    movies_response = requests.post(url, headers=headers, data=json.dumps(payload))
    movies_data = movies_response.json()["data"]["films"]["data"]

    return movies_data
