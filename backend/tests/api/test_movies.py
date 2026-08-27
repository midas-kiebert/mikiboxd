from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.crud import user as user_crud
from app.models.user import User


def _normal_user_id(db_transaction: Session):
    return db_transaction.exec(
        select(User.id).where(User.email == settings.EMAIL_TEST_USER)
    ).one()


def test_share_preview_returns_og_tags_with_poster(
    client: TestClient,
    movie_factory,
) -> None:
    """No auth header is passed at all: this endpoint must remain public."""
    movie = movie_factory(
        title="Paddington 3",
        poster_link="https://example.com/paddington.jpg",
    )
    movie_id = movie.id

    response = client.get(
        f"{settings.API_V1_STR}/movies/{movie_id}/share-preview"
    )

    assert response.status_code == 200
    body = response.text

    expected_url = f"{settings.FRONTEND_HOST}/movie/{movie_id}"

    assert 'property="og:title" content="Paddington 3"' in body
    assert 'name="twitter:title" content="Paddington 3"' in body
    assert (
        'property="og:description" content="Check it out on MiKiNO."' in body
    )
    assert (
        'name="twitter:description" content="Check it out on MiKiNO."' in body
    )
    assert (
        'property="og:image" content="https://example.com/paddington.jpg"' in body
    )
    assert (
        'name="twitter:image" content="https://example.com/paddington.jpg"' in body
    )
    assert f'property="og:url" content="{expected_url}"' in body


def test_share_preview_falls_back_to_static_logo_without_poster(
    client: TestClient,
    movie_factory,
) -> None:
    movie = movie_factory(poster_link=None)
    movie_id = movie.id

    response = client.get(
        f"{settings.API_V1_STR}/movies/{movie_id}/share-preview"
    )

    assert response.status_code == 200
    expected_fallback = f"{settings.FRONTEND_HOST}/assets/images/mikino-logo.png"
    body = response.text
    assert f'property="og:image" content="{expected_fallback}"' in body
    assert f'name="twitter:image" content="{expected_fallback}"' in body


def test_share_preview_html_escapes_movie_title(
    client: TestClient,
    movie_factory,
) -> None:
    """Special characters in the movie title must not appear raw in the HTML."""
    movie = movie_factory(title='<script>alert("xss")</script> & Friends')
    movie_id = movie.id

    response = client.get(
        f"{settings.API_V1_STR}/movies/{movie_id}/share-preview"
    )

    assert response.status_code == 200
    body = response.text

    # The raw, unescaped string must never appear in the response body.
    assert "<script>alert(\"xss\")</script>" not in body

    # The escaped version must be present instead.
    assert "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; Friends" in body


def test_share_preview_returns_404_for_nonexistent_movie(
    client: TestClient,
) -> None:
    response = client.get(
        f"{settings.API_V1_STR}/movies/99999999/share-preview"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Movie not found"


def test_cinema_search_reaches_cinemas_outside_the_saved_selection(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    db_transaction: Session,
    showtime_factory,
) -> None:
    """Group-by-movie searches cinemas the same way the showtime feed does.

    Same bug, second endpoint: with no cinema ids sent, the account's saved
    cinemas were filled in and a cinema search could not leave them.
    """
    saved = showtime_factory(cinema__name="Plaza")
    unsaved = showtime_factory(cinema__name="The Grand Picture House")
    user_crud.set_cinema_selections(
        session=db_transaction,
        user_id=_normal_user_id(db_transaction),
        cinema_ids=[saved.cinema_id],
    )
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/movies/",
        params={"query": "grand", "search_field": "cinema"},
        headers=normal_user_token_headers,
    )

    assert response.status_code == 200
    returned_ids = {movie["id"] for movie in response.json()}
    assert unsaved.movie_id in returned_ids
    assert saved.movie_id not in returned_ids
