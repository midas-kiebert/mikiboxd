from app.scraping import get_movies


def test_movies_payload_requests_matching_fields() -> None:
    payload = get_movies._movies_payload()
    query = payload["query"]

    assert "duration" in query
    assert "releaseYear" in query
    assert "spokenLanguages" in query


def test_film_model_parses_matching_fields() -> None:
    parsed = get_movies.Film.model_validate(
        {
            "id": "abc",
            "slug": "movie-slug",
            "title": "Movie",
            "cast": ["Actor One"],
            "directors": ["Director One"],
            "duration": 116,
            "releaseYear": 1999,
            "spokenLanguages": ["en", "fr"],
        }
    )

    assert parsed.duration == 116
    assert parsed.releaseYear == 1999
    assert parsed.spokenLanguages == ["en", "fr"]
