"""Shared HTTP helper for the Cineville API with retry + backoff.

The Cineville movie/showtime endpoints rate-limit aggressively (HTTP 429) when
the scrape fans out one request per movie. Without backoff those 429s were
silently swallowed and returned empty showtime lists, which made the presence
tracker believe the showtimes had disappeared and delete them. This helper
retries 429/5xx responses with exponential backoff (honouring ``Retry-After``)
and raises ``CinevilleFetchError`` only once retries are exhausted, so callers
can distinguish a genuine "no results" from a failed fetch.
"""

import asyncio
import random
from collections.abc import Mapping
from typing import Any

import aiohttp

from app.scraping.logger import logger

CINEVILLE_MAX_ATTEMPTS = 5
CINEVILLE_BACKOFF_BASE_SECONDS = 0.5
CINEVILLE_BACKOFF_MAX_SECONDS = 30.0
CINEVILLE_RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})


class CinevilleFetchError(Exception):
    """Raised when a Cineville request keeps failing after all retries."""


def _parse_retry_after(raw: str | None) -> float | None:
    if not raw:
        return None
    try:
        seconds = float(raw)
    except ValueError:
        return None
    if seconds < 0:
        return None
    return min(seconds, CINEVILLE_BACKOFF_MAX_SECONDS)


def _backoff_delay(*, attempt: int, retry_after: float | None) -> float:
    if retry_after is not None:
        base = retry_after
    else:
        base = min(
            CINEVILLE_BACKOFF_MAX_SECONDS,
            CINEVILLE_BACKOFF_BASE_SECONDS * (2 ** (attempt - 1)),
        )
    # Full jitter avoids all workers retrying in lockstep after a shared 429.
    return base + random.uniform(0, base)


async def post_json_with_retry(
    *,
    session: aiohttp.ClientSession,
    url: str,
    headers: Mapping[str, str],
    payload: Any,
    timeout: aiohttp.ClientTimeout,
    context: str,
) -> Any:
    """POST ``payload`` to ``url`` and return the parsed JSON, retrying on 429/5xx.

    Raises ``CinevilleFetchError`` if every attempt fails.
    """
    last_error: str | None = None
    for attempt in range(1, CINEVILLE_MAX_ATTEMPTS + 1):
        try:
            async with session.post(
                url, headers=dict(headers), json=payload, timeout=timeout
            ) as response:
                if response.status in CINEVILLE_RETRY_STATUSES:
                    last_error = f"{response.status} {response.reason}"
                    if attempt < CINEVILLE_MAX_ATTEMPTS:
                        delay = _backoff_delay(
                            attempt=attempt,
                            retry_after=_parse_retry_after(
                                response.headers.get("Retry-After")
                            ),
                        )
                        logger.warning(
                            "Cineville %s got %s (attempt %s/%s); retrying in %.1fs.",
                            context,
                            last_error,
                            attempt,
                            CINEVILLE_MAX_ATTEMPTS,
                            delay,
                        )
                        await asyncio.sleep(delay)
                        continue
                    raise CinevilleFetchError(
                        f"Cineville {context} failed after {CINEVILLE_MAX_ATTEMPTS} "
                        f"attempts: {last_error}"
                    )
                response.raise_for_status()
                return await response.json()
        except (aiohttp.ClientError, asyncio.TimeoutError) as e:
            last_error = f"{type(e).__name__}: {e}"
            if attempt < CINEVILLE_MAX_ATTEMPTS:
                delay = _backoff_delay(attempt=attempt, retry_after=None)
                logger.warning(
                    "Cineville %s error %s (attempt %s/%s); retrying in %.1fs.",
                    context,
                    last_error,
                    attempt,
                    CINEVILLE_MAX_ATTEMPTS,
                    delay,
                )
                await asyncio.sleep(delay)
                continue
            raise CinevilleFetchError(
                f"Cineville {context} failed after {CINEVILLE_MAX_ATTEMPTS} "
                f"attempts: {last_error}"
            ) from e
    # Unreachable: the loop either returns or raises.
    raise CinevilleFetchError(f"Cineville {context} failed: {last_error}")
