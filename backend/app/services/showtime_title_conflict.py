"""Detecting the same screening listed twice under near-identical titles.

Cineville and a cinema's own scraper regularly resolve the same screening to two
different TMDB ids — "LOLA" (Andrew Legge, 2023) instead of Jacques Demy's
"Lola", say. Because a showtime is unique on (cinema, datetime, movie), the two
ids produce two rows for one physical screening, and the site shows the film
twice.

The cinema's own site is treated as the more reliable source, so the Cineville
row is the one that loses. Two things use that rule:

* ``find_conflicting_cinema_scraper_showtime`` — consulted *before* the Cineville
  row is inserted, so the duplicate is never created and the Cineville presence
  attaches to the row the cinema scraper already owns.
* ``app.scraping.runner._delete_cineville_title_conflicts`` — the cleanup pass
  that removes duplicates already in the database (and slots where Cineville
  happened to be scraped before the cinema's own site listed the screening).
"""

import re
import threading
import unicodedata
from dataclasses import dataclass
from datetime import datetime

from rapidfuzz import fuzz
from sqlalchemy import exists
from sqlmodel import Session, col, select

from app.models.movie import Movie
from app.models.showtime import Showtime
from app.models.showtime_source_presence import ShowtimeSourcePresence
from app.utils import clean_title

CINEVILLE_STREAM_PREFIX = "cineville:"
CINEMA_SCRAPER_STREAM_PREFIX = "cinema_scraper:"
TITLE_NORMALIZE_PATTERN = re.compile(r"[^a-z0-9]+")
SINGLE_TOKEN_SIMILARITY_THRESHOLD = 92.0
TITLE_SIMILARITY_THRESHOLD = 85.0

DETECTED_BY_INSERT_GUARD = "insert_guard"
DETECTED_BY_CLEANUP = "cleanup"


@dataclass(frozen=True)
class SourceDisagreement:
    """One screening two sources resolved to two different TMDB ids.

    Every one of these is a TMDB match that is wrong on one side or the other —
    the sources agree a screening exists, at the same cinema and minute, and
    disagree only about which film it is. That makes them the highest-signal
    leads for improving the matcher, which is why the recap reports them.
    """

    cinema_id: int
    showtime_datetime: datetime
    cineville_movie_id: int
    cineville_movie_title: str
    cinema_scraper_movie_id: int
    cinema_scraper_movie_title: str
    detected_by: str


_disagreement_lock = threading.Lock()
_disagreements: list[SourceDisagreement] = []


def record_source_disagreement(disagreement: SourceDisagreement) -> None:
    with _disagreement_lock:
        _disagreements.append(disagreement)


def consume_source_disagreements() -> list[SourceDisagreement]:
    """Return and clear the disagreements seen since the last call."""
    with _disagreement_lock:
        collected = list(_disagreements)
        _disagreements.clear()
    return collected


def normalize_title_for_conflict_match(title: str) -> str:
    cleaned = clean_title(title)
    folded = unicodedata.normalize("NFKD", cleaned)
    ascii_only = "".join(ch for ch in folded if not unicodedata.combining(ch))
    normalized = TITLE_NORMALIZE_PATTERN.sub(" ", ascii_only.lower())
    return re.sub(r"\s+", " ", normalized).strip()


def titles_conflict_match(left_title: str, right_title: str) -> bool:
    left = normalize_title_for_conflict_match(left_title)
    right = normalize_title_for_conflict_match(right_title)
    if not left or not right:
        return False
    if left == right:
        return True

    left_tokens = set(left.split())
    right_tokens = set(right.split())
    if not left_tokens or not right_tokens:
        return False

    if len(left_tokens) > 1 and len(right_tokens) > 1:
        if left_tokens.issubset(right_tokens) or right_tokens.issubset(left_tokens):
            return True
        similarity = max(
            float(fuzz.token_set_ratio(left, right)),
            float(fuzz.ratio(left, right)),
        )
        return similarity >= TITLE_SIMILARITY_THRESHOLD

    similarity = max(
        float(fuzz.token_sort_ratio(left, right)),
        float(fuzz.ratio(left, right)),
    )
    return similarity >= SINGLE_TOKEN_SIMILARITY_THRESHOLD


def find_conflicting_cinema_scraper_showtime(
    *,
    session: Session,
    cinema_id: int,
    showtime_datetime: datetime,
    movie_id: int,
    movie_title: str,
) -> Showtime | None:
    """The cinema-scraper showtime that already covers this screening, if any.

    Matches the slot exactly on (cinema, datetime) — the same key
    ``_delete_cineville_title_conflicts`` uses — and requires the occupant to be
    backed by an active ``cinema_scraper:`` presence, so a Cineville row never
    yields to another Cineville row.
    """
    if not movie_title:
        return None

    has_cinema_scraper_presence = exists(
        select(ShowtimeSourcePresence.id).where(
            ShowtimeSourcePresence.showtime_id == Showtime.id,
            col(ShowtimeSourcePresence.active).is_(True),
            # autoescape: the prefix's underscore is a LIKE single-char wildcard.
            col(ShowtimeSourcePresence.source_stream).startswith(
                CINEMA_SCRAPER_STREAM_PREFIX, autoescape=True
            ),
        )
    )
    stmt = (
        select(Showtime, Movie)
        .join(Movie, col(Movie.id) == col(Showtime.movie_id))
        .where(
            Showtime.cinema_id == cinema_id,
            Showtime.datetime == showtime_datetime,
            Showtime.movie_id != movie_id,
            has_cinema_scraper_presence,
        )
    )
    for showtime, movie in session.exec(stmt).all():
        if titles_conflict_match(movie_title, movie.title):
            record_source_disagreement(
                SourceDisagreement(
                    cinema_id=cinema_id,
                    showtime_datetime=showtime_datetime,
                    cineville_movie_id=movie_id,
                    cineville_movie_title=movie_title,
                    cinema_scraper_movie_id=movie.id,
                    cinema_scraper_movie_title=movie.title,
                    detected_by=DETECTED_BY_INSERT_GUARD,
                )
            )
            return showtime
    return None
