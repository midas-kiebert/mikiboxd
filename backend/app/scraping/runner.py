import base64
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from html import escape
from pathlib import Path
from typing import Any

from sqlmodel import Session, col, delete, select

from app.api.deps import get_db_context
from app.mailer import send_email
from app.models.cinema import Cinema
from app.models.movie import Movie
from app.models.scrape_recap import ScrapeRecap
from app.models.scrape_run import ScrapeRun, ScrapeRunStatus
from app.models.showtime import Showtime
from app.models.showtime_source_presence import ShowtimeSourcePresence
from app.scraping.letterboxd.load_letterboxd_data import (
    backfill_missing_letterboxd_data,
    consume_letterboxd_failure_events,
    reset_letterboxd_request_budget,
)
from app.scraping.logger import logger
from app.scraping.scrape import (
    ScrapeExecutionSummary,
    run_cinema_scrapers,
    scrape_cineville,
)
from app.scraping.tmdb_runtime import (
    consume_tmdb_lookup_events,
    reset_tmdb_runtime_state,
)
from app.services import scrape_sync as scrape_sync_service
from app.services.scrape_recap_render import RecapRunMetrics, render_recap_html
from app.services.scrape_sync import DeletedShowtimeInfo
from app.services.showtime_title_conflict import (
    CINEMA_SCRAPER_STREAM_PREFIX,
    CINEVILLE_STREAM_PREFIX,
    DETECTED_BY_CLEANUP,
    TITLE_NORMALIZE_PATTERN,
    SourceDisagreement,
    consume_source_disagreements,
    record_source_disagreement,
    titles_conflict_match,
)
from app.utils import now_amsterdam_naive

RECAP_EMAIL_TO = "scraper.mikino@midaskiebert.nl"
RECAP_AGGREGATION_WINDOW = timedelta(hours=24)
STAGE_PATTERN = re.compile(r"(^|\s)stage=([^|]+)")
TMDB_LOW_CONFIDENCE_THRESHOLD = 80.0
TMDB_RECAP_ATTACHMENT_MAX_ITEMS = 300
TMDB_RESOLUTION_AUDIT_DIR_NAME = "tmp_tmdb_resolution_audit"
TMDB_MARKDOWN_CANDIDATE_LIMIT = 5


@dataclass(frozen=True)
class FutureSnapshot:
    showtime_ids: set[int]
    movie_ids: set[int]


@dataclass(frozen=True)
class ScrapeRunDetail:
    source_stream: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    duration_seconds: float | None
    observed_showtime_count: int | None
    error: str | None


@dataclass(frozen=True)
class PendingMissDetail:
    source_stream: str
    movie_title: str
    cinema_name: str
    showtime_datetime: datetime
    showtime_id: int
    missing_streak: int


@dataclass
class _ShowtimeSourceFlags:
    showtime_id: int
    movie_id: int
    movie_title: str
    cinema_id: int
    datetime: datetime
    has_cineville_source: bool = False
    has_cinema_scraper_source: bool = False


def _delete_cineville_title_conflicts(*, session: Session) -> list[DeletedShowtimeInfo]:
    """Remove Cineville duplicates of a screening a cinema scraper also listed.

    A backstop for rows the insert-time guard in ``upsert_showtime`` cannot
    catch: duplicates already in the database, and slots where Cineville was
    scraped before the cinema's own site listed the screening.
    """
    stmt = (
        select(
            ShowtimeSourcePresence,
            Showtime,
            Movie,
        )
        .select_from(ShowtimeSourcePresence)
        .join(
            Showtime,
            col(Showtime.id) == col(ShowtimeSourcePresence.showtime_id),
        )
        .join(
            Movie,
            col(Movie.id) == col(Showtime.movie_id),
        )
        .where(
            col(ShowtimeSourcePresence.active).is_(True),
            Showtime.datetime >= now_amsterdam_naive(),
        )
    )
    rows = list(session.exec(stmt).all())
    if not rows:
        return []

    showtimes: dict[int, _ShowtimeSourceFlags] = {}
    showtimes_by_slot: defaultdict[tuple[int, datetime], list[int]] = defaultdict(list)

    for presence, showtime, movie in rows:
        source_stream = presence.source_stream
        if not source_stream.startswith(
            (CINEVILLE_STREAM_PREFIX, CINEMA_SCRAPER_STREAM_PREFIX)
        ):
            continue
        showtime_id = showtime.id
        existing = showtimes.get(showtime_id)
        if existing is None:
            existing = _ShowtimeSourceFlags(
                showtime_id=int(showtime_id),
                movie_id=int(showtime.movie_id),
                movie_title=str(movie.title),
                cinema_id=int(showtime.cinema_id),
                datetime=showtime.datetime,
            )
            showtimes[showtime_id] = existing
            showtimes_by_slot[(existing.cinema_id, existing.datetime)].append(
                showtime_id
            )

        if source_stream.startswith(CINEVILLE_STREAM_PREFIX):
            existing.has_cineville_source = True
        if source_stream.startswith(CINEMA_SCRAPER_STREAM_PREFIX):
            existing.has_cinema_scraper_source = True

    ids_to_delete: set[int] = set()
    for slot_showtime_ids in showtimes_by_slot.values():
        cinema_scraper_showtimes = [
            showtimes[showtime_id]
            for showtime_id in slot_showtime_ids
            if showtimes[showtime_id].has_cinema_scraper_source
        ]
        if not cinema_scraper_showtimes:
            continue

        for showtime_id in slot_showtime_ids:
            candidate = showtimes[showtime_id]
            if not candidate.has_cineville_source:
                continue
            if candidate.has_cinema_scraper_source:
                continue

            conflicting = next(
                (
                    other
                    for other in cinema_scraper_showtimes
                    if titles_conflict_match(candidate.movie_title, other.movie_title)
                ),
                None,
            )
            if conflicting is not None:
                ids_to_delete.add(candidate.showtime_id)
                record_source_disagreement(
                    SourceDisagreement(
                        cinema_id=candidate.cinema_id,
                        showtime_datetime=candidate.datetime,
                        cineville_movie_id=candidate.movie_id,
                        cineville_movie_title=candidate.movie_title,
                        cinema_scraper_movie_id=conflicting.movie_id,
                        cinema_scraper_movie_title=conflicting.movie_title,
                        detected_by=DETECTED_BY_CLEANUP,
                    )
                )

    if not ids_to_delete:
        return []

    deleted_showtimes = list(
        session.exec(select(Showtime).where(col(Showtime.id).in_(ids_to_delete))).all()
    )
    deleted_infos = [
        DeletedShowtimeInfo(
            showtime_id=showtime.id,
            movie_id=showtime.movie_id,
            movie_title=showtime.movie.title,
            cinema_id=showtime.cinema_id,
            cinema_name=showtime.cinema.name,
            datetime=showtime.datetime,
            ticket_link=showtime.ticket_link,
        )
        for showtime in deleted_showtimes
    ]
    session.execute(delete(Showtime).where(col(Showtime.id).in_(ids_to_delete)))
    session.commit()
    return deleted_infos


def _combine_summaries(
    *,
    current: ScrapeExecutionSummary,
    new: ScrapeExecutionSummary,
) -> ScrapeExecutionSummary:
    current.deleted_showtimes.extend(new.deleted_showtimes)
    current.conflict_deleted_showtimes.extend(new.conflict_deleted_showtimes)
    current.errors.extend(new.errors)
    current.missing_cinemas.extend(new.missing_cinemas)
    current.missing_cinema_insert_failures.extend(new.missing_cinema_insert_failures)
    return current


def _dedupe_deleted_showtimes(
    deleted_showtimes: list[DeletedShowtimeInfo],
) -> list[DeletedShowtimeInfo]:
    by_id: dict[int, DeletedShowtimeInfo] = {}
    for deleted_showtime in deleted_showtimes:
        by_id[deleted_showtime.showtime_id] = deleted_showtime
    return list(by_id.values())


def _load_scrape_run_errors(
    *,
    started_at,
    finished_at,
) -> list[str]:
    try:
        with get_db_context() as session:
            stmt = (
                select(ScrapeRun)
                .where(
                    ScrapeRun.started_at >= started_at,
                    ScrapeRun.started_at <= finished_at,
                    col(ScrapeRun.status).in_(
                        [ScrapeRunStatus.FAILED, ScrapeRunStatus.DEGRADED]
                    ),
                )
                .order_by(col(ScrapeRun.started_at).asc())
            )
            rows = list(session.exec(stmt).all())
    except Exception as e:
        logger.error(f"Failed to load scrape-run errors for recap email. Error: {e}")
        return []
    return [
        f"{row.started_at.isoformat()} [{row.status.value}] {row.source_stream}: {row.error or 'unknown error'}"
        for row in rows
    ]


def _load_future_snapshot(*, snapshot_time) -> FutureSnapshot:
    try:
        with get_db_context() as session:
            rows = list(
                session.exec(
                    select(Showtime.id, Showtime.movie_id).where(
                        Showtime.datetime >= snapshot_time
                    )
                ).all()
            )
    except Exception as e:
        logger.error(f"Failed to load future snapshot. Error: {e}")
        return FutureSnapshot(showtime_ids=set(), movie_ids=set())

    showtime_ids = {int(showtime_id) for showtime_id, _ in rows}
    movie_ids = {int(movie_id) for _, movie_id in rows}
    return FutureSnapshot(showtime_ids=showtime_ids, movie_ids=movie_ids)


def _load_movie_labels(movie_ids: set[int]) -> list[str]:
    if not movie_ids:
        return []
    try:
        with get_db_context() as session:
            rows = list(
                session.exec(select(Movie).where(col(Movie.id).in_(movie_ids))).all()
            )
    except Exception as e:
        logger.error(f"Failed to load movie labels for recap. Error: {e}")
        return []
    labels = [f"{movie.title} (id={movie.id})" for movie in rows]
    labels.sort()
    return labels


def _status_key(status: Any) -> str:
    if isinstance(status, ScrapeRunStatus):
        return status.value
    return str(status)


def _load_scrape_run_details(
    *,
    started_at,
    finished_at,
) -> list[ScrapeRunDetail]:
    try:
        with get_db_context() as session:
            rows = list(
                session.exec(
                    select(ScrapeRun).where(
                        ScrapeRun.started_at >= started_at,
                        ScrapeRun.started_at <= finished_at,
                    )
                ).all()
            )
    except Exception as e:
        logger.error(f"Failed to load scrape-run details. Error: {e}")
        return []

    details: list[ScrapeRunDetail] = []
    for row in rows:
        duration_seconds: float | None = None
        if row.finished_at is not None:
            duration_seconds = max(
                0.0,
                (row.finished_at - row.started_at).total_seconds(),
            )
        details.append(
            ScrapeRunDetail(
                source_stream=row.source_stream,
                status=_status_key(row.status),
                started_at=row.started_at,
                finished_at=row.finished_at,
                duration_seconds=duration_seconds,
                observed_showtime_count=row.observed_showtime_count,
                error=row.error,
            )
        )
    details.sort(key=lambda detail: detail.started_at)
    return details


def _load_cinema_name_by_id() -> dict[int, str]:
    try:
        with get_db_context() as session:
            rows = list(session.exec(select(Cinema.id, Cinema.name)).all())
    except Exception as e:
        logger.error(f"Failed to load cinema names for recap. Error: {e}")
        return {}
    return {int(cinema_id): str(cinema_name) for cinema_id, cinema_name in rows}


def _stream_display_name(source_stream: str, cinema_name_by_id: dict[int, str]) -> str:
    if not source_stream.startswith(CINEMA_SCRAPER_STREAM_PREFIX):
        return source_stream
    _, _, suffix = source_stream.partition(":")
    if not suffix.isdigit():
        return source_stream
    cinema_id = int(suffix)
    cinema_name = cinema_name_by_id.get(cinema_id)
    if cinema_name is None:
        return source_stream
    return f"{source_stream} ({cinema_name})"


def _load_pending_miss_details() -> list[PendingMissDetail]:
    """Presences that have missed at least one run and are not deleted yet.

    Every streak between 1 and MISSING_STREAK_TO_DEACTIVATE is reported, so a
    source going flaky shows up on the first miss rather than only on the last
    one before deletion (a presence at the threshold is deactivated, never
    active, so no upper bound is needed here).

    Only upcoming showtimes are reported — a presence for a screening that has
    already happened can no longer be re-observed, so it is not at risk of being
    wrongly deleted. Rows left at a non-zero streak from before
    `_mark_missing_for_unseen` started skipping past showtimes are filtered here.
    """
    try:
        with get_db_context() as session:
            rows = list(
                session.exec(
                    select(ShowtimeSourcePresence, Showtime, Movie, Cinema)
                    .join(
                        Showtime,
                        col(ShowtimeSourcePresence.showtime_id) == col(Showtime.id),
                    )
                    .join(Movie, col(Showtime.movie_id) == col(Movie.id))
                    .join(Cinema, col(Showtime.cinema_id) == col(Cinema.id))
                    .where(
                        col(ShowtimeSourcePresence.active).is_(True),
                        ShowtimeSourcePresence.missing_streak > 0,
                        Showtime.datetime >= now_amsterdam_naive(),
                    )
                ).all()
            )
    except Exception as e:
        logger.error(f"Failed to load pending-miss details. Error: {e}")
        return []

    details = [
        PendingMissDetail(
            source_stream=presence.source_stream,
            movie_title=movie.title,
            cinema_name=cinema.name,
            showtime_datetime=showtime.datetime,
            showtime_id=showtime.id,
            missing_streak=presence.missing_streak,
        )
        for presence, showtime, movie, cinema in rows
    ]
    # Closest to deletion first.
    details.sort(key=lambda detail: (-detail.missing_streak, detail.showtime_datetime))
    return details


def _tmdb_miss_title_counts(tmdb_misses: list[dict[str, Any]]) -> list[tuple[str, int]]:
    counts: dict[str, int] = {}
    for miss in tmdb_misses:
        payload = miss.get("payload")
        if isinstance(payload, dict):
            raw_title = payload.get("title_query")
            title = str(raw_title).strip() if raw_title is not None else "<unknown>"
        else:
            title = "<unknown>"
        if not title:
            title = "<unknown>"
        counts[title] = counts.get(title, 0) + 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return ranked


def _tmdb_low_confidence_lookups(
    tmdb_lookups: list[dict[str, Any]],
    *,
    threshold: float,
) -> list[dict[str, Any]]:
    low_confidence: list[dict[str, Any]] = []
    for lookup in tmdb_lookups:
        if lookup.get("tmdb_id") is None:
            continue
        confidence_raw = lookup.get("confidence")
        if isinstance(confidence_raw, int | float):
            confidence = float(confidence_raw)
        elif isinstance(confidence_raw, str):
            try:
                confidence = float(confidence_raw)
            except ValueError:
                continue
        else:
            continue
        if confidence >= threshold:
            continue
        enriched_lookup = dict(lookup)
        enriched_lookup["confidence"] = confidence
        low_confidence.append(enriched_lookup)
    return sorted(
        low_confidence,
        key=lambda item: (
            float(item.get("confidence", 0.0)),
            str(item.get("timestamp", "")),
        ),
    )


def _error_stage_counts(errors: list[str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for error in errors:
        match = STAGE_PATTERN.search(error)
        stage = "unknown"
        if match is not None:
            stage = match.group(2).strip()
        counts[stage] = counts.get(stage, 0) + 1
    return counts


def _tmdb_cache_breakdown(tmdb_lookups: list[dict[str, Any]]) -> dict[str, int]:
    counts = {
        "memory": 0,
        "database": 0,
        "singleflight": 0,
        "network": 0,
        "unknown": 0,
    }
    for lookup in tmdb_lookups:
        source_value = lookup.get("cache_source")
        source = str(source_value) if source_value is not None else "unknown"
        if source not in counts:
            source = "unknown"
        counts[source] += 1
    return counts


def _letterboxd_failure_breakdown(
    letterboxd_failures: list[dict[str, Any]],
) -> dict[str, int]:
    counts: dict[str, int] = {}
    for failure in letterboxd_failures:
        event_type_raw = failure.get("event_type")
        event_type = (
            str(event_type_raw).strip()
            if event_type_raw is not None
            else "unknown_failure"
        )
        if not event_type:
            event_type = "unknown_failure"
        counts[event_type] = counts.get(event_type, 0) + 1
    return counts


def _compact_json_bytes(payload: Any) -> bytes:
    return json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
    ).encode("utf-8")


def _tmdb_resolution_audit_dir() -> Path:
    return Path(__file__).resolve().parents[2] / TMDB_RESOLUTION_AUDIT_DIR_NAME


def _tmdb_fixture_source_of_truth_path() -> Path:
    return (
        Path(__file__).resolve().parents[2]
        / "tests"
        / "fixtures"
        / "tmdb_resolution_cases.json"
    )


def _safe_int_or_none(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _safe_float_or_none(value: Any) -> float | None:
    if isinstance(value, int | float):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _lookup_payload_key(lookup: dict[str, Any]) -> str | None:
    payload_raw = lookup.get("payload")
    payload: dict[str, Any] = payload_raw if isinstance(payload_raw, dict) else {}
    title_query_raw = payload.get("title_query")
    title_query = str(title_query_raw).strip() if title_query_raw is not None else ""
    if not title_query:
        return None
    key_payload = {
        "title_query": title_query,
        "director_names": _string_list(payload.get("director_names")),
        "actor_names": _string_list(payload.get("actor_names")),
        "year": _safe_int_or_none(payload.get("year")),
        "duration_minutes": _safe_int_or_none(payload.get("duration_minutes")),
        "spoken_languages": _string_list(payload.get("spoken_languages")),
    }
    return json.dumps(
        key_payload, sort_keys=True, separators=(",", ":"), ensure_ascii=True
    )


def _lookup_diagnostic_richness(lookup: dict[str, Any]) -> tuple[int, int]:
    decision_raw = lookup.get("decision")
    decision: dict[str, Any] = decision_raw if isinstance(decision_raw, dict) else {}
    trace_raw = decision.get("trace")
    trace: dict[str, Any] = trace_raw if isinstance(trace_raw, dict) else {}
    candidates_raw = trace.get("candidates")
    candidates = candidates_raw if isinstance(candidates_raw, list) else []
    confidence_value = _safe_float_or_none(lookup.get("confidence"))
    if confidence_value is None:
        confidence_bucket = -1
    else:
        confidence_bucket = int(confidence_value)

    score = 0
    if candidates:
        score += 3
    if decision.get("winner_quality") is not None:
        score += 2
    if lookup.get("cache_source") == "network":
        score += 1
    return score, confidence_bucket


def _dedupe_tmdb_lookups_for_reporting(
    tmdb_lookups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    by_key: dict[str, dict[str, Any]] = {}
    for lookup in tmdb_lookups:
        key = _lookup_payload_key(lookup)
        if key is None:
            continue
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = lookup
            continue
        if _lookup_diagnostic_richness(lookup) > _lookup_diagnostic_richness(existing):
            by_key[key] = lookup
    return list(by_key.values())


def _lookup_is_perfect_match(lookup: dict[str, Any]) -> bool:
    decision_raw = lookup.get("decision")
    decision: dict[str, Any] = decision_raw if isinstance(decision_raw, dict) else {}
    winner_quality_raw = decision.get("winner_quality")
    if isinstance(winner_quality_raw, str) and winner_quality_raw.upper() == "PERFECT":
        return True
    confidence_value = _safe_float_or_none(lookup.get("confidence"))
    if confidence_value is None:
        return False
    return confidence_value >= 99.0


def _lookup_worst_to_best_rank(lookup: dict[str, Any]) -> int:
    if _safe_int_or_none(lookup.get("tmdb_id")) is None:
        return 0

    decision_raw = lookup.get("decision")
    decision: dict[str, Any] = decision_raw if isinstance(decision_raw, dict) else {}
    winner_quality_raw = decision.get("winner_quality")
    winner_quality = (
        str(winner_quality_raw).upper() if winner_quality_raw is not None else ""
    )
    winner_quality_ranks = {
        "POOR": 1,
        "DECENT": 2,
        "GOOD": 3,
        "EXCELLENT": 4,
        "PERFECT": 5,
    }
    if winner_quality in winner_quality_ranks:
        return winner_quality_ranks[winner_quality]

    confidence = _safe_float_or_none(lookup.get("confidence"))
    if confidence is None:
        return 3
    if confidence < 55.0:
        return 1
    if confidence < 70.0:
        return 2
    if confidence < 90.0:
        return 3
    if confidence < 99.0:
        return 4
    return 5


def _sorted_tmdb_lookups_for_markdown(
    tmdb_lookups: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    deduped = _dedupe_tmdb_lookups_for_reporting(tmdb_lookups)
    filtered = [lookup for lookup in deduped if not _lookup_is_perfect_match(lookup)]

    def sort_key(lookup: dict[str, Any]) -> tuple[int, float, str]:
        rank = _lookup_worst_to_best_rank(lookup)
        confidence = _safe_float_or_none(lookup.get("confidence"))
        if confidence is None:
            confidence = -1.0
        payload_raw = lookup.get("payload")
        payload: dict[str, Any] = payload_raw if isinstance(payload_raw, dict) else {}
        title_query_raw = payload.get("title_query")
        title_query = (
            str(title_query_raw).lower() if title_query_raw is not None else ""
        )
        return rank, confidence, title_query

    return sorted(filtered, key=sort_key)


def _build_tmdb_fixture_json(
    *,
    started_at: datetime,
    tmdb_lookups: list[dict[str, Any]],
) -> dict[str, Any]:
    deduped = _dedupe_tmdb_lookups_for_reporting(tmdb_lookups)
    cases: list[dict[str, Any]] = []
    for index, lookup in enumerate(deduped, start=1):
        payload_raw = lookup.get("payload")
        payload: dict[str, Any] = payload_raw if isinstance(payload_raw, dict) else {}
        title_query_raw = payload.get("title_query")
        title_query = (
            str(title_query_raw).strip() if title_query_raw is not None else ""
        )
        if not title_query:
            continue

        actor_names = _string_list(payload.get("actor_names"))
        actor_name = actor_names[0] if actor_names else None
        input_payload = {
            "title_query": title_query,
            "director_names": _string_list(payload.get("director_names")),
            "actor_name": actor_name,
            "year": _safe_int_or_none(payload.get("year")),
            "duration_minutes": _safe_int_or_none(payload.get("duration_minutes")),
            "spoken_languages": _string_list(payload.get("spoken_languages")),
        }
        case_slug = TITLE_NORMALIZE_PATTERN.sub("_", title_query.lower()).strip("_")
        case_name = f"{index:04d}_{case_slug or 'untitled'}"
        cases.append(
            {
                "name": case_name,
                "input": input_payload,
                "expected": {
                    "tmdb_id": _safe_int_or_none(lookup.get("tmdb_id")),
                },
            }
        )

    return {
        "description": (
            "Fixture cases generated from scraper TMDB resolution events. "
            "Set RUN_LIVE_TMDB_RESOLUTION_CASES=1 to execute live TMDB assertions."
        ),
        "generated_at": started_at.isoformat(),
        "total_cases": len(cases),
        "cases": cases,
    }


def _render_candidate_trace_lines(candidate: dict[str, Any]) -> list[str]:
    movie_id = candidate.get("id")
    title = str(candidate.get("title", "<unknown>"))
    buckets_raw = candidate.get("source_buckets")
    buckets = buckets_raw if isinstance(buckets_raw, list) else []
    pre_raw = candidate.get("pre")
    pre: dict[str, Any] = pre_raw if isinstance(pre_raw, dict) else {}
    post_raw = candidate.get("post")
    post: dict[str, Any] = post_raw if isinstance(post_raw, dict) else {}
    enrichment_raw = candidate.get("enrichment")
    enrichment: dict[str, Any] = (
        enrichment_raw if isinstance(enrichment_raw, dict) else {}
    )
    details_raw = candidate.get("details")
    details: dict[str, Any] = details_raw if isinstance(details_raw, dict) else {}

    lines = [
        f"- id={movie_id} | title={title} | buckets={', '.join(str(b) for b in buckets) or '-'}",
        "  pre: "
        f"source={pre.get('source_quality')} | "
        f"title={pre.get('title_quality')} | "
        f"year={pre.get('year_quality')} | "
        f"language={pre.get('language_quality')} | "
        f"overall={pre.get('overall_quality')}",
        "  post: "
        f"overall={post.get('overall_quality')} | "
        f"rank={post.get('rank')}",
    ]
    if enrichment:
        lines.append(
            "  enrichment: "
            f"runtime={enrichment.get('runtime_quality')} | "
            f"language={enrichment.get('language_quality')} | "
            f"director={enrichment.get('director_quality')} | "
            f"actor={enrichment.get('actor_quality')} | "
            f"contradiction={enrichment.get('has_contradiction')} | "
            f"strong_support_count={enrichment.get('strong_support_count')} | "
            f"has_viable_higher_option={enrichment.get('has_viable_higher_option')}"
        )
    if details:
        lines.append(
            "  details: "
            f"runtime={details.get('runtime_minutes')} | "
            f"is_short={details.get('is_short')} | "
            f"is_documentary={details.get('is_documentary')} | "
            f"genre_ids={details.get('genre_ids')} | "
            f"original_language={details.get('original_language')} | "
            f"spoken_languages={details.get('spoken_languages')}"
        )
    return lines


def _build_tmdb_resolution_audit_markdown(
    *,
    started_at: datetime,
    tmdb_lookups: list[dict[str, Any]],
) -> str:
    markdown_lookups = _sorted_tmdb_lookups_for_markdown(tmdb_lookups)
    lines: list[str] = [
        "# TMDB Resolution Audit",
        "",
        f"Started at: {started_at.isoformat()}",
        f"Total lookups: {len(tmdb_lookups)}",
        f"Included in markdown (non-perfect, deduped): {len(markdown_lookups)}",
        "Order: worst to best (not found first).",
        f"Candidate options shown per lookup: top {TMDB_MARKDOWN_CANDIDATE_LIMIT}.",
        "",
    ]

    for index, lookup in enumerate(markdown_lookups, start=1):
        payload_raw = lookup.get("payload")
        payload: dict[str, Any] = payload_raw if isinstance(payload_raw, dict) else {}
        decision_raw = lookup.get("decision")
        decision: dict[str, Any] = (
            decision_raw if isinstance(decision_raw, dict) else {}
        )
        trace_raw = decision.get("trace")
        trace: dict[str, Any] = trace_raw if isinstance(trace_raw, dict) else {}
        candidates_raw = trace.get("candidates")
        candidates = candidates_raw if isinstance(candidates_raw, list) else []

        lines.extend(
            [
                f"## {index}. {payload.get('title_query', '<unknown title>')}",
                f"- timestamp: {lookup.get('timestamp')}",
                f"- tmdb_id: {lookup.get('tmdb_id')}",
                f"- confidence: {lookup.get('confidence')}",
                f"- cache: {lookup.get('cache_source')} (hit={lookup.get('cache_hit')})",
                f"- status: {decision.get('status')}",
                f"- reason: {decision.get('reason')}",
                f"- winner_id: {decision.get('winner_id')}",
                f"- winner_quality: {decision.get('winner_quality')}",
                f"- enrichment_requested: {trace.get('enrichment_requested')}",
                f"- enrichment_candidate_ids: {trace.get('enrichment_candidate_ids')}",
                "- query:",
                f"  - title_query: {payload.get('title_query')}",
                f"  - director_names: {payload.get('director_names')}",
                f"  - actor_names: {payload.get('actor_names')}",
                f"  - year: {payload.get('year')}",
                f"  - duration_minutes: {payload.get('duration_minutes')}",
                f"  - spoken_languages: {payload.get('spoken_languages')}",
                "- candidates:",
            ]
        )
        if not candidates:
            lines.append("  - none")
        else:
            displayed_candidates = candidates[:TMDB_MARKDOWN_CANDIDATE_LIMIT]
            for candidate_raw in displayed_candidates:
                candidate = candidate_raw if isinstance(candidate_raw, dict) else {}
                lines.extend(_render_candidate_trace_lines(candidate))
            omitted = len(candidates) - len(displayed_candidates)
            if omitted > 0:
                lines.append(f"  - ... {omitted} additional candidate(s) omitted")
        lines.append("")

    return "\n".join(lines)


def _write_tmdb_resolution_audit_files(
    *,
    started_at: datetime,
    tmdb_lookups: list[dict[str, Any]],
) -> list[Path]:
    output_dir = _tmdb_resolution_audit_dir()
    output_dir.mkdir(parents=True, exist_ok=True)
    suffix = started_at.strftime("%Y%m%d_%H%M%S")

    json_path = output_dir / f"tmdb_resolution_audit_{suffix}.json"
    markdown_path = output_dir / f"tmdb_resolution_audit_{suffix}.md"

    json_payload = _build_tmdb_fixture_json(
        started_at=started_at,
        tmdb_lookups=tmdb_lookups,
    )
    json_path.write_text(
        json.dumps(json_payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    markdown_path.write_text(
        _build_tmdb_resolution_audit_markdown(
            started_at=started_at,
            tmdb_lookups=tmdb_lookups,
        ),
        encoding="utf-8",
    )
    return [json_path, markdown_path]


def _tmdb_fixture_cases(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        raw_cases = payload.get("cases")
    elif isinstance(payload, list):
        raw_cases = payload
    else:
        return []
    if not isinstance(raw_cases, list):
        return []
    return [case for case in raw_cases if isinstance(case, dict)]


def _dedupe_exact_tmdb_fixture_cases(
    cases: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for case in cases:
        key = json.dumps(
            case,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(case)
    return deduped


def _merge_generated_tmdb_fixture_into_source_of_truth(
    *,
    generated_json_path: Path,
    source_of_truth_path: Path,
) -> tuple[int, int, int]:
    generated_payload_raw: Any = {}
    try:
        generated_payload_raw = json.loads(
            generated_json_path.read_text(encoding="utf-8")
        )
    except Exception:
        logger.error(
            "Failed to parse generated TMDB fixture JSON: %s",
            generated_json_path,
            exc_info=True,
        )
        raise
    generated_cases = _tmdb_fixture_cases(generated_payload_raw)

    existing_payload_raw: Any = {}
    if source_of_truth_path.exists():
        try:
            existing_payload_raw = json.loads(
                source_of_truth_path.read_text(encoding="utf-8")
            )
        except Exception:
            logger.error(
                "Failed to parse TMDB fixture source of truth: %s",
                source_of_truth_path,
                exc_info=True,
            )
            raise
    existing_cases = _tmdb_fixture_cases(existing_payload_raw)

    merged_cases = _dedupe_exact_tmdb_fixture_cases([*existing_cases, *generated_cases])
    merged_payload = (
        dict(existing_payload_raw) if isinstance(existing_payload_raw, dict) else {}
    )
    generated_payload = (
        generated_payload_raw if isinstance(generated_payload_raw, dict) else {}
    )
    merged_payload["description"] = generated_payload.get(
        "description",
        merged_payload.get(
            "description",
            "Fixture cases generated from scraper TMDB resolution events.",
        ),
    )
    merged_payload["generated_at"] = generated_payload.get(
        "generated_at",
        now_amsterdam_naive().isoformat(),
    )
    merged_payload["total_cases"] = len(merged_cases)
    merged_payload["cases"] = merged_cases

    source_of_truth_path.parent.mkdir(parents=True, exist_ok=True)
    source_of_truth_path.write_text(
        json.dumps(merged_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return len(existing_cases), len(generated_cases), len(merged_cases)


def _cleanup_tmdb_resolution_audit_files() -> list[Path]:
    output_dir = _tmdb_resolution_audit_dir()
    if not output_dir.exists():
        return []
    deleted_paths: list[Path] = []
    for pattern in ("tmdb_resolution_audit_*.json", "tmdb_resolution_audit_*.md"):
        for file_path in output_dir.glob(pattern):
            if not file_path.is_file():
                continue
            file_path.unlink(missing_ok=True)
            deleted_paths.append(file_path)
    return deleted_paths


def _compact_tmdb_lookup_for_attachment(lookup: dict[str, Any]) -> dict[str, Any]:
    payload_raw = lookup.get("payload")
    payload: dict[str, Any] = payload_raw if isinstance(payload_raw, dict) else {}
    decision_raw = lookup.get("decision")
    decision: dict[str, Any] = decision_raw if isinstance(decision_raw, dict) else {}
    best_raw = decision.get("best")
    best: dict[str, Any] = best_raw if isinstance(best_raw, dict) else {}
    return {
        "timestamp": lookup.get("timestamp"),
        "tmdb_id": lookup.get("tmdb_id"),
        "confidence": lookup.get("confidence"),
        "cache_source": lookup.get("cache_source"),
        "title_query": payload.get("title_query"),
        "director_names": payload.get("director_names"),
        "actor_names": payload.get("actor_names"),
        "year": payload.get("year"),
        "duration_minutes": payload.get("duration_minutes"),
        "spoken_languages": payload.get("spoken_languages"),
        "decision_status": decision.get("status"),
        "decision_reason": decision.get("reason"),
        "good_option_count": decision.get("good_option_count"),
        "best_margin": decision.get("best_margin"),
        "second_good_margin": decision.get("second_good_margin"),
        "best_tmdb_id": best.get("tmdb_id"),
        "best_title": best.get("title"),
        "best_release_year": best.get("release_year"),
    }


def _deleted_showtime_line(showtime: DeletedShowtimeInfo) -> str:
    return (
        f"{showtime.datetime.isoformat()} - "
        f"{showtime.movie_title} @ {showtime.cinema_name} "
        f"(showtime_id={showtime.showtime_id}, movie_id={showtime.movie_id}, "
        f"cinema_id={showtime.cinema_id})"
    )


def _source_disagreement_line(
    disagreement: SourceDisagreement,
    cinema_name_by_id: dict[int, str],
) -> str:
    cinema_name = cinema_name_by_id.get(
        disagreement.cinema_id, f"cinema_id={disagreement.cinema_id}"
    )
    return (
        f"{disagreement.showtime_datetime.isoformat()} @ {cinema_name} | "
        f"cineville: {disagreement.cineville_movie_title} "
        f"(movie_id={disagreement.cineville_movie_id}) | "
        f"cinema scraper: {disagreement.cinema_scraper_movie_title} "
        f"(movie_id={disagreement.cinema_scraper_movie_id}) | "
        f"kept movie_id={disagreement.cinema_scraper_movie_id} "
        f"({disagreement.detected_by})"
    )


def _dedupe_source_disagreements(
    disagreements: list[SourceDisagreement],
) -> list[SourceDisagreement]:
    """One entry per screening+pairing.

    A slot is re-checked on every Cineville showtime that lands in it, and the
    cleanup can see the same pairing the insert guard already reported.
    """
    by_key: dict[tuple[int, datetime, int, int], SourceDisagreement] = {}
    for disagreement in disagreements:
        key = (
            disagreement.cinema_id,
            disagreement.showtime_datetime,
            disagreement.cineville_movie_id,
            disagreement.cinema_scraper_movie_id,
        )
        by_key.setdefault(key, disagreement)
    return sorted(
        by_key.values(),
        key=lambda item: (item.showtime_datetime, item.cinema_id),
    )


def _pending_miss_line(detail: PendingMissDetail) -> str:
    return (
        f"missed {detail.missing_streak}x | "
        f"{detail.source_stream} | "
        f"{detail.movie_title} @ {detail.cinema_name} "
        f"({detail.showtime_datetime.isoformat()}, showtime_id={detail.showtime_id})"
    )


def _deleted_showtime_payload(showtime: DeletedShowtimeInfo) -> dict[str, Any]:
    return {
        "showtime_id": showtime.showtime_id,
        "movie_id": showtime.movie_id,
        "movie_title": showtime.movie_title,
        "cinema_id": showtime.cinema_id,
        "cinema_name": showtime.cinema_name,
        "datetime": showtime.datetime.isoformat(),
        "ticket_link": showtime.ticket_link,
    }


def _run_detail_payload(
    detail: ScrapeRunDetail,
    cinema_name_by_id: dict[int, str],
) -> dict[str, Any]:
    return {
        "source_stream": detail.source_stream,
        "source_stream_display": _stream_display_name(
            detail.source_stream,
            cinema_name_by_id,
        ),
        "status": detail.status,
        "started_at": detail.started_at.isoformat(),
        "finished_at": (
            detail.finished_at.isoformat() if detail.finished_at is not None else None
        ),
        "duration_seconds": detail.duration_seconds,
        "observed_showtime_count": detail.observed_showtime_count,
        "error": detail.error,
    }


def _store_run_recap(
    *,
    started_at,
    finished_at,
    summary: ScrapeExecutionSummary,
    tmdb_lookups: list[dict],
    letterboxd_failures: list[dict[str, Any]],
    before_snapshot: FutureSnapshot,
    after_snapshot: FutureSnapshot,
) -> None:
    """Persist this run's recap metrics + attachments for the daily email."""
    tmdb_misses = [lookup for lookup in tmdb_lookups if lookup["tmdb_id"] is None]

    deleted_showtimes = _dedupe_deleted_showtimes(summary.deleted_showtimes)
    deleted_showtimes = [
        showtime for showtime in deleted_showtimes if showtime.datetime >= finished_at
    ]
    conflict_deleted_showtimes = _dedupe_deleted_showtimes(
        summary.conflict_deleted_showtimes
    )

    errors = list(summary.errors)
    errors.extend(
        _load_scrape_run_errors(started_at=started_at, finished_at=finished_at)
    )
    # Deduplicate while preserving order.
    errors = list(dict.fromkeys(errors))
    missing_cinemas = sorted(set(summary.missing_cinemas))
    missing_cinema_insert_failures = list(
        dict.fromkeys(summary.missing_cinema_insert_failures)
    )
    tmdb_cache_counts = _tmdb_cache_breakdown(tmdb_lookups)
    tmdb_cache_hit_count = sum(
        tmdb_cache_counts.get(key, 0) for key in ("memory", "database", "singleflight")
    )
    tmdb_miss_titles = _tmdb_miss_title_counts(tmdb_misses)
    low_confidence_lookups = _tmdb_low_confidence_lookups(
        tmdb_lookups,
        threshold=TMDB_LOW_CONFIDENCE_THRESHOLD,
    )
    scrape_run_details = _load_scrape_run_details(
        started_at=started_at,
        finished_at=finished_at,
    )
    cinema_scraper_details = [
        detail
        for detail in scrape_run_details
        if detail.source_stream.startswith(CINEMA_SCRAPER_STREAM_PREFIX)
    ]
    cinema_name_by_id = _load_cinema_name_by_id()
    source_disagreements = _dedupe_source_disagreements(consume_source_disagreements())
    letterboxd_failure_counts = _letterboxd_failure_breakdown(letterboxd_failures)
    recovered_presence_count = scrape_sync_service.consume_recovered_presence_count()
    pending_miss_details = _load_pending_miss_details()
    error_stage_counts = _error_stage_counts(errors)

    new_future_showtime_ids = after_snapshot.showtime_ids - before_snapshot.showtime_ids
    new_future_movie_ids = after_snapshot.movie_ids - before_snapshot.movie_ids
    new_future_movie_labels = _load_movie_labels(new_future_movie_ids)

    metrics = RecapRunMetrics(
        started_at=started_at,
        finished_at=finished_at,
        new_future_showtime_count=len(new_future_showtime_ids),
        new_future_movie_labels=new_future_movie_labels,
        future_showtime_count_before=len(before_snapshot.showtime_ids),
        future_showtime_count_after=len(after_snapshot.showtime_ids),
        future_movie_count_before=len(before_snapshot.movie_ids),
        future_movie_count_after=len(after_snapshot.movie_ids),
        recovered_presence_count=recovered_presence_count,
        missing_streak_to_deactivate=(scrape_sync_service.MISSING_STREAK_TO_DEACTIVATE),
        pending_miss_counts_by_streak=dict(
            Counter(detail.missing_streak for detail in pending_miss_details)
        ),
        pending_miss_lines=[
            _pending_miss_line(detail) for detail in pending_miss_details
        ],
        tmdb_lookup_count=len(tmdb_lookups),
        tmdb_cache_hit_count=tmdb_cache_hit_count,
        tmdb_miss_count=len(tmdb_misses),
        tmdb_miss_title_counts=tmdb_miss_titles,
        low_confidence_count=len(low_confidence_lookups),
        low_confidence_threshold=TMDB_LOW_CONFIDENCE_THRESHOLD,
        deleted_showtime_lines=[
            _deleted_showtime_line(showtime) for showtime in deleted_showtimes
        ],
        conflict_deleted_count=len(conflict_deleted_showtimes),
        source_disagreement_lines=[
            _source_disagreement_line(disagreement, cinema_name_by_id)
            for disagreement in source_disagreements
        ],
        error_count=len(errors),
        letterboxd_failure_count=len(letterboxd_failures),
        missing_cinemas=missing_cinemas,
    )

    tmdb_low_confidence_compact = [
        _compact_tmdb_lookup_for_attachment(lookup)
        for lookup in low_confidence_lookups[:TMDB_RECAP_ATTACHMENT_MAX_ITEMS]
    ]
    tmdb_misses_compact = [
        _compact_tmdb_lookup_for_attachment(lookup)
        for lookup in tmdb_misses[:TMDB_RECAP_ATTACHMENT_MAX_ITEMS]
    ]
    timestamp = f"{started_at:%Y%m%d_%H%M%S}"
    attachments = [
        {
            "filename": f"tmdb_lookups_{timestamp}.json",
            "mime_type": "application/json",
            "data": _compact_json_bytes(
                {
                    "meta": {
                        "total_lookups": len(tmdb_lookups),
                        "cache_breakdown": tmdb_cache_counts,
                        "miss_count": len(tmdb_misses),
                        "low_confidence_threshold": TMDB_LOW_CONFIDENCE_THRESHOLD,
                        "low_confidence_count": len(low_confidence_lookups),
                        "max_items_per_section": TMDB_RECAP_ATTACHMENT_MAX_ITEMS,
                    },
                    "low_confidence": tmdb_low_confidence_compact,
                    "misses": tmdb_misses_compact,
                }
            ),
        },
        {
            "filename": f"scrape_runs_{timestamp}.json",
            "mime_type": "application/json",
            "data": _compact_json_bytes(
                [
                    _run_detail_payload(detail, cinema_name_by_id)
                    for detail in scrape_run_details
                ]
            ),
        },
        {
            "filename": f"cinema_scraper_runs_{timestamp}.json",
            "mime_type": "application/json",
            "data": _compact_json_bytes(
                [
                    _run_detail_payload(detail, cinema_name_by_id)
                    for detail in cinema_scraper_details
                ]
            ),
        },
        {
            "filename": f"letterboxd_failures_{timestamp}.json",
            "mime_type": "application/json",
            "data": _compact_json_bytes(
                {
                    "counts_by_event_type": letterboxd_failure_counts,
                    "failures": letterboxd_failures,
                }
            ),
        },
        {
            "filename": f"errors_{timestamp}.json",
            "mime_type": "application/json",
            "data": _compact_json_bytes(
                {
                    "counts_by_stage": error_stage_counts,
                    "errors": errors,
                    "missing_cinema_insert_failures": missing_cinema_insert_failures,
                }
            ),
        },
        {
            "filename": f"source_disagreements_{timestamp}.json",
            "mime_type": "application/json",
            "data": _compact_json_bytes(
                [
                    {
                        "cinema_id": disagreement.cinema_id,
                        "cinema_name": cinema_name_by_id.get(disagreement.cinema_id),
                        "showtime_datetime": (
                            disagreement.showtime_datetime.isoformat()
                        ),
                        "cineville_movie_id": disagreement.cineville_movie_id,
                        "cineville_movie_title": disagreement.cineville_movie_title,
                        "cinema_scraper_movie_id": (
                            disagreement.cinema_scraper_movie_id
                        ),
                        "cinema_scraper_movie_title": (
                            disagreement.cinema_scraper_movie_title
                        ),
                        "kept_movie_id": disagreement.cinema_scraper_movie_id,
                        "detected_by": disagreement.detected_by,
                    }
                    for disagreement in source_disagreements
                ]
            ),
        },
        {
            "filename": f"showtime_deletions_{timestamp}.json",
            "mime_type": "application/json",
            "data": _compact_json_bytes(
                {
                    "no_longer_found": [
                        _deleted_showtime_payload(showtime)
                        for showtime in deleted_showtimes
                    ],
                    "duplicate_title_removed": [
                        _deleted_showtime_payload(showtime)
                        for showtime in conflict_deleted_showtimes
                    ],
                }
            ),
        },
        {
            "filename": f"pending_misses_{timestamp}.json",
            "mime_type": "application/json",
            "data": _compact_json_bytes(
                {
                    "missing_streak_to_deactivate": (
                        scrape_sync_service.MISSING_STREAK_TO_DEACTIVATE
                    ),
                    "recovered_presence_count": recovered_presence_count,
                    "counts_by_missing_streak": {
                        str(streak): count
                        for streak, count in sorted(
                            metrics.pending_miss_counts_by_streak.items()
                        )
                    },
                    "pending_misses": [
                        {
                            "source_stream": detail.source_stream,
                            "movie_title": detail.movie_title,
                            "cinema_name": detail.cinema_name,
                            "showtime_datetime": detail.showtime_datetime.isoformat(),
                            "showtime_id": detail.showtime_id,
                            "missing_streak": detail.missing_streak,
                        }
                        for detail in pending_miss_details
                    ],
                }
            ),
        },
    ]

    subject = (
        "Cinema Scrape Recap "
        f"{started_at:%Y-%m-%d %H:%M} -> {finished_at:%Y-%m-%d %H:%M}"
    )
    _persist_run_recap(
        started_at=started_at,
        finished_at=finished_at,
        subject=subject,
        html=render_recap_html([metrics]),
        metrics=metrics,
        attachments=attachments,
    )


def _persist_run_recap(
    *,
    started_at: datetime,
    finished_at: datetime,
    subject: str,
    html: str,
    metrics: RecapRunMetrics,
    attachments: list[dict[str, Any]],
) -> None:
    """Store this run's recap metrics, rendered HTML and attachments."""
    serialized_attachments = [
        {
            "filename": attachment["filename"],
            "mime_type": attachment["mime_type"],
            "data_b64": base64.b64encode(attachment["data"]).decode("ascii"),
        }
        for attachment in attachments
    ]
    with get_db_context() as session:
        session.add(
            ScrapeRecap(
                started_at=started_at,
                finished_at=finished_at,
                subject=subject,
                html=html,
                metrics_json=json.dumps(metrics.to_payload(), ensure_ascii=False),
                attachments_json=json.dumps(serialized_attachments),
            )
        )
        session.commit()


def _recap_metrics_or_none(recap: ScrapeRecap) -> RecapRunMetrics | None:
    try:
        payload = json.loads(recap.metrics_json)
    except ValueError:
        payload = None
    if not isinstance(payload, dict) or not payload:
        return None
    try:
        return RecapRunMetrics.from_payload(payload)
    except (KeyError, TypeError, ValueError):
        logger.warning(
            "Recap %s has unreadable metrics; falling back to its HTML.", recap.id
        )
        return None


def send_daily_recap() -> bool:
    """Email one recap covering every scrape run stored in the last 24 hours.

    Each run stores its own metrics (``_store_run_recap``); this renders them as
    one document grouped by statistic, so the scrape can run several times a day
    while only one recap email is sent. Sent recaps are deleted; stragglers older
    than the window are pruned so a failed send can't let the table grow
    unbounded.
    """
    now = now_amsterdam_naive()
    window_start = now - RECAP_AGGREGATION_WINDOW

    with get_db_context() as session:
        recaps = list(
            session.exec(
                select(ScrapeRecap)
                .where(ScrapeRecap.started_at >= window_start)
                .order_by(col(ScrapeRecap.started_at).asc())
            ).all()
        )
        if not recaps:
            logger.info("No scrape recaps stored in the last 24h; nothing to send.")
            return False

        first_started = recaps[0].started_at
        last_finished = recaps[-1].finished_at
        subject = (
            f"Cinema Scrape Daily Recap {first_started:%Y-%m-%d %H:%M} -> "
            f"{last_finished:%Y-%m-%d %H:%M} ({len(recaps)} run(s))"
        )
        run_metrics: list[RecapRunMetrics] = []
        legacy_run_html: list[str] = []
        attachments: list[dict[str, Any]] = []
        for recap in recaps:
            metrics = _recap_metrics_or_none(recap)
            if metrics is not None:
                run_metrics.append(metrics)
            else:
                legacy_run_html.append(
                    f"<h3>Run {escape(recap.started_at.isoformat())} &rarr; "
                    f"{escape(recap.finished_at.isoformat())}</h3>{recap.html}"
                )
            for attachment in json.loads(recap.attachments_json):
                attachments.append(
                    {
                        "filename": attachment["filename"],
                        "data": base64.b64decode(attachment["data_b64"]),
                        "mime_type": attachment["mime_type"],
                    }
                )
        html = (
            f"<h1>Daily scrape recap — {len(recaps)} run(s) in the last 24h</h1>"
            + render_recap_html(run_metrics, legacy_run_html=legacy_run_html)
        )
        sent_ids = [recap.id for recap in recaps]

    send_email(
        email_to=RECAP_EMAIL_TO,
        subject=subject,
        html_content=html,
        attachments=attachments,
    )

    with get_db_context() as session:
        session.execute(delete(ScrapeRecap).where(col(ScrapeRecap.id).in_(sent_ids)))
        # Prune any stragglers from earlier failed sends so the table stays small.
        session.execute(
            delete(ScrapeRecap).where(
                col(ScrapeRecap.started_at) < now - 2 * RECAP_AGGREGATION_WINDOW
            )
        )
        session.commit()
    logger.info("Sent daily scrape recap covering %s run(s).", len(sent_ids))
    return True


def run() -> None:
    started_at = now_amsterdam_naive()
    reset_tmdb_runtime_state()
    reset_letterboxd_request_budget()
    # An interrupted run never reaches `_store_run_recap`, so drain here too or
    # its disagreements would be reported against the next run.
    consume_source_disagreements()
    before_snapshot = _load_future_snapshot(snapshot_time=started_at)
    summary = ScrapeExecutionSummary()
    tmdb_lookups: list[dict] = []
    letterboxd_failures: list[dict[str, Any]] = []
    fatal_error: Exception | None = None
    interrupted = False
    try:
        logger.info("Starting cineville scraper...")
        cineville_summary = scrape_cineville()
        _combine_summaries(current=summary, new=cineville_summary)
        logger.info("Cineville scraper finished successfully.")
        logger.info("Starting cinema scrapers...")
        cinema_summary = run_cinema_scrapers()
        _combine_summaries(current=summary, new=cinema_summary)
        logger.info("Ran all cinema scrapers.")
        logger.info("Starting old showtime cleanup...")
        try:
            with get_db_context() as session:
                old_deleted = scrape_sync_service.delete_old_showtimes(session=session)
                letterboxd_cleanup = scrape_sync_service.cleanup_letterboxd_data(
                    session=session,
                )
                session.commit()
            summary.deleted_showtimes.extend(old_deleted)
            logger.info(
                "Old showtime cleanup finished. Deleted %s showtime(s).",
                len(old_deleted),
            )
            logger.info(
                "Letterboxd cleanup finished. Cleared %s stale sync timestamp(s), "
                "deleted %s orphaned row(s).",
                letterboxd_cleanup.stale_sync_timestamps_cleared,
                letterboxd_cleanup.orphaned_rows_deleted,
            )
        except Exception as cleanup_error:
            summary.errors.append(
                "stage=old_showtime_cleanup | "
                f"error_type={type(cleanup_error).__name__} | "
                f"error={cleanup_error}"
            )
            logger.error("Failed during old showtime cleanup", exc_info=True)
        logger.info("Starting Cineville conflict cleanup...")
        try:
            with get_db_context() as session:
                conflict_deleted = _delete_cineville_title_conflicts(session=session)
            summary.conflict_deleted_showtimes.extend(conflict_deleted)
            logger.info(
                "Cineville conflict cleanup finished. Deleted %s showtime(s).",
                len(conflict_deleted),
            )
        except Exception as cleanup_error:
            summary.errors.append(
                "stage=cineville_conflict_cleanup | "
                f"error_type={type(cleanup_error).__name__} | "
                f"error={cleanup_error}"
            )
            logger.error("Failed during Cineville conflict cleanup", exc_info=True)
        logger.info("Starting Letterboxd slug/poster backfill...")
        letterboxd_backfill_summary = backfill_missing_letterboxd_data()
        logger.info(
            "Letterboxd backfill done (candidates=%s updated=%s skipped=%s failed=%s).",
            letterboxd_backfill_summary.candidates,
            letterboxd_backfill_summary.updated,
            letterboxd_backfill_summary.skipped,
            letterboxd_backfill_summary.failed,
        )
    except Exception as e:
        fatal_error = e
        summary.errors.append(str(e))
        logger.error("Error running cinema scraper", exc_info=True)
    except KeyboardInterrupt:
        interrupted = True
        logger.warning("KeyboardInterrupt received; skipping recap email and exiting.")
    finally:
        if not interrupted:
            finished_at = now_amsterdam_naive()
            after_snapshot = _load_future_snapshot(snapshot_time=started_at)
            tmdb_lookups = consume_tmdb_lookup_events()
            letterboxd_failures = consume_letterboxd_failure_events()
            try:
                written_paths = _write_tmdb_resolution_audit_files(
                    started_at=started_at,
                    tmdb_lookups=tmdb_lookups,
                )
                logger.info(
                    "Wrote TMDB resolution audit files: %s",
                    ", ".join(str(path) for path in written_paths),
                )
                generated_json_path = next(
                    (path for path in written_paths if path.suffix.lower() == ".json"),
                    None,
                )
                if generated_json_path is not None:
                    fixture_path = _tmdb_fixture_source_of_truth_path()
                    existing_count, generated_count, merged_count = (
                        _merge_generated_tmdb_fixture_into_source_of_truth(
                            generated_json_path=generated_json_path,
                            source_of_truth_path=fixture_path,
                        )
                    )
                    logger.info(
                        "Merged TMDB fixture cases into %s (existing=%s, generated=%s, merged=%s).",
                        fixture_path,
                        existing_count,
                        generated_count,
                        merged_count,
                    )
                deleted_paths = _cleanup_tmdb_resolution_audit_files()
                if deleted_paths:
                    logger.info(
                        "Deleted TMDB resolution audit artifacts: %s",
                        ", ".join(str(path) for path in deleted_paths),
                    )
            except Exception:
                logger.error(
                    "Failed to write/merge/cleanup TMDB resolution audit files.",
                    exc_info=True,
                )
            try:
                _store_run_recap(
                    started_at=started_at,
                    finished_at=finished_at,
                    summary=summary,
                    tmdb_lookups=tmdb_lookups,
                    letterboxd_failures=letterboxd_failures,
                    before_snapshot=before_snapshot,
                    after_snapshot=after_snapshot,
                )
                logger.info("Stored scrape recap for the daily digest.")
            except Exception:
                logger.error("Failed to store scrape recap.", exc_info=True)

    if fatal_error is not None:
        sys.exit(1)


if __name__ == "__main__":
    run()
