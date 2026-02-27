import asyncio
from types import SimpleNamespace

from app.scraping import get_showtimes, scrape


def _movie_data(*, duration: int | None) -> SimpleNamespace:
    return SimpleNamespace(
        title="Runtime Fallback Film",
        id="production-123",
        cast=[],
        directors=["Julie Ng"],
        releaseYear=2025,
        duration=duration,
        spokenLanguages=["nl"],
    )


def _tmdb_details(*, runtime_minutes: int | None) -> SimpleNamespace:
    return SimpleNamespace(
        title="Runtime Fallback Film",
        directors=["Julie Ng"],
        release_year=2025,
        runtime_minutes=runtime_minutes,
        spoken_languages=["nl"],
        original_title=None,
        enriched_at=None,
    )


def test_process_cineville_movie_falls_back_to_cineville_runtime_when_tmdb_missing(
    monkeypatch,
) -> None:
    async def fake_find_tmdb_id_async(
        *,
        session,
        title_query,
        actor_name,
        director_names,
        year,
        duration_minutes,
        spoken_languages,
    ) -> int:
        _ = (
            session,
            title_query,
            actor_name,
            director_names,
            year,
            duration_minutes,
            spoken_languages,
        )
        return 1234

    async def fake_get_tmdb_movie_details_async(
        *,
        session,
        tmdb_id,
    ) -> SimpleNamespace:
        _ = (session, tmdb_id)
        return _tmdb_details(runtime_minutes=None)

    async def fake_get_showtimes_json_async(
        *,
        productionId,
        session,
    ) -> list[get_showtimes.ShowtimeResponse]:
        _ = (productionId, session)
        return [
            get_showtimes.ShowtimeResponse(
                id="event-1",
                startDate="2026-03-03T18:00:00.000Z",
                endDate=None,
                ticketUrl=None,
                venueName="Eye",
                subtitles=None,
            )
        ]

    monkeypatch.setattr(scrape, "find_tmdb_id_async", fake_find_tmdb_id_async)
    monkeypatch.setattr(
        scrape,
        "get_tmdb_movie_details_async",
        fake_get_tmdb_movie_details_async,
    )
    monkeypatch.setattr(
        scrape.get_showtimes,
        "get_showtimes_json_async",
        fake_get_showtimes_json_async,
    )

    prepared_movie, errors = asyncio.run(
        scrape._process_cineville_movie_async(
            movie_data=_movie_data(duration=75),
            session=object(),
        )
    )

    assert errors == []
    assert prepared_movie is not None
    assert prepared_movie.movie.duration == 75
    assert prepared_movie.showtimes[0].end_date is None


def test_process_cineville_movie_prefers_tmdb_runtime_over_cineville(
    monkeypatch,
) -> None:
    async def fake_find_tmdb_id_async(
        *,
        session,
        title_query,
        actor_name,
        director_names,
        year,
        duration_minutes,
        spoken_languages,
    ) -> int:
        _ = (
            session,
            title_query,
            actor_name,
            director_names,
            year,
            duration_minutes,
            spoken_languages,
        )
        return 1234

    async def fake_get_tmdb_movie_details_async(
        *,
        session,
        tmdb_id,
    ) -> SimpleNamespace:
        _ = (session, tmdb_id)
        return _tmdb_details(runtime_minutes=101)

    async def fake_get_showtimes_json_async(
        *,
        productionId,
        session,
    ) -> list[get_showtimes.ShowtimeResponse]:
        _ = (productionId, session)
        return []

    monkeypatch.setattr(scrape, "find_tmdb_id_async", fake_find_tmdb_id_async)
    monkeypatch.setattr(
        scrape,
        "get_tmdb_movie_details_async",
        fake_get_tmdb_movie_details_async,
    )
    monkeypatch.setattr(
        scrape.get_showtimes,
        "get_showtimes_json_async",
        fake_get_showtimes_json_async,
    )

    prepared_movie, errors = asyncio.run(
        scrape._process_cineville_movie_async(
            movie_data=_movie_data(duration=75),
            session=object(),
        )
    )

    assert errors == []
    assert prepared_movie is not None
    assert prepared_movie.movie.duration == 101
