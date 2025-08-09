import json
from datetime import datetime

import requests
from pydantic import BaseModel, Field

from app.scraping.logger import logger


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
    embedded: EventEmbedded = Field(alias="_embedded")

    class Config:
        populate_by_name = True

class Embedded(BaseModel):
    events: list[Event]
class Response(BaseModel):
    embedded: Embedded = Field(alias="_embedded")

    class Config:
        populate_by_name = True

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

    try:
        res = requests.post(
            url,
            headers=headers,
            data=json.dumps(payload),
            timeout=10,
        )
        res.raise_for_status()
    except requests.RequestException as e:
        logger.warning(
            "Failed to fetch showtimes for production ID:",
            productionId,
            "Error:",
            str(e),
        )
        return []

    try:
        response = Response.model_validate(res.json())
    except Exception as e:
        logger.warning(
            "Error parsing showtimes response for production ID:",
            productionId,
            "Error:",
            str(e),
        )
        return []


    clean_events: list[ShowtimeResponse] = []

    for event in response.embedded.events:
        clean_events.append(
            ShowtimeResponse.model_validate(
                {
                    "id": event.id,
                    "startDate": event.startDate,
                    "venueName": event.embedded.venue.name,
                    "ticketUrl": truncate_ticket_link(event.ticketingUrl),
                }
            )
        )

    return clean_events
