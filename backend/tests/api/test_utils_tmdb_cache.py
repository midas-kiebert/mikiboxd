from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.models.tmdb_lookup_cache import TmdbLookupCache


def test_superuser_can_upsert_tmdb_cache_override(
    *,
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db_transaction: Session,
) -> None:
    request_body = {
        "title_query": "The Test Movie",
        "director_names": ["Jane Doe"],
        "actor_name": "John Doe",
        "year": 2024,
        "tmdb_id": 12345,
        "confidence": 92.5,
    }
    response = client.post(
        f"{settings.API_V1_STR}/utils/tmdb-cache/override/",
        headers=superuser_token_headers,
        json=request_body,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["tmdb_id"] == 12345
    assert payload["confidence"] == 92.5

    stmt = select(TmdbLookupCache).where(
        TmdbLookupCache.lookup_hash == payload["lookup_hash"],
        TmdbLookupCache.lookup_payload == payload["lookup_payload"],
    )
    cached = db_transaction.exec(stmt).first()
    assert cached is not None
    assert cached.tmdb_id == 12345
    assert cached.confidence == 92.5

    second_response = client.post(
        f"{settings.API_V1_STR}/utils/tmdb-cache/override/",
        headers=superuser_token_headers,
        json={**request_body, "tmdb_id": 67890, "confidence": 77.0},
    )
    assert second_response.status_code == 200

    refreshed = db_transaction.exec(stmt).first()
    assert refreshed is not None
    assert refreshed.tmdb_id == 67890
    assert refreshed.confidence == 77.0


def test_superuser_can_search_and_correct_tmdb_cache_by_id(
    *,
    client: TestClient,
    superuser_token_headers: dict[str, str],
    db_transaction: Session,
) -> None:
    # Seed the cache row the way a scraper would: via the override endpoint,
    # which is the only way lookup_payload/lookup_hash get built correctly.
    create_response = client.post(
        f"{settings.API_V1_STR}/utils/tmdb-cache/override/",
        headers=superuser_token_headers,
        json={
            "title_query": "Rally",
            "director_names": [],
            "year": None,
            "duration_minutes": 95,
            "spoken_languages": ["nl"],
            "tmdb_id": 111,
        },
    )
    assert create_response.status_code == 200

    search_response = client.get(
        f"{settings.API_V1_STR}/utils/tmdb-cache/search/",
        headers=superuser_token_headers,
        params={"title": "Rally"},
    )
    assert search_response.status_code == 200
    results = search_response.json()
    assert len(results) == 1
    assert results[0]["tmdb_id"] == 111
    cache_id = results[0]["id"]

    correct_response = client.post(
        f"{settings.API_V1_STR}/utils/tmdb-cache/correct/",
        headers=superuser_token_headers,
        json={"cache_id": cache_id, "tmdb_id": 222},
    )
    assert correct_response.status_code == 200
    assert correct_response.json()["tmdb_id"] == 222

    corrected = db_transaction.get(TmdbLookupCache, cache_id)
    assert corrected is not None
    assert corrected.tmdb_id == 222


def test_correct_tmdb_cache_entry_404s_for_unknown_id(
    *,
    client: TestClient,
    superuser_token_headers: dict[str, str],
) -> None:
    response = client.post(
        f"{settings.API_V1_STR}/utils/tmdb-cache/correct/",
        headers=superuser_token_headers,
        json={"cache_id": 999_999_999, "tmdb_id": 1},
    )
    assert response.status_code == 404
