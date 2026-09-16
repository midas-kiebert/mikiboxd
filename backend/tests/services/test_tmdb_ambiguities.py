"""TMDB lookups that tied between several films are listed for review.

The matcher stores the tie on the lookup-cache row; the admin dashboard lists
those rows until they are marked reviewed or corrected.
"""

import json
from datetime import timedelta

from sqlmodel import Session

from app.models.tmdb_lookup_cache import TmdbLookupCache
from app.scraping.tmdb_runtime import correct_tmdb_lookup_cache_entry
from app.services import tmdb_ambiguities
from app.utils import now_amsterdam_naive

_FAHRENHEIT_AMBIGUITY = {
    "quality": "EXCELLENT",
    "candidates": [
        {"tmdb_id": 1777, "title": "Fahrenheit 9/11", "release_year": 2004},
        {"tmdb_id": 532908, "title": "Fahrenheit 11/9", "release_year": 2018},
    ],
    "resolved_by": [],
}

_row_counter = 0


def _cache_row(
    *,
    session: Session,
    ambiguity: dict | None,
    tmdb_id: int | None = None,
    created_ago: timedelta = timedelta(),
) -> TmdbLookupCache:
    global _row_counter
    _row_counter += 1
    created_at = now_amsterdam_naive() - created_ago
    row = TmdbLookupCache(
        lookup_hash=f"ambiguity-hash-{_row_counter}",
        lookup_payload=json.dumps(
            {
                "title_query": "fahrenheit 9/11",
                "director_names": ["Michael Moore"],
                "actor_names": ["Michael Moore"],
                "year": None,
                "duration_minutes": None,
            }
        ),
        title_query="fahrenheit 9/11",
        tmdb_id=tmdb_id,
        ambiguity_json=json.dumps(ambiguity) if ambiguity is not None else None,
        created_at=created_at,
        updated_at=created_at,
    )
    session.add(row)
    session.flush()
    return row


def test_lists_unreviewed_ties_newest_first_with_the_listing_metadata(
    db_transaction: Session,
) -> None:
    older = _cache_row(
        session=db_transaction,
        ambiguity=_FAHRENHEIT_AMBIGUITY,
        created_ago=timedelta(days=2),
    )
    newer = _cache_row(session=db_transaction, ambiguity=_FAHRENHEIT_AMBIGUITY)
    _cache_row(session=db_transaction, ambiguity=None, tmdb_id=1777)

    views = tmdb_ambiguities.list_ambiguities(
        session=db_transaction, include_reviewed=False, limit=50
    )
    listed_ids = [view.cache_id for view in views]

    assert listed_ids.index(newer.id) < listed_ids.index(older.id)
    view = next(view for view in views if view.cache_id == newer.id)
    assert view.director_names == ["Michael Moore"]
    assert view.year is None
    assert [candidate.tmdb_id for candidate in view.candidates] == [1777, 532908]
    assert view.matched_tmdb_id is None
    assert view.resolved_by == []


def test_a_reviewed_tie_drops_off_the_list_until_reopened(
    db_transaction: Session,
) -> None:
    row = _cache_row(session=db_transaction, ambiguity=_FAHRENHEIT_AMBIGUITY)

    reviewed = tmdb_ambiguities.set_reviewed(
        session=db_transaction, cache_id=row.id, reviewed=True
    )
    db_transaction.flush()

    assert reviewed is not None
    assert reviewed.reviewed_at is not None
    unreviewed_ids = {
        view.cache_id
        for view in tmdb_ambiguities.list_ambiguities(
            session=db_transaction, include_reviewed=False, limit=200
        )
    }
    assert row.id not in unreviewed_ids
    all_ids = {
        view.cache_id
        for view in tmdb_ambiguities.list_ambiguities(
            session=db_transaction, include_reviewed=True, limit=200
        )
    }
    assert row.id in all_ids

    reopened = tmdb_ambiguities.set_reviewed(
        session=db_transaction, cache_id=row.id, reviewed=False
    )
    assert reopened is not None
    assert reopened.reviewed_at is None


def test_only_rows_with_a_tie_can_be_reviewed(db_transaction: Session) -> None:
    row = _cache_row(session=db_transaction, ambiguity=None, tmdb_id=1777)

    assert (
        tmdb_ambiguities.set_reviewed(
            session=db_transaction, cache_id=row.id, reviewed=True
        )
        is None
    )


def test_correcting_a_tied_lookup_marks_it_reviewed(db_transaction: Session) -> None:
    row = _cache_row(session=db_transaction, ambiguity=_FAHRENHEIT_AMBIGUITY)

    correct_tmdb_lookup_cache_entry(
        cache_id=row.id, tmdb_id=1777, session=db_transaction
    )

    db_transaction.refresh(row)
    assert row.is_manual_override is True
    assert row.ambiguity_reviewed_at is not None
