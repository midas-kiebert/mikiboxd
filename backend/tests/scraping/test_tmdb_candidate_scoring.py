import json
import os
from pathlib import Path
from typing import Any

import pytest

from app.scraping import tmdb
from app.scraping.tmdb_config import TMDB_TITLE_GOOD_FUZZ_THRESHOLD
from app.scraping.tmdb_lookup import (
    find_tmdb_id,
    reset_tmdb_runtime_state,
    set_tmdb_cache_available,
)
from app.scraping.tmdb_normalization import _build_title_variants
from app.scraping.tmdb_parsing import PreEnrichmentTmdbMovieCandidate

_CASES_PATH = (
    Path(__file__).resolve().parents[1] / "fixtures" / "tmdb_resolution_cases.json"
)
_RUN_LIVE_TMDB_RESOLUTION_CASES = os.getenv(
    "RUN_LIVE_TMDB_RESOLUTION_CASES",
    "",
).strip().lower() in {"1", "true", "yes", "on"}


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _load_cases() -> list[dict[str, Any]]:
    if not _CASES_PATH.exists():
        if _RUN_LIVE_TMDB_RESOLUTION_CASES:
            raise FileNotFoundError(
                "RUN_LIVE_TMDB_RESOLUTION_CASES is enabled but "
                f"fixture file was not found: {_CASES_PATH}"
            )
        return []

    payload = json.loads(_CASES_PATH.read_text(encoding="utf-8"))
    cases_raw = payload.get("cases")
    if not isinstance(cases_raw, list):
        raise ValueError("tmdb_resolution_cases.json must contain a top-level 'cases' list")
    cases = [case for case in cases_raw if isinstance(case, dict)]
    return cases


CASES = _load_cases()


@pytest.fixture(scope="module", autouse=True)
def _reset_tmdb_runtime_for_live_cases() -> None:
    if _RUN_LIVE_TMDB_RESOLUTION_CASES:
        # Force uncached lookup behavior so candidates are fetched from TMDB itself.
        reset_tmdb_runtime_state()
        set_tmdb_cache_available(False)


@pytest.mark.skipif(
    not _RUN_LIVE_TMDB_RESOLUTION_CASES,
    reason=(
        "Live TMDB resolution cases are disabled by default. "
        "Set RUN_LIVE_TMDB_RESOLUTION_CASES=1 to run this test."
    ),
)
@pytest.mark.parametrize(
    "case",
    CASES,
    ids=[str(case.get("name", f"case_{index}")) for index, case in enumerate(CASES)],
)
def test_tmdb_resolution_cases_from_json(case: dict[str, Any]) -> None:
    input_raw = case.get("input")
    expected_raw = case.get("expected")
    if not isinstance(input_raw, dict) or not isinstance(expected_raw, dict):
        raise ValueError("Each case must contain 'input' and 'expected' objects")

    actor_name_raw = input_raw.get("actor_name")
    actor_name = (
        actor_name_raw.strip()
        if isinstance(actor_name_raw, str) and actor_name_raw.strip()
        else None
    )
    if actor_name is None:
        actor_names = _string_list(input_raw.get("actor_names"))
        actor_name = actor_names[0] if actor_names else None

    tmdb_id = find_tmdb_id(
        title_query=str(input_raw.get("title_query", "")),
        director_names=_string_list(input_raw.get("director_names")),
        actor_name=actor_name,
        year=_as_int(input_raw.get("year")),
        duration_minutes=_as_int(input_raw.get("duration_minutes")),
        spoken_languages=_string_list(input_raw.get("spoken_languages")),
    )
    assert tmdb_id == _as_int(expected_raw.get("tmdb_id"))


def _candidate_for_title_quality(*, title: str) -> PreEnrichmentTmdbMovieCandidate:
    return PreEnrichmentTmdbMovieCandidate(
        id=1,
        title=title,
        original_title=None,
        release_year=1999,
        original_language="en",
        popularity=0.0,
        source_buckets={"searched"},
    )


def _candidate_quality(
    *,
    movie_id: int,
    title: str,
    popularity: float,
    quality: tmdb.Quality = tmdb.GOOD,
) -> tmdb.CandidateQuality:
    return tmdb.CandidateQuality(
        movie=PreEnrichmentTmdbMovieCandidate(
            id=movie_id,
            title=title,
            original_title=None,
            release_year=2000,
            original_language="en",
            popularity=popularity,
            source_buckets={"searched", "directed", "acted"},
        ),
        source_quality=tmdb.EXCELLENT,
        title_quality=tmdb.GOOD,
        year_quality=tmdb.NONE,
        language_quality=tmdb.NONE,
        quality=quality,
    )


def _details(
    *,
    title: str,
    runtime_minutes: int | None,
    genre_ids: list[int] | None,
) -> tmdb.TmdbMovieDetails:
    return tmdb.TmdbMovieDetails(
        title=title,
        original_title=None,
        release_year=2000,
        directors=[],
        poster_url=None,
        runtime_minutes=runtime_minutes,
        genre_ids=genre_ids,
    )


def test_title_similarity_score_reserves_perfect_for_exact_match() -> None:
    exact_score = tmdb._title_similarity_score(
        normalized_query="the virgin suicides",
        normalized_candidate="the virgin suicides",
    )
    subset_score = tmdb._title_similarity_score(
        normalized_query="the making of the virgin suicides",
        normalized_candidate="the virgin suicides",
    )

    assert exact_score == 100.0
    assert subset_score < 100.0
    assert subset_score >= TMDB_TITLE_GOOD_FUZZ_THRESHOLD


def test_subset_title_quality_remains_good_not_excellent() -> None:
    quality = tmdb.evaluate_title_quality(
        title_variants=["The Making of The Virgin Suicides"],
        movie=_candidate_for_title_quality(title="The Virgin Suicides"),
    )

    assert quality == tmdb.GOOD


def test_duplicate_wrapper_title_quality_is_good_not_excellent() -> None:
    score = tmdb._title_similarity_score(
        normalized_query="all about all about lily chou chou",
        normalized_candidate="all about lily chou chou",
    )
    assert score < 99.0
    assert score >= TMDB_TITLE_GOOD_FUZZ_THRESHOLD

    quality = tmdb.evaluate_title_quality(
        title_variants=['All About "All About Lily Chou-Chou"'],
        movie=_candidate_for_title_quality(title="All About Lily Chou-Chou"),
    )
    assert quality == tmdb.GOOD


def test_ambiguous_good_tie_disambiguates_with_short_doc_preferences() -> None:
    candidate_a = _candidate_quality(
        movie_id=101,
        title="Exact Match",
        popularity=12.0,
    )
    candidate_b = _candidate_quality(
        movie_id=202,
        title="Exact Match",
        popularity=20.0,
    )
    details_by_id = {
        101: _details(title="Exact Match", runtime_minutes=112, genre_ids=[18]),
        202: _details(title="Exact Match", runtime_minutes=42, genre_ids=[99]),
    }

    result = tmdb.pick_tmdb_result(
        candidates=[candidate_a, candidate_b],
        reason="post_enrichment_quality_resolution",
        details_by_id=details_by_id,
    )

    assert result.tmdb_id == 101
    assert result.decision is not None
    assert result.decision.get("reason") == "ambiguous_top_quality_disambiguated"


def test_ambiguous_good_tie_rejects_when_signals_conflict() -> None:
    candidate_a = _candidate_quality(
        movie_id=301,
        title="Exact Match",
        popularity=12.0,
    )
    candidate_b = _candidate_quality(
        movie_id=302,
        title="Exact Match",
        popularity=11.0,
    )
    details_by_id = {
        301: _details(title="Exact Match", runtime_minutes=110, genre_ids=[99]),
        302: _details(title="Exact Match", runtime_minutes=45, genre_ids=[18]),
    }

    result = tmdb.pick_tmdb_result(
        candidates=[candidate_a, candidate_b],
        reason="post_enrichment_quality_resolution",
        details_by_id=details_by_id,
    )

    assert result.tmdb_id is None
    assert result.decision is not None
    assert result.decision.get("reason") == "ambiguous_top_quality"
    disambiguation = result.decision.get("disambiguation")
    assert isinstance(disambiguation, dict)
    assert disambiguation.get("reason") == "signals_not_unique"


def test_ambiguous_good_tie_disambiguates_with_clear_popularity_lead() -> None:
    candidate_a = _candidate_quality(
        movie_id=401,
        title="Exact Match",
        popularity=40.0,
    )
    candidate_b = _candidate_quality(
        movie_id=402,
        title="Exact Match",
        popularity=8.0,
    )
    details_by_id = {
        401: _details(title="Exact Match", runtime_minutes=None, genre_ids=None),
        402: _details(title="Exact Match", runtime_minutes=None, genre_ids=None),
    }

    result = tmdb.pick_tmdb_result(
        candidates=[candidate_a, candidate_b],
        reason="post_enrichment_quality_resolution",
        details_by_id=details_by_id,
    )

    assert result.tmdb_id == 401
    assert result.decision is not None
    assert result.decision.get("reason") == "ambiguous_top_quality_disambiguated"


def test_pick_tmdb_result_ignores_discard_candidates() -> None:
    poor_candidate = _candidate_quality(
        movie_id=1400795,
        title="GEN_",
        popularity=1.0,
        quality=tmdb.POOR,
    )
    discard_candidate = _candidate_quality(
        movie_id=721695,
        title="Gen_Film Anthology",
        popularity=1.0,
        quality=tmdb.DISCARD,
    )

    result = tmdb.pick_tmdb_result(
        candidates=[poor_candidate, discard_candidate],
        reason="post_enrichment_quality_resolution",
    )

    assert result.tmdb_id == 1400795
    assert result.decision is not None
    assert result.decision.get("reason") == "post_enrichment_quality_resolution"


def test_pick_tmdb_result_rejects_when_only_discards() -> None:
    discard_a = _candidate_quality(
        movie_id=9001,
        title="Discard A",
        popularity=0.0,
        quality=tmdb.DISCARD,
    )
    discard_b = _candidate_quality(
        movie_id=9002,
        title="Discard B",
        popularity=0.0,
        quality=tmdb.DISCARD,
    )

    result = tmdb.pick_tmdb_result(
        candidates=[discard_a, discard_b],
        reason="post_enrichment_quality_resolution",
    )

    assert result.tmdb_id is None
    assert result.decision is not None
    assert result.decision.get("reason") == "all_candidates_discarded"


def test_title_variants_include_spaced_pinyin_for_diacritics() -> None:
    variants = _build_title_variants("Chūnfēng Chénzuì de Yèwǎn")
    lowered = {variant.lower() for variant in variants}
    assert "chunfeng chenzui de yewan" in lowered
    assert "chun feng chen zui de ye wan" in lowered

def test_excellent_source_with_title_and_language_contradiction_is_decent() -> None:
    quality = tmdb.determine_pre_enrichment_quality(
        source_quality=tmdb.EXCELLENT,
        title_quality=tmdb.CONTRADICTORY,
        year_quality=tmdb.GOOD,
        language_quality=tmdb.CONTRADICTORY,
    )
    assert quality == tmdb.DECENT


def test_ambiguous_tie_prefers_unique_good_year_and_runtime() -> None:
    candidate_a = tmdb.CandidateQuality(
        movie=PreEnrichmentTmdbMovieCandidate(
            id=15227,
            title="Galaxy Express 999: The Movie",
            original_title=None,
            release_year=1979,
            original_language="ja",
            popularity=1.0,
            source_buckets={"searched", "directed"},
        ),
        source_quality=tmdb.EXCELLENT,
        title_quality=tmdb.GOOD,
        year_quality=tmdb.GOOD,
        language_quality=tmdb.GOOD,
        quality=tmdb.EXCELLENT,
    )
    candidate_b = tmdb.CandidateQuality(
        movie=PreEnrichmentTmdbMovieCandidate(
            id=59717,
            title="Adieu Galaxy Express 999",
            original_title=None,
            release_year=1981,
            original_language="ja",
            popularity=1.0,
            source_buckets={"searched", "directed"},
        ),
        source_quality=tmdb.EXCELLENT,
        title_quality=tmdb.GOOD,
        year_quality=tmdb.POOR,
        language_quality=tmdb.GOOD,
        quality=tmdb.EXCELLENT,
    )

    enrichment_by_id = {
        15227: tmdb.EnrichmentQuality(
            runtime_quality=tmdb.GOOD,
            language_quality=tmdb.GOOD,
            director_quality=tmdb.EXCELLENT,
            actor_quality=tmdb.NONE,
        ),
        59717: tmdb.EnrichmentQuality(
            runtime_quality=tmdb.DECENT,
            language_quality=tmdb.GOOD,
            director_quality=tmdb.EXCELLENT,
            actor_quality=tmdb.NONE,
        ),
    }

    result = tmdb.pick_tmdb_result(
        candidates=[candidate_a, candidate_b],
        reason="post_enrichment_quality_resolution",
        details_by_id={},
        enrichment_by_id=enrichment_by_id,
    )

    assert result.tmdb_id == 15227
    assert result.decision is not None
    assert result.decision.get("reason") == "ambiguous_top_quality_disambiguated"


def test_ambiguous_tie_prefers_stronger_title_quality() -> None:
    candidate_a = tmdb.CandidateQuality(
        movie=PreEnrichmentTmdbMovieCandidate(
            id=696,
            title="Manhattan",
            original_title=None,
            release_year=1979,
            original_language="en",
            popularity=1.0,
            source_buckets={"searched", "directed", "acted"},
        ),
        source_quality=tmdb.EXCELLENT,
        title_quality=tmdb.EXCELLENT,
        year_quality=tmdb.NONE,
        language_quality=tmdb.NONE,
        quality=tmdb.EXCELLENT,
    )
    candidate_b = tmdb.CandidateQuality(
        movie=PreEnrichmentTmdbMovieCandidate(
            id=10440,
            title="Manhattan Murder Mystery",
            original_title=None,
            release_year=1993,
            original_language="en",
            popularity=1.0,
            source_buckets={"directed", "acted"},
        ),
        source_quality=tmdb.GOOD,
        title_quality=tmdb.GOOD,
        year_quality=tmdb.NONE,
        language_quality=tmdb.NONE,
        quality=tmdb.EXCELLENT,
    )

    result = tmdb.pick_tmdb_result(
        candidates=[candidate_a, candidate_b],
        reason="post_enrichment_quality_resolution",
        details_by_id={},
        enrichment_by_id={},
    )

    assert result.tmdb_id == 696
    assert result.decision is not None
    assert result.decision.get("reason") == "ambiguous_top_quality_disambiguated"
