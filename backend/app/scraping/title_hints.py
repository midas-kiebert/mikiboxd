"""Hints recoverable from a raw scraped movie title/slug.

Several cinema sites encode extra metadata as a free-text suffix on the
title (in parentheses, e.g. "Toy Story 5 (NL)", "Oldboy (2003, ENG subs)") or
in a URL slug (e.g. "bird-1988", "minions-monsters-ov") instead of (or in
addition to) a dedicated field. These helpers are deliberately used as
backups only, behind whatever structured field a scraper already has.
"""

import re

# A bare "(NL)"/"(OV)" suffix marks the *spoken* language (Dutch dub vs.
# original version) for kids' movies, the only films ever dubbed in Dutch
# cinemas. It says nothing about subtitles, so it's intentionally not in
# this dict, and the app doesn't otherwise model dubs (kids aren't the
# target audience). Only an explicit "subs" marker is an unambiguous
# subtitle hint, and across these sites that's always either Dutch or
# English subtitles.
TITLE_SUBTITLE_SUFFIXES: dict[str, list[str]] = {
    "eng subs": ["en"],
    "en subs": ["en"],
    "english subs": ["en"],
    "engels subs": ["en"],
    "nl subs": ["nl"],
    "dutch subs": ["nl"],
    "nederlandse subs": ["nl"],
}


def parse_subtitle_hint_from_title(title: str) -> list[str] | None:
    """Match a trailing "(...)" suffix against ``TITLE_SUBTITLE_SUFFIXES``.

    Handles both a bare suffix ("(NL)", "(ENG subs)") and a suffix that also
    carries other info ("(2003, ENG subs)").
    """
    match = re.search(r"\(([^)]*)\)\s*$", title)
    if not match:
        return None
    suffix = match.group(1).strip().lower()
    if suffix in TITLE_SUBTITLE_SUFFIXES:
        return TITLE_SUBTITLE_SUFFIXES[suffix]
    for marker, codes in TITLE_SUBTITLE_SUFFIXES.items():
        if marker.endswith("subs") and marker in suffix:
            return codes
    return None


_YEAR_RE = re.compile(r"(?<!\d)(19\d{2}|20\d{2})(?!\d)")


def parse_year_hint_from_title(title: str) -> int | None:
    """Pull a 4-digit release year out of a title or slug, e.g.
    "Boogie Nights (1997)" or "bird-1988".
    """
    match = _YEAR_RE.search(title)
    return int(match.group()) if match else None
