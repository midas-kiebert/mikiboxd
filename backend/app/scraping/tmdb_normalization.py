import html
import re
import unicodedata
from collections.abc import Sequence

from app.scraping.tmdb_config import (
    LANGUAGE_ALIASES,
    NON_MOVIE_TITLE_MARKERS,
    PERSON_NAME_SPLIT_RE,
    PLACEHOLDER_PERSON_VALUES,
)

_PINYIN_INITIALS: tuple[str, ...] = (
    "zh",
    "ch",
    "sh",
    "b",
    "p",
    "m",
    "f",
    "d",
    "t",
    "n",
    "l",
    "g",
    "k",
    "h",
    "j",
    "q",
    "x",
    "r",
    "z",
    "c",
    "s",
    "y",
    "w",
    "",
)
_PINYIN_FINALS: tuple[str, ...] = tuple(
    sorted(
        {
            "a",
            "ai",
            "an",
            "ang",
            "ao",
            "e",
            "ei",
            "en",
            "eng",
            "er",
            "i",
            "ia",
            "ian",
            "iang",
            "iao",
            "ie",
            "in",
            "ing",
            "iong",
            "iu",
            "o",
            "ong",
            "ou",
            "u",
            "ua",
            "uai",
            "uan",
            "uang",
            "ue",
            "ui",
            "un",
            "uo",
            "v",
            "ve",
        },
        key=len,
        reverse=True,
    )
)


def strip_accents(text: str) -> str:
    """Strip diacritics from text while preserving base characters for matching operations."""
    return "".join(
        c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)
    )


def _normalize_spaces(text: str) -> str:
    """Collapse repeated whitespace into single spaces and trim boundaries."""
    return " ".join(text.split())


def _contains_diacritics(text: str) -> bool:
    return any(unicodedata.combining(ch) for ch in unicodedata.normalize("NFKD", text))


def _split_pinyin_token(token: str) -> list[str] | None:
    if not token.isalpha() or len(token) < 5:
        return None

    token_lower = token.lower()
    cache: dict[int, list[str] | None] = {}

    def solve(start: int) -> list[str] | None:
        if start == len(token_lower):
            return []
        if start in cache:
            return cache[start]

        for initial in _PINYIN_INITIALS:
            if initial and not token_lower.startswith(initial, start):
                continue
            middle = start + len(initial)
            if middle >= len(token_lower):
                continue
            for final in _PINYIN_FINALS:
                if not token_lower.startswith(final, middle):
                    continue
                end = middle + len(final)
                tail = solve(end)
                if tail is None:
                    continue
                cache[start] = [token[start:end], *tail]
                return cache[start]

        cache[start] = None
        return None

    parts = solve(0)
    if parts is None or len(parts) < 2:
        return None
    return parts


def _build_pinyin_spaced_variant(title: str) -> str | None:
    words = title.split()
    expanded_words: list[str] = []
    changed = False
    for word in words:
        split_parts = _split_pinyin_token(word)
        if split_parts is None:
            expanded_words.append(word)
            continue
        expanded_words.extend(split_parts)
        changed = True
    if not changed:
        return None
    return _normalize_spaces(" ".join(expanded_words))


def _normalize_title_search_query(title: str) -> str:
    """Normalize raw title input into a cleaner search query string."""
    normalized = html.unescape(title)
    normalized = normalized.replace("’", "'")
    normalized = normalized.replace("–", "-").replace("—", "-")
    return _normalize_spaces(normalized)


def _normalize_title_for_match(title: str) -> str:
    """Normalize titles into comparable tokens for fuzzy and rule-based matching."""
    normalized = strip_accents(_normalize_title_search_query(title)).lower()
    normalized = re.sub(r"[^\w\s'-]", " ", normalized)
    return _normalize_spaces(normalized)


def _normalize_person_name(name: str) -> str | None:
    """Normalize raw person names and drop known placeholder-style values."""
    normalized = html.unescape(name)
    normalized = strip_accents(normalized)
    normalized = _normalize_spaces(normalized)
    if not normalized:
        return None
    placeholder_key = re.sub(r"[^a-z0-9]+", "", normalized.lower())
    if placeholder_key in PLACEHOLDER_PERSON_VALUES:
        return None
    return normalized


def _expand_person_names(names: Sequence[str | None]) -> list[str]:
    """Split, normalize, and deduplicate person-name strings into canonical query names."""
    expanded: list[str] = []
    seen: set[str] = set()
    for raw_name in names:
        if raw_name is None:
            continue
        unescaped_name = html.unescape(raw_name)
        for part in PERSON_NAME_SPLIT_RE.split(unescaped_name):
            normalized = _normalize_person_name(part)
            if normalized is None:
                continue
            dedupe_key = normalized.lower()
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            expanded.append(normalized)
    return expanded


def _build_title_variants(title_query: str) -> list[str]:
    """Generate alternative title query variants to improve TMDB recall."""
    base = _normalize_title_search_query(title_query)
    if not base:
        return []
    candidates: list[str] = [base]

    without_brackets = _normalize_spaces(re.sub(r"\([^)]*\)", " ", base))
    if without_brackets and without_brackets != base:
        candidates.append(without_brackets)

    if _contains_diacritics(base):
        ascii_variant = _normalize_spaces(strip_accents(base))
        if ascii_variant and ascii_variant != base:
            candidates.append(ascii_variant)
            pinyin_spaced = _build_pinyin_spaced_variant(ascii_variant)
            if pinyin_spaced and pinyin_spaced != ascii_variant:
                candidates.append(pinyin_spaced)

    for candidate in list(candidates):
        for separator in (":", " - ", " – ", " — ", " –", " —"):
            if separator not in candidate:
                continue
            _, tail = candidate.split(separator, 1)
            tail = _normalize_spaces(tail)
            if len(tail) >= 2:
                candidates.append(tail)

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate:
            continue
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped


def _normalize_language_code(value: str | None) -> str | None:
    """Normalize free-form language values into stable TMDB/ISO-style language codes."""
    if value is None:
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    normalized = normalized.replace("_", "-")
    alias = LANGUAGE_ALIASES.get(normalized)
    if alias is not None:
        return alias

    ascii_normalized = "".join(
        ch
        for ch in unicodedata.normalize("NFKD", normalized)
        if not unicodedata.combining(ch)
    )
    compact = re.sub(r"[^a-z0-9-]+", "", ascii_normalized)
    if not compact:
        return None
    alias = LANGUAGE_ALIASES.get(compact)
    if alias is not None:
        return alias
    if "-" in compact:
        compact = compact.split("-", 1)[0]
    if compact.isalpha() and len(compact) in {2, 3}:
        return compact
    return None


def _normalize_language_codes(values: Sequence[str]) -> list[str]:
    """Normalize, deduplicate, and preserve order for a sequence of language values."""
    normalized: list[str] = []
    seen: set[str] = set()
    for value in values:
        language = _normalize_language_code(value)
        if language is None or language in seen:
            continue
        seen.add(language)
        normalized.append(language)
    return normalized


def _normalize_person_name_for_fuzzy(value: str | None) -> str:
    """Normalize a person name into ASCII-like tokens for robust fuzzy comparison."""
    if value is None:
        return ""
    folded = unicodedata.normalize("NFKD", value)
    ascii_only = "".join(ch for ch in folded if not unicodedata.combining(ch))
    normalized = re.sub(r"[^a-z0-9]+", " ", ascii_only.lower())
    return re.sub(r"\s+", " ", normalized).strip()


def _is_probably_non_movie_event(
    *,
    title_query: str,
    director_names: list[str],
    actor_names: list[str],
) -> bool:
    """Heuristically detect non-film events that should skip TMDB ID lookup."""
    normalized_title = _normalize_title_for_match(title_query)
    if not normalized_title:
        return True
    if director_names or actor_names:
        return False
    return any(marker in normalized_title for marker in NON_MOVIE_TITLE_MARKERS)
