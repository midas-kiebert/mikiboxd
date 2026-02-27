"""Shared TMDB configuration constants and environment-backed tuning values."""

import os
import re

from app.core.config import settings

TMDB_API_KEY: str = str(settings.TMDB_KEY)
SEARCH_PERSON_URL: str = "https://api.themoviedb.org/3/search/person"
CREDITS_URL_TEMPLATE: str = "https://api.themoviedb.org/3/person/{id}/movie_credits"
MOVIE_URL_TEMPLATE: str = "https://api.themoviedb.org/3/movie/{id}"
TMDB_POSTER_BASE_URL: str = "https://image.tmdb.org/t/p/w342"
TMDB_SEARCH_URL: str = "https://api.themoviedb.org/3/search/movie"


def _env_non_negative_int(name: str, default: int) -> int:
    """Read an environment variable as a non-negative integer with a safe default."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(0, int(raw))
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    """Read an environment variable as a non-negative float with a safe default."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return max(0.0, float(raw))
    except ValueError:
        return default


def _env_probability(name: str, default: float) -> float:
    """Read and clamp an environment variable to the probability range [0.0, 1.0]."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        parsed = float(raw)
    except ValueError:
        return default
    return min(1.0, max(0.0, parsed))


TMDB_REFRESH_AFTER_DAYS = _env_non_negative_int("TMDB_REFRESH_AFTER_DAYS", 5)
TMDB_STALE_REFRESH_BASE_PROBABILITY = _env_probability(
    "TMDB_STALE_REFRESH_BASE_PROBABILITY",
    0.05,
)
TMDB_STALE_REFRESH_DAILY_INCREASE = _env_float(
    "TMDB_STALE_REFRESH_DAILY_INCREASE",
    0.03,
)
TMDB_STALE_REFRESH_MAX_PROBABILITY = _env_probability(
    "TMDB_STALE_REFRESH_MAX_PROBABILITY",
    1.0,
)

FUZZ_THRESHOLD = 60
RELAXED_FUZZ_THRESHOLD = 45
STRONG_METADATA_FUZZ_THRESHOLD = 35
TMDB_LOOKUP_PAYLOAD_VERSION = 14
TMDB_MATCH_RUNTIME_ENRICHMENT_LIMIT = _env_non_negative_int(
    "TMDB_MATCH_RUNTIME_ENRICHMENT_LIMIT",
    10,
)
TMDB_NO_TITLE_SEARCH_PENALTY = -24.0
TMDB_TITLE_GOOD_FUZZ_THRESHOLD = 85.0
TMDB_TITLE_PERFECT_FUZZ_THRESHOLD = 99.0
TMDB_TITLE_MEDIUM_FUZZ_THRESHOLD = 70.0
TMDB_AMBIGUOUS_GOOD_OPTION_MARGIN = 2.0
TMDB_PERSON_FUZZ_EVIDENCE_THRESHOLD = 96.0
TMDB_SHORT_RUNTIME_MAX_MINUTES = 60
TMDB_FEATURE_RUNTIME_MIN_MINUTES = 80
TMDB_SHORT_VS_FEATURE_PENALTY = 18.0
TMDB_TITLE_EXACT_BONUS = 28.0
TMDB_TITLE_SUBSET_EXTRA_TOKEN_PENALTY = 6.0
TMDB_TITLE_SUBTITLE_PENALTY = 14.0
TMDB_TITLE_SEQUEL_MISMATCH_PENALTY = 28.0
TMDB_TITLE_SEQUEL_EXTRA_PENALTY = 14.0
TMDB_TITLE_COLLECTION_MARKER_PENALTY = 16.0
TMDB_METADATA_COMPONENT_MIN_MULTIPLIER = 0.35
TMDB_METADATA_COMPONENT_MAX_MULTIPLIER = 1.65
TMDB_AMBIGUOUS_POPULARITY_MIN_RATIO = _env_float(
    "TMDB_AMBIGUOUS_POPULARITY_MIN_RATIO",
    1.8,
)
TMDB_AMBIGUOUS_POPULARITY_MIN_ABS_DELTA = _env_float(
    "TMDB_AMBIGUOUS_POPULARITY_MIN_ABS_DELTA",
    10.0,
)
TMDB_DOCUMENTARY_GENRE_ID = 99
TMDB_SINGLEFLIGHT_WAIT_TIMEOUT_SECONDS = _env_float(
    "TMDB_SINGLEFLIGHT_WAIT_TIMEOUT_SECONDS",
    45.0,
)
PERSON_NAME_SPLIT_RE = re.compile(
    r"\s*(?:,|/|;|&|\band\b|\ben\b)\s*",
    flags=re.IGNORECASE,
)
NON_MOVIE_TITLE_MARKERS = (
    "filmquiz",
    "quiz",
    "masterclass",
    "workshop",
    "filmcursus",
    "filmcollege",
    "lecture",
    "talk",
    "festival",
    "on tour",
    "silent disco",
    "filmblok",
    "filmclub",
    "cinemini",
    "peuterfilmpret",
    "sneak preview",
    "shorts collection",
)
TITLE_COLLECTION_MARKERS = {
    "anthology",
    "behind",
    "collection",
    "complete",
    "documentary",
    "epic",
    "making",
    "story",
    "trilogy",
}
TITLE_STOPWORDS = {
    "a",
    "an",
    "and",
    "de",
    "der",
    "el",
    "het",
    "la",
    "le",
    "of",
    "the",
    "van",
}
ROMAN_NUMERAL_VALUES = {
    "i": 1,
    "ii": 2,
    "iii": 3,
    "iv": 4,
    "v": 5,
    "vi": 6,
    "vii": 7,
    "viii": 8,
    "ix": 9,
    "x": 10,
}
PLACEHOLDER_PERSON_VALUES = {
    "",
    "?",
    "unknown",
    "onbekend",
    "nvt",
    "n.v.t",
    "none",
    "div",
    "diversen",
    "diverse",
    "various",
}
LANGUAGE_ALIASES = {
    "arabic": "ar",
    "cantonese": "zh",
    "chinese": "zh",
    "danish": "da",
    "dutch": "nl",
    "english": "en",
    "finnish": "fi",
    "french": "fr",
    "german": "de",
    "hindi": "hi",
    "italian": "it",
    "japanese": "ja",
    "korean": "ko",
    "mandarin": "zh",
    "nederlands": "nl",
    "norwegian": "no",
    "portuguese": "pt",
    "russian": "ru",
    "spanish": "es",
    "swedish": "sv",
    "turkish": "tr",
}
