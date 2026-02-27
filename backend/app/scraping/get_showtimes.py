import asyncio
from datetime import datetime

import aiohttp
import requests
from pydantic import BaseModel, Field

from app.scraping.logger import logger


class ShowtimeResponse(BaseModel):
    id: str
    startDate: str
    endDate: str | None
    ticketUrl: str | None
    venueName: str
    subtitles: list[str] | None


class Venue(BaseModel):
    name: str


class EventEmbedded(BaseModel):
    venue: Venue


class EventAttributes(BaseModel):
    subtitles: list[str] | None = None


class Event(BaseModel):
    id: str
    startDate: str
    endDate: str | None
    ticketingUrl: str | None
    embedded: EventEmbedded = Field(alias="_embedded")
    attributes: EventAttributes | None = None
    subtitles: list[str] | None = None

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


def _extract_subtitles(event: Event) -> list[str] | None:
    # Subtitles moved under `attributes.subtitles`; keep top-level fallback.
    if event.subtitles is not None:
        return event.subtitles
    if event.attributes is None:
        return None
    return event.attributes.subtitles


def _parse_showtimes_response(
    *,
    response_json,
    productionId: str,
) -> list[ShowtimeResponse]:
    try:
        parsed_response = Response.model_validate(response_json)
    except Exception as e:
        logger.warning(
            f"Error parsing showtimes response for production ID {productionId}. Error: {e}"
        )
        return []

    return [
        ShowtimeResponse.model_validate(
            {
                "id": event.id,
                "startDate": event.startDate,
                "endDate": event.endDate,
                "venueName": event.embedded.venue.name,
                "ticketUrl": truncate_ticket_link(event.ticketingUrl),
                "subtitles": _extract_subtitles(event),
            }
        )
        for event in parsed_response.embedded.events
    ]


async def get_showtimes_json_async(
    productionId: str,
    session: aiohttp.ClientSession | None = None,
) -> list[ShowtimeResponse]:
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

    close_session = session is None
    if close_session:
        session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))

    assert session is not None
    try:
        async with session.post(url, headers=headers, json=payload) as response:
            response.raise_for_status()
            response_json = await response.json()
    except (aiohttp.ClientError, asyncio.TimeoutError) as e:
        logger.warning(
            f"Failed to fetch showtimes for production ID {productionId}. Error: {e}"
        )
        return []
    finally:
        if close_session:
            await session.close()

    return _parse_showtimes_response(
        response_json=response_json,
        productionId=productionId,
    )


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
            json=payload,
            timeout=10,
        )
        res.raise_for_status()
    except requests.RequestException as e:
        logger.warning(
            f"Failed to fetch showtimes for production ID {productionId}. Error: {e}"
        )
        return []

    return _parse_showtimes_response(
        response_json=res.json(),
        productionId=productionId,
    )


if __name__ == "__main__":
    pid = "f112c04f-52a6-4018-8edd-7b4888693672"
    showtimes_json = get_showtimes_json(pid)
    print(showtimes_json)
