import asyncio
from datetime import datetime

import aiohttp
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
                "venueName": event.embedded.venue.name,
                "ticketUrl": truncate_ticket_link(event.ticketingUrl),
            }
        )
        for event in parsed_response.embedded.events
    ]


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

    try:
        response = Response.model_validate(res.json())
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
                "venueName": event.embedded.venue.name,
                "ticketUrl": truncate_ticket_link(event.ticketingUrl),
            }
        )
        for event in response.embedded.events
    ]
