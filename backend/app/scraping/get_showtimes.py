import json
from datetime import datetime

import requests
from pydantic import BaseModel


class ShowtimeResponse(BaseModel):
    id: str
    startDate: str
    ticketUrl: str | None
    venueName: str
class Venue(BaseModel):
    name: str

class EventEmbedded(BaseModel):
    venue: Venue

class Event(BaseModel):
    id: str
    startDate: str
    ticketingUrl: str | None
    _embedded: EventEmbedded

class Embedded(BaseModel):
    events: list[Event]
class Response(BaseModel):
    _embedded: Embedded

def truncate_ticket_link(ticketUrl: str | None) -> str | None:
    if ticketUrl is None:
        return None
    ticketUrl = ticketUrl.split("?utm_source")[0]
    ticketUrl = ticketUrl.split("&utm_source")[0]
    return ticketUrl


def get_showtimes_json(productionId: str) -> list[ShowtimeResponse]:
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

    response = Response.model_validate(
        requests.post(
            url,
            headers=headers,
            data=json.dumps(payload)
        ).json()
    )

    clean_events: list[ShowtimeResponse] = []

    for event in response._embedded.events:
        clean_events.append(
            ShowtimeResponse.model_validate(
                {
                    "id": event.id,
                    "startDate": event.startDate,
                    "venueName": event._embedded.venue.name,
                    "ticketUrl": truncate_ticket_link(event.ticketingUrl),
                }
            )
        )

    return clean_events
