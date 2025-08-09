import json
from datetime import datetime

import requests


def get_showtimes_json(productionId: str):
    url = "https://api.cineville.nl/events/search?page[limit]=1000"

    headers = {
        "Content-Type": "application/json",
    }

    payload = {
        "productionId": {"eq": productionId},
        "startDate": {"gte": datetime.utcnow().isoformat()},
        "embed": {"venue": True},
        "sort": {"startDate": "asc"},
    }

    response = requests.post(url, headers=headers, data=json.dumps(payload))

    clean_events = []

    for event in response.json()["_embedded"]["events"]:
        ticketUrl: str | None = event["ticketingUrl"]
        if ticketUrl is not None:
            ticketUrl = ticketUrl.split("?utm_source")[0]
            ticketUrl = ticketUrl.split("&utm_source")[0]
        clean_events.append(
            {
                "id": event["id"],
                "startDate": event["startDate"],
                "venueName": event["_embedded"]["venue"]["name"],
                "ticketUrl": ticketUrl,
            }
        )

    return clean_events
