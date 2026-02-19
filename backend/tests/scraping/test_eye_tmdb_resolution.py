from app.scraping.cinemas.amsterdam import eye
from app.scraping.tmdb import TmdbMovieDetails


def test_pick_best_tmdb_candidate_prefers_higher_title_confidence(monkeypatch) -> None:
    query_to_tmdb = {
        "no other choice": 639988,
        "Eojjeolsuga eobsda": 1538086,
    }
    details_by_id = {
        639988: TmdbMovieDetails(
            title="No Other Choice",
            original_title="어쩔수가없다",
            release_year=2025,
            directors=["Park Chan-wook"],
            poster_url=None,
            enriched_at=None,
        ),
        1538086: TmdbMovieDetails(
            title="Genocidal Organ",
            original_title="학살기관",
            release_year=None,
            directors=["Park Chan-wook"],
            poster_url=None,
            enriched_at=None,
        ),
    }

    monkeypatch.setattr(
        eye,
        "find_tmdb_id",
        lambda title_query, director_names: query_to_tmdb.get(title_query),
    )
    monkeypatch.setattr(
        eye,
        "get_tmdb_movie_details",
        lambda tmdb_id: details_by_id[tmdb_id],
    )

    selected = eye._pick_best_tmdb_candidate(
        candidate_queries=["no other choice", "Eojjeolsuga eobsda"],
        directors=["Park Chan-wook"],
    )

    assert selected is not None
    selected_id, _, selected_query, _ = selected
    assert selected_id == 639988
    assert selected_query == "no other choice"


def test_pick_best_tmdb_candidate_uses_primary_query_as_tiebreak(monkeypatch) -> None:
    query_to_tmdb = {
        "primary": 1,
        "secondary": 2,
    }
    details_by_id = {
        1: TmdbMovieDetails(
            title="A",
            original_title=None,
            release_year=None,
            directors=[],
            poster_url=None,
            enriched_at=None,
        ),
        2: TmdbMovieDetails(
            title="B",
            original_title=None,
            release_year=None,
            directors=[],
            poster_url=None,
            enriched_at=None,
        ),
    }

    monkeypatch.setattr(
        eye,
        "find_tmdb_id",
        lambda title_query, director_names: query_to_tmdb.get(title_query),
    )
    monkeypatch.setattr(
        eye,
        "get_tmdb_movie_details",
        lambda tmdb_id: details_by_id[tmdb_id],
    )
    monkeypatch.setattr(eye, "_tmdb_match_confidence", lambda **kwargs: 50.0)

    selected = eye._pick_best_tmdb_candidate(
        candidate_queries=["primary", "secondary"],
        directors=[],
    )

    assert selected is not None
    selected_id, _, selected_query, selected_confidence = selected
    assert selected_id == 1
    assert selected_query == "primary"
    assert selected_confidence == 50.0
