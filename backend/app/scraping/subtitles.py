"""Parse cinema subtitle metadata into ISO-639-1 language codes.

The cinema sites describe subtitles as Dutch free text. We normalise that to
the ``list[str]`` shape stored on ``Showtime.subtitles`` (codes match
``app.core.enums.Language``):

- ``[]``           -> screened without subtitles
- ``["nl"]``       -> Dutch subtitles
- ``["en"]``       -> English subtitles
- ``["nl", "en"]`` -> Dutch or English subtitles
- ``None``         -> unknown / not stated
"""

import re

# Subtitle-language words (Dutch, plus the odd English spelling) -> ISO-639-1.
_LANGUAGE_CODES: dict[str, str] = {
    "nederlands": "nl",
    "nedrlands": "nl",  # studio-k.nu typo
    "dutch": "nl",
    "engels": "en",
    "english": "en",
}

_NO_SUBTITLES_RE = re.compile(r"\bgeen\b")
_SUBTITLE_MARKER = "ondertitel"


def _codes_in(text: str) -> list[str]:
    codes: list[str] = []
    for word, code in _LANGUAGE_CODES.items():
        if word in text and code not in codes:
            codes.append(code)
    return codes


def parse_subtitle_label(value: str | None) -> list[str] | None:
    """Parse a dedicated subtitle field (an "Ondertitels"/"Ondertiteling" value).

    The whole value describes the subtitles, e.g. ``"Geen"``, ``"Nederlands"``,
    ``"Engels"``, ``"Nederlands of Engels"``.
    """
    if value is None:
        return None
    text = value.strip().lower()
    if not text:
        return None
    if _NO_SUBTITLES_RE.search(text):
        return []
    return _codes_in(text) or None


def parse_subtitle_freetext(value: str | None) -> list[str] | None:
    """Parse a combined spoken+subtitle description (FC Hyena's "Taal").

    Examples: ``"Engels gesproken, Nederlands ondertiteld"``,
    ``"Engels gesproken, geen ondertiteling"``, ``"Nederlands gesproken"``.

    Only the subtitle clause (the language stated right before
    ``"ondertiteld"``) is used; a value that mentions no subtitles at all stays
    unknown, so a spoken language is never mistaken for a subtitle language.
    """
    if value is None:
        return None
    text = value.lower()
    if _SUBTITLE_MARKER not in text:
        return None
    if _NO_SUBTITLES_RE.search(text):
        return []
    # Drop the spoken-language portion ("... gesproken, " / "...,") so only the
    # clause immediately before "ondertiteld" is inspected.
    clause = text.split(_SUBTITLE_MARKER, 1)[0]
    for separator in ("gesproken,", "gesproken", ","):
        if separator in clause:
            clause = clause.rsplit(separator, 1)[-1]
            break
    return _codes_in(clause) or None
