import pytest

from app.scraping.cinemas.amsterdam.eye import _eye_subtitles
from app.scraping.subtitles import parse_subtitle_freetext, parse_subtitle_label


@pytest.mark.parametrize(
    "value, expected",
    [
        # No subtitles.
        ("Geen", []),
        ("geen", []),
        # Single language.
        ("Nederlands", ["nl"]),
        ("Engels", ["en"]),
        ("English", ["en"]),
        ("Dutch", ["nl"]),
        # Either language.
        ("Nederlands of Engels", ["nl", "en"]),
        # Unknown / not stated.
        (None, None),
        ("", None),
        ("   ", None),
        ("Frans", None),
    ],
)
def test_parse_subtitle_label(value: str | None, expected: list[str] | None) -> None:
    assert parse_subtitle_label(value) == expected


@pytest.mark.parametrize(
    "value, expected",
    [
        # Subtitle language stated explicitly.
        ("Engels gesproken, Nederlands ondertiteld", ["nl"]),
        ("Frans gesproken, Nederlands ondertiteld", ["nl"]),
        ("Spaans, Arabisch gesproken, Nederlands ondertiteld", ["nl"]),
        ("Nederlands gesproken, Engels ondertiteld", ["en"]),
        # Explicitly no subtitles (note the source's "gespoken" typo is irrelevant).
        ("Engels gespoken, geen ondertiteling", []),
        ("Geen ondertiteling", []),
        # No subtitle clause at all -> unknown; spoken language is not a subtitle.
        ("Nederlands gesproken", None),
        ("Nederlands", None),
        ("Nederlands, Engels, Spaans, Frans", None),
        (None, None),
    ],
)
def test_parse_subtitle_freetext(value: str | None, expected: list[str] | None) -> None:
    assert parse_subtitle_freetext(value) == expected


@pytest.mark.parametrize(
    "original_language, expected",
    [
        # Eye's English programme subtitles non-English films in English.
        ("fr", ["en"]),
        ("ja", ["en"]),
        ("FR", ["en"]),
        # English-language films: subtitling unknown.
        ("en", None),
        ("EN", None),
        # No language resolved: unknown.
        (None, None),
    ],
)
def test_eye_subtitles(original_language: str | None, expected: list[str] | None) -> None:
    assert _eye_subtitles(original_language) == expected
