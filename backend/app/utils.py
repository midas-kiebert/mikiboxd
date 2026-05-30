"""Generic utility helpers shared across the application."""

import re
from datetime import datetime
from zoneinfo import ZoneInfo

_AMSTERDAM_TZ = ZoneInfo("Europe/Amsterdam")
_UTC = ZoneInfo("UTC")


def now_amsterdam_naive() -> datetime:
    """Return the current datetime in Europe/Amsterdam timezone, as naive (no tzinfo)."""
    return datetime.now(tz=_AMSTERDAM_TZ).replace(tzinfo=None)


def to_amsterdam_time(dt: str) -> datetime:
    """Convert a UTC datetime string to a naive Amsterdam datetime.

    Expected format: "2024-01-15T20:30:00.000000Z" (ISO 8601 UTC, as returned
    by external APIs such as the cinema scraping sources).
    """
    utc_dt = datetime.strptime(dt, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=_UTC)
    return utc_dt.astimezone(_AMSTERDAM_TZ).replace(tzinfo=None)


def clean_title(title: str) -> str:
    """Normalise a movie title for fuzzy matching.

    Lowercases, strips parenthetical suffixes, trims subtitle-like suffixes
    separated by a dash, and collapses whitespace.
    """
    title = title.lower()
    title = re.sub(r"\(.*\)", "", title)  # Remove everything in parentheses
    # Only trim trailing subtitle-like suffixes when dash acts as a separator.
    title = re.sub(r"\s+[-–—]\s+.*$", "", title)
    title = re.sub(r"\s+", " ", title).strip()  # Normalize whitespace
    return title
