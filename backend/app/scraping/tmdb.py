from collections import Counter
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import IntEnum
from typing import Any

from rapidfuzz import fuzz

from app.scraping.logger import logger
from app.scraping.tmdb_config import (
    TMDB_AMBIGUOUS_POPULARITY_MIN_ABS_DELTA,
    TMDB_AMBIGUOUS_POPULARITY_MIN_RATIO,
    TMDB_DOCUMENTARY_GENRE_ID,
    TMDB_SHORT_RUNTIME_MAX_MINUTES,
    TMDB_TITLE_GOOD_FUZZ_THRESHOLD,
    TMDB_TITLE_MEDIUM_FUZZ_THRESHOLD,
    TMDB_TITLE_PERFECT_FUZZ_THRESHOLD,
    TMDB_TITLE_SUBSET_EXTRA_TOKEN_PENALTY,
)
from app.scraping.tmdb_normalization import (
    _normalize_language_code,
    _normalize_language_codes,
    _normalize_person_name_for_fuzzy,
    _normalize_title_for_match,
)
from app.scraping.tmdb_parsing import PreEnrichmentTmdbMovieCandidate


class Quality(IntEnum):
    DISCARD = -2
    CONTRADICTORY = -1
    NONE = 0
    POOR = 1
    DECENT = 2
    GOOD = 3
    EXCELLENT = 4
    PERFECT = 5


DISCARD = Quality.DISCARD
CONTRADICTORY = Quality.CONTRADICTORY
NONE = Quality.NONE
POOR = Quality.POOR
DECENT = Quality.DECENT
GOOD = Quality.GOOD
EXCELLENT = Quality.EXCELLENT
PERFECT = Quality.PERFECT


@dataclass(frozen=True)
class TmdbMovieDetails:
    title: str
    original_title: str | None
    release_year: int | None
    directors: list[str]
    poster_url: str | None
    original_language: str | None = None
    spoken_languages: list[str] | None = None
    runtime_minutes: int | None = None
    cast_names: list[str] | None = None
    enriched_at: datetime | None = None
    genre_ids: list[int] | None = None


@dataclass(frozen=True)
class TmdbLookupResult:
    tmdb_id: int | None
    confidence: float | None
    decision: dict[str, Any] | None = None


@dataclass(frozen=True)
class CandidateQuality:
    movie: PreEnrichmentTmdbMovieCandidate
    source_quality: Quality
    title_quality: Quality
    year_quality: Quality
    language_quality: Quality
    quality: Quality


@dataclass(frozen=True)
class EnrichmentQuality:
    runtime_quality: Quality
    language_quality: Quality
    director_quality: Quality
    actor_quality: Quality

    def has_contradiction(self) -> bool:
        return (
            self.runtime_quality == CONTRADICTORY
            or self.language_quality == CONTRADICTORY
            or self.director_quality == CONTRADICTORY
            or self.actor_quality == CONTRADICTORY
        )

    def has_strong_support(self) -> bool:
        return (
            self.runtime_quality >= GOOD
            or self.language_quality >= GOOD
            or self.director_quality >= GOOD
            or self.actor_quality >= GOOD
        )

    def strong_support_count(self) -> int:
        return (
            int(self.runtime_quality >= GOOD)
            + int(self.language_quality >= GOOD)
            + int(self.director_quality >= GOOD)
            + int(self.actor_quality >= GOOD)
        )


RuntimeDetailsFetcher = Callable[[list[int]], dict[int, TmdbMovieDetails | None]]
AsyncRuntimeDetailsFetcher = Callable[
    [list[int]], Awaitable[dict[int, TmdbMovieDetails | None]]
]


def _candidate_base_snapshot(candidate: CandidateQuality) -> dict[str, Any]:
    return {
        "id": candidate.movie.id,
        "title": candidate.movie.title,
        "original_title": candidate.movie.original_title,
        "release_year": candidate.movie.release_year,
        "original_language": candidate.movie.original_language,
        "popularity": candidate.movie.popularity,
        "source_buckets": sorted(candidate.movie.source_buckets),
        "pre": {
            "source_quality": candidate.source_quality.name,
            "title_quality": candidate.title_quality.name,
            "year_quality": candidate.year_quality.name,
            "language_quality": candidate.language_quality.name,
            "overall_quality": candidate.quality.name,
        },
    }


def _details_snapshot(details: TmdbMovieDetails | None) -> dict[str, Any] | None:
    if details is None:
        return None
    is_short = (
        details.runtime_minutes <= TMDB_SHORT_RUNTIME_MAX_MINUTES
        if details.runtime_minutes is not None
        else None
    )
    genre_ids = details.genre_ids or []
    is_documentary = TMDB_DOCUMENTARY_GENRE_ID in genre_ids if genre_ids else None
    return {
        "release_year": details.release_year,
        "original_language": details.original_language,
        "spoken_languages": details.spoken_languages or [],
        "runtime_minutes": details.runtime_minutes,
        "directors": details.directors,
        "cast_names": details.cast_names or [],
        "genre_ids": genre_ids,
        "is_short": is_short,
        "is_documentary": is_documentary,
    }


def evaluate_source_quality(source_buckets: set[str]) -> Quality:
    from_search = "searched" in source_buckets
    from_director = "directed" in source_buckets
    from_actor = "acted" in source_buckets

    if from_search and (from_director or from_actor):
        return EXCELLENT
    if from_director and from_actor:
        return GOOD
    if from_director or from_actor:
        return DECENT
    if from_search:
        return POOR
    return DISCARD


def _counter_subset(
    *,
    left: Counter[str],
    right: Counter[str],
) -> bool:
    return all(count <= right.get(token, 0) for token, count in left.items())


def _title_similarity_score(
    *, normalized_query: str, normalized_candidate: str
) -> float:
    if not normalized_query or not normalized_candidate:
        return 0.0
    if normalized_query == normalized_candidate:
        # Reserve perfect 100 only for exact normalized title equality.
        return 100.0

    ratio_score = float(fuzz.ratio(normalized_query, normalized_candidate))
    token_set_score = float(
        fuzz.token_set_ratio(normalized_query, normalized_candidate)
    )

    query_tokens = normalized_query.split()
    candidate_tokens = normalized_candidate.split()
    query_counter = Counter(query_tokens)
    candidate_counter = Counter(candidate_tokens)
    if (
        query_tokens
        and candidate_tokens
        and query_tokens != candidate_tokens
        and (
            _counter_subset(
                left=query_counter,
                right=candidate_counter,
            )
            or _counter_subset(
                left=candidate_counter,
                right=query_counter,
            )
        )
    ):
        token_set_score = max(
            0.0, token_set_score - TMDB_TITLE_SUBSET_EXTRA_TOKEN_PENALTY
        )

    # Non-exact textual matches must stay below perfect.
    token_set_score = min(token_set_score, 99.0)
    return max(ratio_score, token_set_score)


def evaluate_title_quality(
    *,
    title_variants: Sequence[str],
    movie: PreEnrichmentTmdbMovieCandidate,
) -> Quality:
    normalized_titles = [
        _normalize_title_for_match(movie.title),
        _normalize_title_for_match(movie.original_title or ""),
    ]

    best_fuzz = 0.0
    for variant in title_variants:
        normalized_variant = _normalize_title_for_match(variant)
        if not normalized_variant:
            continue
        for candidate_title in normalized_titles:
            if not candidate_title:
                continue
            best_fuzz = max(
                best_fuzz,
                _title_similarity_score(
                    normalized_query=normalized_variant,
                    normalized_candidate=candidate_title,
                ),
            )

    if best_fuzz >= TMDB_TITLE_PERFECT_FUZZ_THRESHOLD:
        return EXCELLENT
    if best_fuzz >= TMDB_TITLE_GOOD_FUZZ_THRESHOLD:
        return GOOD
    if best_fuzz >= TMDB_TITLE_MEDIUM_FUZZ_THRESHOLD:
        return DECENT
    if best_fuzz >= 55.0:
        return NONE
    return CONTRADICTORY


def evaluate_year_quality(
    *, query_year: int | None, release_year: int | None
) -> Quality:
    if query_year is None or release_year is None:
        return NONE
    diff = abs(release_year - query_year)
    if diff == 0:
        return GOOD
    if diff == 1:
        return DECENT
    if diff <= 3:
        return POOR
    return CONTRADICTORY


def evaluate_pre_enrichment_language_quality(
    *,
    query_languages: set[str],
    candidate_original_language: str | None,
) -> Quality:
    if not query_languages or not candidate_original_language:
        return NONE
    normalized_candidate = _normalize_language_code(candidate_original_language)
    if normalized_candidate is None:
        return NONE
    if normalized_candidate in query_languages:
        return GOOD
    return CONTRADICTORY


def determine_pre_enrichment_quality(
    *,
    source_quality: Quality,
    title_quality: Quality,
    year_quality: Quality,
    language_quality: Quality,
) -> Quality:
    if source_quality <= DISCARD:
        return DISCARD

    if source_quality == EXCELLENT:
        if title_quality == EXCELLENT:
            if year_quality >= GOOD and language_quality >= GOOD:
                return PERFECT
            if year_quality >= NONE and language_quality >= NONE:
                return EXCELLENT
        if title_quality >= GOOD or (year_quality >= GOOD and language_quality >= GOOD):
            return GOOD
        return DECENT

    if source_quality == GOOD:
        if (
            title_quality == EXCELLENT
            and year_quality >= NONE
            and language_quality >= NONE
        ):
            return EXCELLENT
        if title_quality >= GOOD and year_quality >= NONE:
            return GOOD
        if title_quality >= DECENT:
            return DECENT
        return POOR

    if source_quality == DECENT:
        if title_quality == EXCELLENT and (
            year_quality >= GOOD or language_quality >= GOOD
        ):
            return GOOD
        if title_quality >= GOOD:
            return DECENT
        if title_quality >= DECENT and (
            year_quality >= NONE or language_quality >= NONE
        ):
            return DECENT
        return POOR

    if source_quality == POOR:
        # Search-only can still be upgraded by very strong title+metadata.
        if title_quality == EXCELLENT and (
            year_quality >= GOOD or language_quality >= GOOD
        ):
            return GOOD
        if title_quality >= GOOD and (
            year_quality >= DECENT or language_quality >= DECENT
        ):
            return DECENT
        return POOR

    return DISCARD


def evaluate_pre_enrichment_candidates(
    *,
    candidates: list[PreEnrichmentTmdbMovieCandidate],
    title_variants: Sequence[str],
    query_year: int | None,
    spoken_languages: Sequence[str],
) -> list[CandidateQuality]:
    query_languages = set(_normalize_language_codes(spoken_languages))
    evaluated: list[CandidateQuality] = []

    for movie in candidates:
        source_quality = evaluate_source_quality(movie.source_buckets)
        title_quality = evaluate_title_quality(
            title_variants=title_variants, movie=movie
        )
        year_quality = evaluate_year_quality(
            query_year=query_year, release_year=movie.release_year
        )
        language_quality = evaluate_pre_enrichment_language_quality(
            query_languages=query_languages,
            candidate_original_language=movie.original_language,
        )

        overall = determine_pre_enrichment_quality(
            source_quality=source_quality,
            title_quality=title_quality,
            year_quality=year_quality,
            language_quality=language_quality,
        )
        evaluated.append(
            CandidateQuality(
                movie=movie,
                source_quality=source_quality,
                title_quality=title_quality,
                year_quality=year_quality,
                language_quality=language_quality,
                quality=overall,
            )
        )

    return sorted(evaluated, key=lambda item: item.quality, reverse=True)


def select_enrichment_candidates(
    *,
    candidates: Sequence[CandidateQuality],
    runtime_enrichment_limit: int,
) -> list[int]:
    if not candidates:
        return []

    limit = max(1, runtime_enrichment_limit)
    selected: list[int] = []

    # Prioritize strong candidates first.
    for candidate in candidates:
        if candidate.quality >= GOOD:
            selected.append(candidate.movie.id)
    # Fill remaining slots from the current ranking so medium candidates can overtake.
    if len(selected) < limit:
        for candidate in candidates:
            if candidate.movie.id in selected:
                continue
            selected.append(candidate.movie.id)
            if len(selected) >= limit:
                break

    return selected[:limit]


def evaluate_duration_quality(
    *,
    query_duration_minutes: int | None,
    candidate_duration_minutes: int | None,
) -> Quality:
    if query_duration_minutes is None or candidate_duration_minutes is None:
        return NONE
    diff = abs(query_duration_minutes - candidate_duration_minutes)
    if diff <= 2:
        return GOOD
    if diff <= 8:
        return DECENT
    if diff <= 20:
        return POOR
    return CONTRADICTORY


def evaluate_person_name_quality(
    *,
    query_names: Sequence[str],
    candidate_names: Sequence[str] | None,
) -> Quality:
    if not query_names or not candidate_names:
        return NONE

    normalized_queries = [
        _normalize_person_name_for_fuzzy(name)
        for name in query_names
        if _normalize_person_name_for_fuzzy(name)
    ]
    normalized_candidates = [
        _normalize_person_name_for_fuzzy(name)
        for name in candidate_names
        if _normalize_person_name_for_fuzzy(name)
    ]
    if not normalized_queries or not normalized_candidates:
        return NONE

    best_fuzz = 0.0
    for query_name in normalized_queries:
        for candidate_name in normalized_candidates:
            best_fuzz = max(
                best_fuzz,
                float(fuzz.token_sort_ratio(query_name, candidate_name)),
                float(fuzz.token_set_ratio(query_name, candidate_name)),
            )

    if best_fuzz >= 97.0:
        return EXCELLENT
    if best_fuzz >= 94.0:
        return GOOD
    if best_fuzz >= 90.0:
        return DECENT
    if best_fuzz >= 85.0:
        return POOR
    return CONTRADICTORY


def details_languages(details: TmdbMovieDetails | None) -> set[str]:
    if details is None:
        return set()

    languages: set[str] = set()
    if details.original_language:
        normalized_original = _normalize_language_code(details.original_language)
        if normalized_original:
            languages.add(normalized_original)
    if details.spoken_languages:
        languages.update(_normalize_language_codes(details.spoken_languages))
    return languages


def evaluate_enrichment_language_quality(
    *,
    query_languages: set[str],
    details: TmdbMovieDetails | None,
) -> Quality:
    detail_languages = details_languages(details)
    if not query_languages or not detail_languages:
        return NONE
    if query_languages.intersection(detail_languages):
        return GOOD
    return CONTRADICTORY


def build_enrichment_quality(
    *,
    details: TmdbMovieDetails | None,
    query_duration_minutes: int | None,
    query_languages: set[str],
    query_director_names: Sequence[str],
    query_actor_names: Sequence[str],
) -> EnrichmentQuality:
    return EnrichmentQuality(
        runtime_quality=evaluate_duration_quality(
            query_duration_minutes=query_duration_minutes,
            candidate_duration_minutes=details.runtime_minutes if details else None,
        ),
        language_quality=evaluate_enrichment_language_quality(
            query_languages=query_languages,
            details=details,
        ),
        director_quality=evaluate_person_name_quality(
            query_names=query_director_names,
            candidate_names=details.directors if details else None,
        ),
        actor_quality=evaluate_person_name_quality(
            query_names=query_actor_names,
            candidate_names=details.cast_names if details else None,
        ),
    )


def determine_post_enrichment_quality(
    *,
    pre_quality: Quality,
    enrichment: EnrichmentQuality,
    has_viable_higher_option: bool,
) -> Quality:
    if pre_quality in {PERFECT, EXCELLENT}:
        if enrichment.has_contradiction():
            return GOOD
        return pre_quality

    if pre_quality == GOOD:
        if enrichment.has_contradiction():
            return DECENT
        if enrichment.strong_support_count() >= 2:
            return EXCELLENT
        return GOOD

    if pre_quality == DECENT:
        if enrichment.has_contradiction():
            return POOR
        if (
            enrichment.director_quality >= GOOD or enrichment.actor_quality >= GOOD
        ) and (
            enrichment.runtime_quality >= DECENT
            or enrichment.language_quality >= DECENT
        ):
            return GOOD
        if enrichment.strong_support_count() >= 2:
            return GOOD
        if enrichment.has_strong_support():
            return GOOD
        return DISCARD

    if pre_quality == POOR:
        if enrichment.has_contradiction():
            return DISCARD
        if (
            enrichment.director_quality >= GOOD or enrichment.actor_quality >= GOOD
        ) and (
            enrichment.runtime_quality >= DECENT
            or enrichment.language_quality >= DECENT
        ):
            return GOOD
        if enrichment.director_quality >= GOOD or enrichment.actor_quality >= GOOD:
            return DECENT
        if enrichment.strong_support_count() >= 2:
            return DECENT
        if enrichment.has_strong_support() and not has_viable_higher_option:
            return DECENT
        if not has_viable_higher_option:
            return POOR
        return DISCARD

    return pre_quality


def apply_enrichment_to_candidates(
    *,
    pre_candidates: Sequence[CandidateQuality],
    details_by_id: dict[int, TmdbMovieDetails | None],
    query_duration_minutes: int | None,
    spoken_languages: Sequence[str],
    director_names: Sequence[str],
    actor_names: Sequence[str],
) -> tuple[list[CandidateQuality], dict[int, EnrichmentQuality], dict[int, bool]]:
    query_languages = set(_normalize_language_codes(spoken_languages))
    enrichment_by_id: dict[int, EnrichmentQuality] = {}
    contradiction_by_id: dict[int, bool] = {}

    for candidate in pre_candidates:
        enrichment = build_enrichment_quality(
            details=details_by_id.get(candidate.movie.id),
            query_duration_minutes=query_duration_minutes,
            query_languages=query_languages,
            query_director_names=director_names,
            query_actor_names=actor_names,
        )
        enrichment_by_id[candidate.movie.id] = enrichment
        contradiction_by_id[candidate.movie.id] = enrichment.has_contradiction()

    adjusted: list[CandidateQuality] = []
    for candidate in pre_candidates:
        has_viable_higher_option = any(
            other.quality > candidate.quality
            and not contradiction_by_id.get(other.movie.id, False)
            for other in pre_candidates
            if other.movie.id != candidate.movie.id
        )
        new_quality = determine_post_enrichment_quality(
            pre_quality=candidate.quality,
            enrichment=enrichment_by_id[candidate.movie.id],
            has_viable_higher_option=has_viable_higher_option,
        )
        adjusted.append(
            CandidateQuality(
                movie=candidate.movie,
                source_quality=candidate.source_quality,
                title_quality=candidate.title_quality,
                year_quality=candidate.year_quality,
                language_quality=candidate.language_quality,
                quality=new_quality,
            )
        )

    sorted_adjusted = sorted(adjusted, key=lambda item: item.quality, reverse=True)
    return sorted_adjusted, enrichment_by_id, contradiction_by_id


def confidence_from_quality(quality: Quality) -> float | None:
    if quality == PERFECT:
        return 99.0
    if quality == EXCELLENT:
        return 93.0
    if quality == GOOD:
        return 80.0
    if quality == DECENT:
        return 65.0
    if quality == POOR:
        return 50.0
    return None


def _details_short_flag(details: TmdbMovieDetails | None) -> bool | None:
    if details is None or details.runtime_minutes is None:
        return None
    return details.runtime_minutes <= TMDB_SHORT_RUNTIME_MAX_MINUTES


def _details_documentary_flag(details: TmdbMovieDetails | None) -> bool | None:
    if details is None or not details.genre_ids:
        return None
    return TMDB_DOCUMENTARY_GENRE_ID in details.genre_ids


def _clear_popularity_leader(
    *,
    candidates: Sequence[CandidateQuality],
) -> tuple[int | None, dict[str, Any]]:
    ranked = sorted(candidates, key=lambda item: item.movie.popularity, reverse=True)
    if not ranked:
        return None, {"active": False, "reason": "no_candidates"}
    if len(ranked) == 1:
        return ranked[0].movie.id, {
            "active": True,
            "reason": "single_candidate",
            "leader_id": ranked[0].movie.id,
            "leader_popularity": ranked[0].movie.popularity,
        }

    leader = ranked[0]
    runner_up = ranked[1]
    leader_popularity = float(leader.movie.popularity)
    runner_up_popularity = float(runner_up.movie.popularity)
    popularity_delta = leader_popularity - runner_up_popularity
    popularity_ratio = (
        leader_popularity / runner_up_popularity if runner_up_popularity > 0.0 else None
    )
    meets_delta = popularity_delta >= TMDB_AMBIGUOUS_POPULARITY_MIN_ABS_DELTA
    meets_ratio = (
        leader_popularity >= TMDB_AMBIGUOUS_POPULARITY_MIN_ABS_DELTA
        if runner_up_popularity <= 0.0
        else leader_popularity
        >= runner_up_popularity * TMDB_AMBIGUOUS_POPULARITY_MIN_RATIO
    )

    diagnostics = {
        "active": meets_delta and meets_ratio,
        "leader_id": leader.movie.id,
        "leader_popularity": leader_popularity,
        "runner_up_id": runner_up.movie.id,
        "runner_up_popularity": runner_up_popularity,
        "delta": popularity_delta,
        "ratio": popularity_ratio,
        "delta_threshold": TMDB_AMBIGUOUS_POPULARITY_MIN_ABS_DELTA,
        "ratio_threshold": TMDB_AMBIGUOUS_POPULARITY_MIN_RATIO,
    }
    if not diagnostics["active"]:
        return None, diagnostics
    return leader.movie.id, diagnostics


def _disambiguate_ambiguous_top_quality(
    *,
    top: Sequence[CandidateQuality],
    details_by_id: Mapping[int, TmdbMovieDetails | None] | None,
    enrichment_by_id: Mapping[int, EnrichmentQuality] | None,
) -> tuple[CandidateQuality | None, dict[str, Any] | None]:
    if not top or top[0].quality < GOOD:
        return None, None

    diagnostics: dict[str, Any] = {
        "status": "unresolved",
        "top_candidate_ids": [candidate.movie.id for candidate in top],
        "active_signals": [],
    }
    strongest_title_quality = max(candidate.title_quality for candidate in top)
    strongest_title_candidates = sorted(
        candidate.movie.id
        for candidate in top
        if candidate.title_quality == strongest_title_quality
    )
    if len(strongest_title_candidates) == 1:
        winner_id = strongest_title_candidates[0]
        winner = next(
            (candidate for candidate in top if candidate.movie.id == winner_id),
            None,
        )
        if winner is not None:
            diagnostics["active_signals"] = [
                {
                    "signal": "prefer_stronger_title_quality",
                    "preferred_candidate_ids": [winner_id],
                    "strongest_title_quality": strongest_title_quality.name,
                    "strongest_title_quality_candidate_ids": strongest_title_candidates,
                }
            ]
            diagnostics["remaining_candidate_ids"] = [winner_id]
            diagnostics["status"] = "resolved"
            diagnostics["reason"] = "signals_converged"
            diagnostics["winner_id"] = winner_id
            return winner, diagnostics

    if enrichment_by_id is not None:
        good_year_and_runtime_ids = sorted(
            candidate.movie.id
            for candidate in top
            if candidate.year_quality >= GOOD
            and (enrichment := enrichment_by_id.get(candidate.movie.id)) is not None
            and enrichment.runtime_quality >= GOOD
        )
        if len(good_year_and_runtime_ids) == 1:
            winner_id = good_year_and_runtime_ids[0]
            winner = next(
                (candidate for candidate in top if candidate.movie.id == winner_id),
                None,
            )
            if winner is not None:
                diagnostics["active_signals"] = [
                    {
                        "signal": "prefer_good_year_and_runtime",
                        "preferred_candidate_ids": [winner_id],
                        "good_year_and_runtime_candidate_ids": good_year_and_runtime_ids,
                    }
                ]
                diagnostics["remaining_candidate_ids"] = [winner_id]
                diagnostics["status"] = "resolved"
                diagnostics["reason"] = "signals_converged"
                diagnostics["winner_id"] = winner_id
                return winner, diagnostics

    if details_by_id is None:
        diagnostics["reason"] = "missing_enrichment_details"
        return None, diagnostics

    remaining_ids = {candidate.movie.id for candidate in top}
    active_signals: list[dict[str, Any]] = []

    short_ids: set[int] = set()
    non_short_ids: set[int] = set()
    unknown_runtime_ids: set[int] = set()
    for candidate in top:
        short_flag = _details_short_flag(details_by_id.get(candidate.movie.id))
        if short_flag is True:
            short_ids.add(candidate.movie.id)
        elif short_flag is False:
            non_short_ids.add(candidate.movie.id)
        else:
            unknown_runtime_ids.add(candidate.movie.id)
    if non_short_ids and short_ids:
        preferred_ids = sorted(non_short_ids | unknown_runtime_ids)
        active_signals.append(
            {
                "signal": "prefer_non_short",
                "preferred_candidate_ids": preferred_ids,
                "short_candidate_ids": sorted(short_ids),
                "non_short_candidate_ids": sorted(non_short_ids),
                "unknown_runtime_candidate_ids": sorted(unknown_runtime_ids),
            }
        )
        remaining_ids.intersection_update(preferred_ids)

    documentary_ids: set[int] = set()
    non_documentary_ids: set[int] = set()
    unknown_genre_ids: set[int] = set()
    for candidate in top:
        documentary_flag = _details_documentary_flag(
            details_by_id.get(candidate.movie.id)
        )
        if documentary_flag is True:
            documentary_ids.add(candidate.movie.id)
        elif documentary_flag is False:
            non_documentary_ids.add(candidate.movie.id)
        else:
            unknown_genre_ids.add(candidate.movie.id)
    if non_documentary_ids and documentary_ids:
        preferred_ids = sorted(non_documentary_ids | unknown_genre_ids)
        active_signals.append(
            {
                "signal": "prefer_non_documentary",
                "preferred_candidate_ids": preferred_ids,
                "documentary_candidate_ids": sorted(documentary_ids),
                "non_documentary_candidate_ids": sorted(non_documentary_ids),
                "unknown_genre_candidate_ids": sorted(unknown_genre_ids),
            }
        )
        remaining_ids.intersection_update(preferred_ids)

    popularity_leader_id, popularity_diagnostics = _clear_popularity_leader(
        candidates=top
    )
    if popularity_leader_id is not None:
        active_signals.append(
            {
                "signal": "prefer_much_more_popular",
                "preferred_candidate_ids": [popularity_leader_id],
                "diagnostics": popularity_diagnostics,
            }
        )
        remaining_ids.intersection_update({popularity_leader_id})

    diagnostics["active_signals"] = active_signals
    diagnostics["remaining_candidate_ids"] = sorted(remaining_ids)
    if not active_signals:
        diagnostics["reason"] = "no_clear_disambiguation_signal"
        return None, diagnostics
    if len(remaining_ids) != 1:
        diagnostics["reason"] = "signals_not_unique"
        return None, diagnostics

    winner_id = next(iter(remaining_ids))
    winner = next(
        (candidate for candidate in top if candidate.movie.id == winner_id), None
    )
    if winner is None:
        diagnostics["reason"] = "winner_not_found"
        return None, diagnostics
    diagnostics["status"] = "resolved"
    diagnostics["reason"] = "signals_converged"
    diagnostics["winner_id"] = winner_id
    return winner, diagnostics


def pick_tmdb_result(
    *,
    candidates: Sequence[CandidateQuality],
    reason: str,
    trace: dict[str, Any] | None = None,
    details_by_id: Mapping[int, TmdbMovieDetails | None] | None = None,
    enrichment_by_id: Mapping[int, EnrichmentQuality] | None = None,
) -> TmdbLookupResult:
    if not candidates:
        return TmdbLookupResult(
            tmdb_id=None,
            confidence=None,
            decision={
                "status": "rejected",
                "reason": reason,
                "candidates_considered": 0,
                "trace": trace,
            },
        )

    viable_candidates = [
        candidate for candidate in candidates if candidate.quality > DISCARD
    ]
    if not viable_candidates:
        return TmdbLookupResult(
            tmdb_id=None,
            confidence=None,
            decision={
                "status": "rejected",
                "reason": "all_candidates_discarded",
                "trace": trace,
            },
        )

    best_quality = viable_candidates[0].quality
    top = [
        candidate
        for candidate in viable_candidates
        if candidate.quality == best_quality
    ]

    if best_quality == POOR and len(viable_candidates) > 1:
        return TmdbLookupResult(
            tmdb_id=None,
            confidence=None,
            decision={
                "status": "rejected",
                "reason": "only_poor_options_with_alternatives",
                "trace": trace,
            },
        )

    if len(top) > 1:
        disambiguation: dict[str, Any] | None = None
        winner: CandidateQuality | None = None
        if best_quality >= GOOD:
            winner, disambiguation = _disambiguate_ambiguous_top_quality(
                top=top,
                details_by_id=details_by_id,
                enrichment_by_id=enrichment_by_id,
            )
            if trace is not None and disambiguation is not None:
                trace["ambiguous_top_quality_disambiguation"] = disambiguation

        if winner is not None:
            return TmdbLookupResult(
                tmdb_id=winner.movie.id,
                confidence=confidence_from_quality(winner.quality),
                decision={
                    "status": "accepted",
                    "reason": "ambiguous_top_quality_disambiguated",
                    "winner_quality": winner.quality.name,
                    "winner_id": winner.movie.id,
                    "disambiguation": disambiguation,
                    "trace": trace,
                },
            )

        decision: dict[str, Any] = {
            "status": "rejected",
            "reason": "ambiguous_top_quality",
            "top_quality": best_quality.name,
            "top_candidate_ids": [candidate.movie.id for candidate in top],
            "trace": trace,
        }
        if disambiguation is not None:
            decision["disambiguation"] = disambiguation
        return TmdbLookupResult(
            tmdb_id=None,
            confidence=None,
            decision=decision,
        )

    winner = top[0]
    return TmdbLookupResult(
        tmdb_id=winner.movie.id,
        confidence=confidence_from_quality(winner.quality),
        decision={
            "status": "accepted",
            "reason": reason,
            "winner_quality": winner.quality.name,
            "winner_id": winner.movie.id,
            "trace": trace,
        },
    )


def run_pre_enrichment_phase(
    *,
    title_query: str,
    title_variants: list[str],
    candidate_pool: list[PreEnrichmentTmdbMovieCandidate],
    year: int | None,
    spoken_languages: Sequence[str],
) -> list[CandidateQuality]:
    if not candidate_pool:
        logger.debug("No candidates available for '%s'.", title_query)
        return []
    lookup_title_variants = title_variants or [title_query]
    return evaluate_pre_enrichment_candidates(
        candidates=candidate_pool,
        title_variants=lookup_title_variants,
        query_year=year,
        spoken_languages=spoken_languages,
    )


def finalize_resolution(
    *,
    pre_candidates: Sequence[CandidateQuality],
    director_names: Sequence[str],
    actor_names: Sequence[str],
    duration_minutes: int | None,
    spoken_languages: Sequence[str],
    details_by_id: dict[int, TmdbMovieDetails | None] | None,
    enrichment_candidate_ids: Sequence[int] | None = None,
) -> TmdbLookupResult:
    if not pre_candidates:
        return TmdbLookupResult(
            tmdb_id=None,
            confidence=None,
            decision={
                "status": "rejected",
                "reason": "no_pre_candidates",
                "trace": {
                    "enrichment_requested": details_by_id is not None,
                    "candidates": [],
                },
            },
        )

    pre_ranked = list(pre_candidates)
    pre_by_id: dict[int, CandidateQuality] = {
        candidate.movie.id: candidate for candidate in pre_ranked
    }
    decision_trace: dict[str, Any] = {
        "enrichment_requested": details_by_id is not None,
        "enrichment_candidate_ids": list(enrichment_candidate_ids or []),
        "candidates": [_candidate_base_snapshot(candidate) for candidate in pre_ranked],
    }

    perfect = [candidate for candidate in pre_ranked if candidate.quality == PERFECT]
    if len(perfect) == 1:
        return pick_tmdb_result(
            candidates=perfect,
            reason="single_perfect_pre_enrichment",
            trace=decision_trace,
            details_by_id=details_by_id,
            enrichment_by_id=None,
        )

    if details_by_id is None:
        return pick_tmdb_result(
            candidates=pre_ranked,
            reason="pre_enrichment_only",
            trace=decision_trace,
            details_by_id=None,
            enrichment_by_id=None,
        )

    enriched_candidates, enrichment_by_id, contradiction_by_id = (
        apply_enrichment_to_candidates(
            pre_candidates=pre_ranked,
            details_by_id=details_by_id,
            query_duration_minutes=duration_minutes,
            spoken_languages=spoken_languages,
            director_names=director_names,
            actor_names=actor_names,
        )
    )
    post_by_id: dict[int, CandidateQuality] = {
        candidate.movie.id: candidate for candidate in enriched_candidates
    }
    post_rank_by_id = {
        candidate.movie.id: index + 1
        for index, candidate in enumerate(enriched_candidates)
    }
    for candidate_snapshot in decision_trace["candidates"]:
        movie_id_raw = candidate_snapshot.get("id")
        if not isinstance(movie_id_raw, int):
            continue
        pre_candidate = pre_by_id.get(movie_id_raw)
        post_candidate = post_by_id.get(movie_id_raw)
        if pre_candidate is None or post_candidate is None:
            continue
        has_viable_higher_option = any(
            other.quality > pre_candidate.quality
            and not contradiction_by_id.get(other.movie.id, False)
            for other in pre_ranked
            if other.movie.id != movie_id_raw
        )
        enrichment = enrichment_by_id.get(movie_id_raw)
        candidate_snapshot["details"] = _details_snapshot(
            details_by_id.get(movie_id_raw)
        )
        if enrichment is None:
            candidate_snapshot["enrichment"] = None
        else:
            candidate_snapshot["enrichment"] = {
                "runtime_quality": enrichment.runtime_quality.name,
                "language_quality": enrichment.language_quality.name,
                "director_quality": enrichment.director_quality.name,
                "actor_quality": enrichment.actor_quality.name,
                "has_contradiction": enrichment.has_contradiction(),
                "strong_support_count": enrichment.strong_support_count(),
                "has_viable_higher_option": has_viable_higher_option,
            }
        candidate_snapshot["post"] = {
            "overall_quality": post_candidate.quality.name,
            "rank": post_rank_by_id.get(movie_id_raw),
        }

    decision_trace["post_enrichment_order"] = [
        {
            "id": candidate.movie.id,
            "quality": candidate.quality.name,
        }
        for candidate in enriched_candidates
    ]
    return pick_tmdb_result(
        candidates=enriched_candidates,
        reason="post_enrichment_quality_resolution",
        trace=decision_trace,
        details_by_id=details_by_id,
        enrichment_by_id=enrichment_by_id,
    )


def resolve_tmdb(
    *,
    title_query: str,
    title_variants: list[str],
    director_names: list[str],
    actor_names: list[str],
    candidate_pool: list[PreEnrichmentTmdbMovieCandidate],
    year: int | None,
    duration_minutes: int | None,
    spoken_languages: list[str],
    runtime_enrichment_limit: int,
    fetch_runtime_details: RuntimeDetailsFetcher | None = None,
) -> TmdbLookupResult:
    pre_candidates = run_pre_enrichment_phase(
        title_query=title_query,
        title_variants=title_variants,
        candidate_pool=candidate_pool,
        year=year,
        spoken_languages=spoken_languages,
    )
    if not pre_candidates:
        return TmdbLookupResult(
            tmdb_id=None,
            confidence=None,
            decision={
                "status": "rejected",
                "reason": "no_candidates",
                "trace": {
                    "enrichment_requested": fetch_runtime_details is not None,
                    "enrichment_candidate_ids": [],
                    "candidates": [],
                },
            },
        )

    if fetch_runtime_details is None:
        return finalize_resolution(
            pre_candidates=pre_candidates,
            director_names=director_names,
            actor_names=actor_names,
            duration_minutes=duration_minutes,
            spoken_languages=spoken_languages,
            details_by_id=None,
            enrichment_candidate_ids=None,
        )

    enrichment_ids = select_enrichment_candidates(
        candidates=pre_candidates,
        runtime_enrichment_limit=runtime_enrichment_limit,
    )
    if not enrichment_ids:
        return finalize_resolution(
            pre_candidates=pre_candidates,
            director_names=director_names,
            actor_names=actor_names,
            duration_minutes=duration_minutes,
            spoken_languages=spoken_languages,
            details_by_id=None,
            enrichment_candidate_ids=[],
        )

    details_by_id = fetch_runtime_details(enrichment_ids)
    return finalize_resolution(
        pre_candidates=pre_candidates,
        director_names=director_names,
        actor_names=actor_names,
        duration_minutes=duration_minutes,
        spoken_languages=spoken_languages,
        details_by_id=details_by_id,
        enrichment_candidate_ids=enrichment_ids,
    )


async def resolve_tmdb_lookup_with_optional_enrichment_async(
    *,
    title_query: str,
    title_variants: list[str],
    director_names: list[str],
    actor_names: list[str],
    candidate_pool: list[PreEnrichmentTmdbMovieCandidate],
    year: int | None,
    duration_minutes: int | None,
    spoken_languages: list[str],
    runtime_enrichment_limit: int,
    fetch_runtime_details: AsyncRuntimeDetailsFetcher | None = None,
) -> TmdbLookupResult:
    pre_candidates = run_pre_enrichment_phase(
        title_query=title_query,
        title_variants=title_variants,
        candidate_pool=candidate_pool,
        year=year,
        spoken_languages=spoken_languages,
    )
    if not pre_candidates:
        return TmdbLookupResult(
            tmdb_id=None,
            confidence=None,
            decision={
                "status": "rejected",
                "reason": "no_candidates",
                "trace": {
                    "enrichment_requested": fetch_runtime_details is not None,
                    "enrichment_candidate_ids": [],
                    "candidates": [],
                },
            },
        )

    if fetch_runtime_details is None:
        return finalize_resolution(
            pre_candidates=pre_candidates,
            director_names=director_names,
            actor_names=actor_names,
            duration_minutes=duration_minutes,
            spoken_languages=spoken_languages,
            details_by_id=None,
            enrichment_candidate_ids=None,
        )

    enrichment_ids = select_enrichment_candidates(
        candidates=pre_candidates,
        runtime_enrichment_limit=runtime_enrichment_limit,
    )
    if not enrichment_ids:
        return finalize_resolution(
            pre_candidates=pre_candidates,
            director_names=director_names,
            actor_names=actor_names,
            duration_minutes=duration_minutes,
            spoken_languages=spoken_languages,
            details_by_id=None,
            enrichment_candidate_ids=[],
        )

    details_by_id = await fetch_runtime_details(enrichment_ids)
    return finalize_resolution(
        pre_candidates=pre_candidates,
        director_names=director_names,
        actor_names=actor_names,
        duration_minutes=duration_minutes,
        spoken_languages=spoken_languages,
        details_by_id=details_by_id,
        enrichment_candidate_ids=enrichment_ids,
    )
