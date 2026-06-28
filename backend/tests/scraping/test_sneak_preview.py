"""Sneak previews resolve to the synthetic movie instead of being dropped.

Cinemas program a "sneak preview" (a secret film) without a resolvable TMDB id
and deliberately withhold director/language/runtime. These attach to one
synthetic movie (negative id, "???" metadata) rather than being filtered out.
"""

from app.models.movie import (
    SNEAK_PREVIEW_MOVIE_ID,
    SNEAK_PREVIEW_TITLE,
    is_sneak_preview_title,
    is_synthetic_movie_id,
    sneak_preview_movie,
)
from app.scraping.cinemas.amsterdam.kriterion import Show, get_movie


def test_is_sneak_preview_title_matches_real_world_variants() -> None:
    # Strings observed live across Kriterion, KINO and the Cineville API.
    assert is_sneak_preview_title("SNEAK PREVIEW")
    assert is_sneak_preview_title("Sneak Preview")
    assert is_sneak_preview_title("Sneak Previewdagen")
    assert is_sneak_preview_title("sneak preview")  # slug-derived title query


def test_is_sneak_preview_title_rejects_non_sneaks() -> None:
    assert not is_sneak_preview_title("Sneakers")
    assert not is_sneak_preview_title("Preview Night")
    assert not is_sneak_preview_title("The Zone of Interest")
    assert not is_sneak_preview_title(None)
    assert not is_sneak_preview_title("")


def test_is_synthetic_movie_id() -> None:
    assert is_synthetic_movie_id(SNEAK_PREVIEW_MOVIE_ID)
    assert is_synthetic_movie_id(-1)
    assert not is_synthetic_movie_id(0)
    assert not is_synthetic_movie_id(27205)  # a real TMDB id


def test_sneak_preview_movie_has_negative_id_and_unknown_metadata() -> None:
    movie = sneak_preview_movie()

    assert movie.id == SNEAK_PREVIEW_MOVIE_ID
    assert movie.id < 0
    assert movie.title == SNEAK_PREVIEW_TITLE
    # Everything the cinema keeps secret stays unset -> rendered as "???".
    assert movie.directors is None
    assert movie.cast is None
    assert movie.release_year is None
    assert movie.duration is None
    assert movie.languages is None
    assert movie.original_language is None
    assert movie.letterboxd_slug is None


def test_kriterion_get_movie_routes_sneak_to_synthetic_without_tmdb() -> None:
    # No TMDB stubbing: a sneak must short-circuit before any TMDB lookup.
    show = Show(
        id=1287397,
        production_id=69062,
        name="SNEAK PREVIEW",
        start_date="2026-06-30 21:00:00 +0200",
        duration=110,
    )

    movie = get_movie(show)

    assert movie is not None
    assert movie.id == SNEAK_PREVIEW_MOVIE_ID
    assert movie.title == SNEAK_PREVIEW_TITLE
