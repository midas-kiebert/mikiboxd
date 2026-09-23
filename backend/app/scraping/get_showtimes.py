import asyncio
from datetime import datetime
from typing import Any

import aiohttp
import requests
from pydantic import BaseModel, Field

from app.scraping.cineville_client import (
    CinevilleFetchError,
    post_json_with_retry,
)
from app.scraping.logger import logger


class ShowtimeResponse(BaseModel):
    id: str
    startDate: str
    endDate: str | None
    ticketUrl: str | None
    venueName: str
    subtitles: list[str] | None
    # When Cineville itself created/last changed the event. Only the bulk fetch
    # fills these; they feed the publish-timing log (`CinevilleEvent`).
    createdAt: str | None = None
    updatedAt: str | None = None


class CinevilleEventRecord(BaseModel):
    """One event from the bulk event listing, before it is grouped by film."""

    id: str
    productionId: str | None
    venueId: str
    venueName: str
    title: str | None
    startDate: str
    endDate: str | None
    ticketUrl: str | None
    subtitles: list[str] | None
    isHidden: bool
    createdAt: str
    updatedAt: str

    def to_showtime(self) -> ShowtimeResponse:
        return ShowtimeResponse(
            id=self.id,
            startDate=self.startDate,
            endDate=self.endDate,
            ticketUrl=self.ticketUrl,
            venueName=self.venueName,
            subtitles=self.subtitles,
            createdAt=self.createdAt,
            updatedAt=self.updatedAt,
        )


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
        session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=15))

    assert session is not None
    try:
        response_json = await post_json_with_retry(
            session=session,
            url=url,
            headers=headers,
            payload=payload,
            timeout=aiohttp.ClientTimeout(total=15),
            context=f"showtimes fetch (production {productionId})",
        )
    except CinevilleFetchError as e:
        # Propagate so the caller drops this movie for the run rather than
        # treating a rate-limited fetch as "this movie has no showtimes",
        # which would let the presence tracker delete its showtimes.
        logger.warning(
            f"Failed to fetch showtimes for production ID {productionId}. Error: {e}"
        )
        raise
    finally:
        if close_session:
            await session.close()

    return _parse_showtimes_response(
        response_json=response_json,
        productionId=productionId,
    )


CINEVILLE_API_BASE = "https://api.cineville.nl"
EVENTS_PAGE_LIMIT = 1000
# A sweep is ~12 pages today; the cap only guards against a pagination cursor
# that never ends.
EVENTS_MAX_PAGES = 100


async def _get_venue_names_async(session: aiohttp.ClientSession) -> dict[str, str]:
    url = f"{CINEVILLE_API_BASE}/venues?page[limit]=1000"
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=20)) as response:
        response.raise_for_status()
        payload = await response.json()
    return {venue["id"]: venue["name"] for venue in payload["_embedded"]["venues"]}


def _bulk_event_record(
    event: dict[str, Any], venue_names: dict[str, str]
) -> CinevilleEventRecord:
    attributes = event.get("attributes") or {}
    hint = event.get("productionHint") or {}
    return CinevilleEventRecord(
        id=event["id"],
        productionId=event.get("productionId"),
        venueId=event["venueId"],
        venueName=venue_names.get(event["venueId"], event["venueId"]),
        title=hint.get("title"),
        startDate=event["startDate"],
        endDate=event.get("endDate"),
        ticketUrl=truncate_ticket_link(event.get("ticketingUrl")),
        subtitles=event.get("subtitles") or attributes.get("subtitles"),
        isHidden=bool(event.get("isHidden")),
        createdAt=event["createdAt"],
        updatedAt=event["updatedAt"],
    )


async def get_all_events_async(
    session: aiohttp.ClientSession,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    page_delay_seconds: float = 0.0,
) -> list[CinevilleEventRecord]:
    """Every Cineville event starting in [start, end), in a few paged requests.

    `start` defaults to now and `end` to open-ended, i.e. the upcoming
    programme; times are UTC. The backfill script passes a past window.

    Replaces one `get_showtimes_json_async` call per film: the per-film fan-out
    was ~600 requests a run plus ~800 rate-limited retries, and still lost ~35
    films a run to 429s. The listing is fetched without the embedded venue
    (which tripled the payload) and venue names are read once from /venues.

    All or nothing: any page that fails after retries raises
    `CinevilleFetchError`, so a partial listing can never be mistaken for
    screenings having disappeared.
    """
    try:
        venue_names = await _get_venue_names_async(session)
    except (aiohttp.ClientError, asyncio.TimeoutError, KeyError) as e:
        raise CinevilleFetchError(f"Cineville venues fetch failed: {e}") from e

    start_filter = {"gte": (start or datetime.utcnow()).isoformat()}
    if end is not None:
        start_filter["lt"] = end.isoformat()
    payload = {"startDate": start_filter, "sort": {"startDate": "asc"}}
    url: str | None = (
        f"{CINEVILLE_API_BASE}/events/search?page[limit]={EVENTS_PAGE_LIMIT}"
    )
    records: list[CinevilleEventRecord] = []
    for page in range(1, EVENTS_MAX_PAGES + 1):
        if url is None:
            return records
        response_json = await post_json_with_retry(
            session=session,
            url=url,
            headers={"Content-Type": "application/json"},
            payload=payload,
            timeout=aiohttp.ClientTimeout(total=60),
            context=f"events page {page}",
        )
        records.extend(
            _bulk_event_record(event, venue_names)
            for event in response_json["_embedded"]["events"]
        )
        next_link = (response_json.get("_links") or {}).get("next")
        url = f"{CINEVILLE_API_BASE}{next_link['href']}" if next_link else None
        if url is not None and page_delay_seconds:
            await asyncio.sleep(page_delay_seconds)
    raise CinevilleFetchError(
        f"Cineville events listing did not end after {EVENTS_MAX_PAGES} pages"
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
