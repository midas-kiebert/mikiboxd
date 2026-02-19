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
    }
    response = client.post(
        f"{settings.API_V1_STR}/utils/tmdb-cache/override/",
        headers=superuser_token_headers,
        json=request_body,
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["tmdb_id"] == 12345

    stmt = select(TmdbLookupCache).where(
        TmdbLookupCache.lookup_hash == payload["lookup_hash"],
        TmdbLookupCache.lookup_payload == payload["lookup_payload"],
    )
    cached = db_transaction.exec(stmt).first()
    assert cached is not None
    assert cached.tmdb_id == 12345

    second_response = client.post(
        f"{settings.API_V1_STR}/utils/tmdb-cache/override/",
        headers=superuser_token_headers,
        json={**request_body, "tmdb_id": 67890},
    )
    assert second_response.status_code == 200

    refreshed = db_transaction.exec(stmt).first()
    assert refreshed is not None
    assert refreshed.tmdb_id == 67890
