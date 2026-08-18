"""The browse endpoints answered without a token.

What's playing is public — the app has to be usable before anyone makes an
account (App Store guideline 5.1.1(v)), and shared links have to open for
someone who has never used it. These tests pin down both halves of that: the
catalogue comes back in full, and none of the requester's personal data comes
with it, because there is no requester.

No `headers=` argument anywhere in this file, deliberately.
"""

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.core.config import settings
from app.core.enums import GoingStatus
from app.crud import friendship as friendship_crud
from app.crud import letterboxd_list as lists_crud
from app.crud import showtime as showtime_crud
from app.crud import user as user_crud
from app.models.letterboxd_list import LetterboxdList, LetterboxdListFilm
from app.models.user import User


def _normal_user_id(db_transaction: Session):
    return db_transaction.exec(
        select(User.id).where(User.email == settings.EMAIL_TEST_USER)
    ).one()


def test_showtimes_list_is_readable_without_a_token(
    client: TestClient,
    showtime_factory,
) -> None:
    showtime = showtime_factory()
    showtime_id = showtime.id

    response = client.get(f"{settings.API_V1_STR}/showtimes/")

    assert response.status_code == 200
    assert showtime_id in [item["id"] for item in response.json()]


def test_showtime_detail_is_readable_without_a_token(
    client: TestClient,
    showtime_factory,
) -> None:
    """Shared showtime links land here, so it must open for a stranger."""
    showtime = showtime_factory()
    showtime_id = showtime.id

    response = client.get(f"{settings.API_V1_STR}/showtimes/{showtime_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == showtime_id
    assert body["movie"]["id"] == showtime.movie_id
    assert body["cinema"]["id"] == showtime.cinema_id


def test_movies_list_and_detail_are_readable_without_a_token(
    client: TestClient,
    showtime_factory,
) -> None:
    showtime = showtime_factory()
    movie_id = showtime.movie_id

    list_response = client.get(f"{settings.API_V1_STR}/movies/")
    assert list_response.status_code == 200
    assert movie_id in [movie["id"] for movie in list_response.json()]

    detail_response = client.get(f"{settings.API_V1_STR}/movies/{movie_id}")
    assert detail_response.status_code == 200
    assert detail_response.json()["id"] == movie_id


def test_counts_are_readable_without_a_token(
    client: TestClient,
    showtime_factory,
) -> None:
    showtime_factory()

    showtimes_count = client.get(f"{settings.API_V1_STR}/showtimes/count")
    movies_count = client.get(f"{settings.API_V1_STR}/movies/count")

    assert showtimes_count.status_code == 200
    assert showtimes_count.json() >= 1
    assert movies_count.status_code == 200
    assert movies_count.json() >= 1


def test_movie_showtimes_are_readable_without_a_token(
    client: TestClient,
    showtime_factory,
) -> None:
    showtime = showtime_factory()
    movie_id = showtime.movie_id
    showtime_id = showtime.id

    response = client.get(f"{settings.API_V1_STR}/movies/{movie_id}/showtimes")

    assert response.status_code == 200
    assert showtime_id in [item["id"] for item in response.json()]


def test_anonymous_showtime_carries_no_personal_annotations(
    client: TestClient,
    db_transaction: Session,
    showtime_factory,
    user_factory,
) -> None:
    """The catalogue is public; who is going to it is not.

    Two people are going to this showtime and are friends with each other, so
    every personal field on the response has something it *could* say. To a
    request with no token it must say nothing.
    """
    showtime = showtime_factory()
    showtime_id = showtime.id
    owner_id = _normal_user_id(db_transaction)
    friend = user_factory()
    friend_id = friend.id

    # Two-way in one call, so the friendship is visible from both sides.
    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner_id, friend_id=friend_id
    )
    for user_id in (owner_id, friend_id):
        showtime_crud.add_showtime_selection(
            session=db_transaction,
            showtime_id=showtime_id,
            user_id=user_id,
            going_status=GoingStatus.GOING,
        )
    db_transaction.commit()

    response = client.get(f"{settings.API_V1_STR}/showtimes/{showtime_id}")

    assert response.status_code == 200
    body = response.json()
    # Absent, not empty: there is no viewer to have a relationship to this
    # screening, which is a different statement from a viewer with no friends.
    assert body["viewer"] is None
    # The legacy flat mirrors still answer, neutrally, for builds that predate
    # the viewer block — see app.schemas.legacy_viewer_compat.
    assert body["going"] == GoingStatus.NOT_GOING
    assert body["seat_row"] is None
    assert body["friends_going"] == []
    assert body["non_friend_participants"] == []


def test_anonymous_movie_carries_no_personal_annotations(
    client: TestClient,
    db_transaction: Session,
    showtime_factory,
) -> None:
    showtime = showtime_factory()
    movie_id = showtime.movie_id
    owner_id = _normal_user_id(db_transaction)
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=owner_id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    detail = client.get(f"{settings.API_V1_STR}/movies/{movie_id}").json()
    assert detail["viewer"] is None
    assert detail["friends_watchlisted"] == []

    card = next(
        movie
        for movie in client.get(f"{settings.API_V1_STR}/movies/").json()
        if movie["id"] == movie_id
    )
    assert card["viewer"] is None
    assert card["going"] == GoingStatus.NOT_GOING
    assert card["friends_going"] == []
    # Its nested showtimes are annotated for the same (absent) viewer.
    assert all(item["viewer"] is None for item in card["showtimes"])


def test_anonymous_feed_is_not_narrowed_by_someone_elses_cinemas(
    client: TestClient,
    db_transaction: Session,
    showtime_factory,
) -> None:
    """No account means no saved cinemas, which means the whole catalogue.

    The signed-in default — "wherever I usually go" — has no anonymous
    equivalent, and resolving it to an empty set would have shown a first-time
    visitor an empty app.
    """
    kept = showtime_factory()
    other = showtime_factory()
    owner_id = _normal_user_id(db_transaction)
    # The only account in the database has picked exactly one of the two
    # cinemas; an anonymous request must not inherit that.
    user_crud.set_cinema_selections(
        session=db_transaction, user_id=owner_id, cinema_ids=[kept.cinema_id]
    )
    db_transaction.commit()

    response = client.get(f"{settings.API_V1_STR}/showtimes/")

    assert response.status_code == 200
    returned_ids = {item["id"] for item in response.json()}
    assert {kept.id, other.id} <= returned_ids


def test_anonymous_status_filter_does_not_empty_the_feed(
    client: TestClient,
    showtime_factory,
) -> None:
    """"Going / interested" is about a person, so it is dropped, not applied.

    Applied against a NULL viewer it would match nothing, and a client that
    sent it (an old build, a shared link with query params) would show a
    signed-out visitor an empty catalogue rather than an unfiltered one.
    """
    showtime = showtime_factory()

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/",
        params={"selected_statuses": [GoingStatus.GOING.value]},
    )

    assert response.status_code == 200
    assert showtime.id in [item["id"] for item in response.json()]


def test_account_endpoints_still_require_a_token(client: TestClient) -> None:
    """The opening up is limited to browsing; nothing personal came with it."""
    for path in (
        "/me/",
        "/me/friends",
        "/me/showtimes",
        "/me/cinemas",
    ):
        response = client.get(f"{settings.API_V1_STR}{path}")
        assert response.status_code == 401, path


def test_expired_token_is_still_rejected_rather_than_treated_as_anonymous(
    client: TestClient,
    showtime_factory,
) -> None:
    """A bad token is a dead session, not a signed-out visitor.

    Downgrading it to anonymous would hide an expired login behind a page that
    looks signed-out but never says so, and would never give the client the 401
    that puts it on its refresh path.
    """
    showtime = showtime_factory()

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/{showtime.id}",
        headers={"Authorization": "Bearer not-a-real-token"},
    )

    assert response.status_code == 401


def _list_with_movie(
    session: Session, *, movie_id: int, slug: str, is_curated: bool
) -> LetterboxdList:
    letterboxd_list = lists_crud.create_list(
        session=session,
        letterboxd_list=LetterboxdList(
            owner="someone", list_slug=slug, is_curated=is_curated
        ),
    )
    lists_crud.replace_list_films(
        session=session,
        list_id=letterboxd_list.id,
        films=[
            LetterboxdListFilm(
                list_id=letterboxd_list.id,
                letterboxd_slug=slug + "-film",
                movie_id=movie_id,
            )
        ],
    )
    return letterboxd_list


def test_anonymous_can_filter_by_a_curated_list(
    client: TestClient,
    db_transaction: Session,
    showtime_factory,
) -> None:
    """The curated lists belong to nobody, so filtering by one is just browsing.

    Dropping the filter (as every other list id is dropped) would have answered
    a request for "films on the Top 250" with the entire catalogue.
    """
    on_list = showtime_factory()
    off_list = showtime_factory()
    curated = _list_with_movie(
        db_transaction, movie_id=on_list.movie_id, slug="curated", is_curated=True
    )
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/",
        params={"list_ids": [str(curated.id)]},
    )

    assert response.status_code == 200
    returned_ids = {item["id"] for item in response.json()}
    assert on_list.id in returned_ids
    assert off_list.id not in returned_ids


def test_anonymous_list_filter_ignores_someone_elses_list(
    client: TestClient,
    db_transaction: Session,
    showtime_factory,
) -> None:
    """A non-curated list id can only be another account's, or a guess.

    Honouring it would leak which films are on a private list; applying it as
    sent would also be meaningless. It is dropped, and the feed stays whole.
    """
    showtime = showtime_factory()
    other = showtime_factory()
    private_list = _list_with_movie(
        db_transaction, movie_id=showtime.movie_id, slug="private", is_curated=False
    )
    db_transaction.commit()

    response = client.get(
        f"{settings.API_V1_STR}/showtimes/",
        params={"list_ids": [str(private_list.id)]},
    )

    assert response.status_code == 200
    returned_ids = {item["id"] for item in response.json()}
    assert {showtime.id, other.id} <= returned_ids


def test_curated_lists_are_readable_without_a_token(
    client: TestClient,
    db_transaction: Session,
    showtime_factory,
) -> None:
    showtime = showtime_factory()
    _list_with_movie(
        db_transaction, movie_id=showtime.movie_id, slug="public-curated", is_curated=True
    )
    db_transaction.commit()

    response = client.get(f"{settings.API_V1_STR}/letterboxd-lists/curated")

    assert response.status_code == 200
    assert "public-curated" in [item["list_slug"] for item in response.json()]
