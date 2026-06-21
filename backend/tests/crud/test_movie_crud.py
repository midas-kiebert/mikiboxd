from collections.abc import Callable
from datetime import timedelta

import pytest
from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.core.enums import GoingStatus, Language, SearchField
from app.crud import friendship as friendship_crud
from app.crud import movie as movie_crud
from app.crud import showtime as showtime_crud
from app.crud import user as user_crud
from app.inputs.movie import Filters
from app.models.cinema import Cinema
from app.models.movie import Movie, MovieCreate, MovieUpdate
from app.models.showtime import Showtime
from app.models.user import User
from app.models.watched_selection import WatchedSelection
from app.models.watchlist_selection import WatchlistSelection
from app.utils import now_amsterdam_naive


def test_get_movie_by_id_success(
    *,
    db_transaction: Session,
    movie_factory,
):
    movie: Movie = movie_factory()

    retrieved_movie = movie_crud.get_movie_by_id(
        session=db_transaction,
        id=movie.id,
    )

    # Check if the returned object matches the one in the database
    assert retrieved_movie is movie


def test_get_movie_by_id_not_found(
    *,
    db_transaction: Session,
):
    retrieved_movie = movie_crud.get_movie_by_id(
        session=db_transaction,
        id=1,  # Assuming this ID does not exist
    )

    # Check if the returned object is None when the movie does not exist
    assert retrieved_movie is None


def test_create_movie_success(
    *,
    db_transaction: Session,
    movie_create_factory,
):
    movie_create: MovieCreate = movie_create_factory()

    created_movie = movie_crud.create_movie(
        session=db_transaction,
        movie_create=movie_create,
    )

    # Check if the returned object is correct
    assert created_movie.id is not None
    assert created_movie.title == movie_create.title
    assert created_movie.poster_link == movie_create.poster_link
    assert created_movie.letterboxd_slug == movie_create.letterboxd_slug


def test_create_movie_already_exists(
    *,
    db_transaction: Session,
    movie_create_factory,
    movie_factory,
):
    movie: Movie = movie_factory()

    movie_create: MovieCreate = movie_create_factory(id=movie.id)

    with pytest.raises(IntegrityError) as exc_info:
        movie_crud.create_movie(
            session=db_transaction,
            movie_create=movie_create,
        )

    assert isinstance(exc_info.value.orig, UniqueViolation)


def test_get_movie_by_letterboxd_slug_success(
    *,
    db_transaction: Session,
    movie_factory,
):
    movie: Movie = movie_factory()
    assert movie.letterboxd_slug is not None

    retrieved_movie = movie_crud.get_movie_by_letterboxd_slug(
        session=db_transaction,
        letterboxd_slug=movie.letterboxd_slug,
    )

    # Check if the returned object matches the one in the database
    assert retrieved_movie is movie


def test_get_movie_by_letterboxd_slug_not_found(
    *,
    db_transaction: Session,
):
    retrieved_movie = movie_crud.get_movie_by_letterboxd_slug(
        session=db_transaction,
        letterboxd_slug="nonexistent-slug",
    )

    # Check if the returned object is None when the movie does not exist
    assert retrieved_movie is None


def test_get_movies_without_letterboxd_slug(
    *,
    db_transaction: Session,
    movie_factory,
):
    # Create movies with and without Letterboxd slugs
    movie_factory(letterboxd_slug="valid-slug")
    movie_without_slug: Movie = movie_factory(letterboxd_slug=None)

    movies_without_slug = movie_crud.get_movies_without_letterboxd_slug(
        session=db_transaction,
    )

    # Check if the returned list contains only the movie without a slug
    assert len(movies_without_slug) == 1
    assert movies_without_slug[0] is movie_without_slug
    assert movies_without_slug[0].letterboxd_slug is None


def test_update_movie_success(*, movie_factory: Callable[..., Movie]):
    movie: Movie = movie_factory()

    movie_update = MovieUpdate(letterboxd_slug="updated-slug")

    updated_movie = movie_crud.update_movie(db_movie=movie, movie_update=movie_update)

    assert movie.letterboxd_slug == "updated-slug"
    assert updated_movie is movie


def test_upsert_movie_preserves_existing_duration_when_payload_duration_is_missing(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
):
    existing_movie = movie_factory(duration=121)
    movie_create = MovieCreate(
        id=existing_movie.id,
        title=existing_movie.title,
        poster_link=existing_movie.poster_link,
        letterboxd_slug=existing_movie.letterboxd_slug,
        duration=None,
    )

    updated_movie = movie_crud.upsert_movie(
        session=db_transaction,
        movie_create=movie_create,
    )

    assert updated_movie.id == existing_movie.id
    assert updated_movie.duration == 121


def test_upsert_movie_preserves_existing_language_data_when_payload_language_is_missing(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
):
    """A transient TMDB lookup failure must not wipe previously-enriched language data."""
    existing_movie = movie_factory(
        languages=["en", "fr"],
        original_language="en",
    )
    movie_create = MovieCreate(
        id=existing_movie.id,
        title=existing_movie.title,
        poster_link=existing_movie.poster_link,
        letterboxd_slug=existing_movie.letterboxd_slug,
        languages=None,
        original_language=None,
    )

    updated_movie = movie_crud.upsert_movie(
        session=db_transaction,
        movie_create=movie_create,
    )

    assert updated_movie.id == existing_movie.id
    assert updated_movie.languages == ["en", "fr"]
    assert updated_movie.original_language == "en"


def test_upsert_movie_updates_language_data_when_payload_has_real_values(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
):
    existing_movie = movie_factory(
        languages=["en"],
        original_language="en",
    )
    movie_create = MovieCreate(
        id=existing_movie.id,
        title=existing_movie.title,
        poster_link=existing_movie.poster_link,
        letterboxd_slug=existing_movie.letterboxd_slug,
        languages=["nl", "en"],
        original_language="nl",
    )

    updated_movie = movie_crud.upsert_movie(
        session=db_transaction,
        movie_create=movie_create,
    )

    assert updated_movie.id == existing_movie.id
    assert updated_movie.languages == ["nl", "en"]
    assert updated_movie.original_language == "nl"


# def test_get_cinemas_for_movie(
#     *,
#     db_transaction: Session,
#     movie_factory: Callable[..., Movie],
#     cinema_factory: Callable[..., Cinema],
#     showtime_factory: Callable[..., Showtime],
#     user_factory: Callable[..., User],
# ):
#     cinema_1, cinema_2, cinema_3, cinema_4 = (cinema_factory() for _ in range(4))
#     user = user_factory()

#     past = now_amsterdam_naive() - timedelta(minutes=10)
#     future = now_amsterdam_naive() + timedelta(minutes=10)

#     movie = movie_factory(
#         showtimes=[
#             showtime_factory(cinema=cinema_1, datetime=past),
#             showtime_factory(cinema=cinema_2, datetime=past),
#             showtime_factory(cinema=cinema_2, datetime=future),
#             showtime_factory(cinema=cinema_3, datetime=future),
#         ]
#     )

#     movie_factory(
#         showtimes=[
#             showtime_factory(cinema=cinema_1, datetime=future),
#             showtime_factory(cinema=cinema_3, datetime=future),
#             showtime_factory(cinema=cinema_4, datetime=past),
#             showtime_factory(cinema=cinema_4, datetime=future),
#         ]
#     )

# user_crud.set_cinema_selections(
#     session=db_transaction,
#     user_id=user.id,
#     cinema_ids=[cinema_1.id, cinema_3.id, cinema_4.id],
# )

# cinemas = movie_crud.get_cinemas_for_movie(
#     session=db_transaction,
#     movie_id=movie.id,
#     snapshot_time=now_amsterdam_naive(),
#     current_user_id=user.id,
# )

# assert cinema_3 in cinemas
# assert len(cinemas) == 1

# user_crud.set_cinema_selections(
#     session=db_transaction,
#     user_id=user.id,
#     cinema_ids=[cinema_1.id, cinema_2.id, cinema_3.id, cinema_4.id],
# )

# cinemas = movie_crud.get_cinemas_for_movie(
#     session=db_transaction,
#     movie_id=movie.id,
#     snapshot_time=now_amsterdam_naive(),
#     current_user_id=user.id,
# )

# assert cinema_2 in cinemas
# assert cinema_3 in cinemas
# assert len(cinemas) == 2

# more_future = now_amsterdam_naive() + timedelta(minutes=20)

# cinemas_in_20_minutes = movie_crud.get_cinemas_for_movie(
#     session=db_transaction,
#     movie_id=movie.id,
#     snapshot_time=more_future,
#     current_user_id=user.id,
# )

# assert len(cinemas_in_20_minutes) == 0


def test_get_friends_for_movie(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    user = user_factory()
    friend_1 = user_factory()
    friend_2 = user_factory()
    user_3 = user_factory()

    # Create friendships
    friendship_crud.create_friendship(
        session=db_transaction, user_id=user.id, friend_id=friend_1.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=user.id, friend_id=friend_2.id
    )

    past = now_amsterdam_naive() - timedelta(minutes=10)

    showtimes = [
        showtime_factory(datetime=past),
        showtime_factory(),
        showtime_factory(),
    ]

    other_showtime = showtime_factory()

    all_showtimes = showtimes + [other_showtime]

    user_crud.set_cinema_selections(
        session=db_transaction,
        user_id=user.id,
        cinema_ids=list({showtime.cinema_id for showtime in all_showtimes}),
    )

    movie = movie_factory(showtimes=showtimes)

    # Showtime selections
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=user.id, showtime_id=showtimes[1].id
    )
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=friend_1.id, showtime_id=showtimes[1].id
    )
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=friend_2.id, showtime_id=showtimes[0].id
    )
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=user_3.id, showtime_id=showtimes[2].id
    )
    user_crud.add_showtime_selection(
        session=db_transaction, user_id=friend_2.id, showtime_id=other_showtime.id
    )

    friends = movie_crud.get_friends_for_movie(
        session=db_transaction,
        movie_id=movie.id,
        current_user=user.id,
        snapshot_time=now_amsterdam_naive(),
    )

    assert friend_1 in friends
    assert len(friends) == 1


def test_get_showtimes_for_movie_filters_by_selected_statuses(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    friend = user_factory()
    not_friend = user_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=user.id, friend_id=friend.id
    )

    movie = movie_factory()
    showtime_going = showtime_factory(movie=movie)
    showtime_interested = showtime_factory(movie=movie)
    showtime_not_friend = showtime_factory(movie=movie)

    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_going.id,
        user_id=user.id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_interested.id,
        user_id=friend.id,
        going_status=GoingStatus.INTERESTED,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_not_friend.id,
        user_id=not_friend.id,
        going_status=GoingStatus.GOING,
    )

    going_filtered = movie_crud.get_showtimes_for_movie(
        session=db_transaction,
        movie_id=movie.id,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_statuses=[GoingStatus.GOING],
        ),
        current_user_id=user.id,
    )

    assert showtime_going in going_filtered
    assert showtime_interested not in going_filtered
    assert showtime_not_friend not in going_filtered

    interested_filtered = movie_crud.get_showtimes_for_movie(
        session=db_transaction,
        movie_id=movie.id,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_statuses=[GoingStatus.GOING, GoingStatus.INTERESTED],
        ),
        current_user_id=user.id,
    )

    assert showtime_going in interested_filtered
    assert showtime_interested in interested_filtered
    assert showtime_not_friend not in interested_filtered


def test_get_movies_filters_by_selected_statuses(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    friend = user_factory()
    stranger = user_factory()

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=user.id,
        friend_id=friend.id,
    )

    movie_going = movie_factory()
    movie_interested = movie_factory()
    movie_stranger_only = movie_factory()

    showtime_going = showtime_factory(movie=movie_going)
    showtime_interested = showtime_factory(movie=movie_interested)
    showtime_stranger_only = showtime_factory(movie=movie_stranger_only)

    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_going.id,
        user_id=user.id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_interested.id,
        user_id=friend.id,
        going_status=GoingStatus.INTERESTED,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_stranger_only.id,
        user_id=stranger.id,
        going_status=GoingStatus.GOING,
    )

    going_only = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_statuses=[GoingStatus.GOING],
        ),
    )
    assert {movie.id for movie in going_only} == {movie_going.id}

    going_or_interested = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_statuses=[GoingStatus.GOING, GoingStatus.INTERESTED],
        ),
    )
    assert {movie.id for movie in going_or_interested} == {
        movie_going.id,
        movie_interested.id,
    }


def test_get_movies_and_count_movies_filter_by_selected_languages(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    """A movie matches if EITHER its original language OR a showtime's
    subtitles are in the selected languages - the two checks are an OR, not
    an AND. A French movie with English subtitles must still show up under
    an English filter, and an English movie with no English subtitles at all
    must still show up too.
    """
    user = user_factory()

    # Original-language match alone is enough, regardless of subtitles.
    movie_english_original = movie_factory(original_language="en")
    showtime_factory(movie=movie_english_original, subtitles=["fr"])

    # Subtitle match alone is enough, even when the original language differs.
    movie_french_with_english_subs = movie_factory(original_language="fr")
    showtime_factory(movie=movie_french_with_english_subs, subtitles=["en"])

    # Neither the original language nor the subtitles match -> excluded.
    movie_no_match = movie_factory(original_language="es")
    showtime_factory(movie=movie_no_match, subtitles=["de"])

    english_only = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_languages=[Language.ENGLISH],
        ),
    )
    assert {movie.id for movie in english_only} == {
        movie_english_original.id,
        movie_french_with_english_subs.id,
    }

    count = movie_crud.count_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_languages=[Language.ENGLISH],
        ),
    )
    assert count == 2

    movie_dutch_original = movie_factory(original_language="nl")
    showtime_factory(movie=movie_dutch_original, subtitles=["fr"])

    english_or_dutch = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_languages=[Language.ENGLISH, Language.DUTCH],
        ),
    )
    matched_ids = {movie.id for movie in english_or_dutch}
    assert matched_ids == {
        movie_english_original.id,
        movie_french_with_english_subs.id,
        movie_dutch_original.id,
    }
    assert movie_no_match.id not in matched_ids


def test_get_showtimes_for_movie_filters_by_selected_languages(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()

    # Movie's original language matches -> every showtime included regardless
    # of its own subtitles.
    english_movie = movie_factory(original_language="en")
    showtime_no_subtitle_overlap = showtime_factory(movie=english_movie, subtitles=["fr"])

    # Movie's original language doesn't match -> only showtimes whose own
    # subtitles match are included.
    french_movie = movie_factory(original_language="fr")
    showtime_matching_subtitles = showtime_factory(movie=french_movie, subtitles=["en"])
    showtime_no_match = showtime_factory(movie=french_movie, subtitles=["nl"])

    english_movie_showtimes = movie_crud.get_showtimes_for_movie(
        session=db_transaction,
        movie_id=english_movie.id,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_languages=[Language.ENGLISH],
        ),
        current_user_id=user.id,
    )
    assert showtime_no_subtitle_overlap in english_movie_showtimes

    french_movie_showtimes = movie_crud.get_showtimes_for_movie(
        session=db_transaction,
        movie_id=french_movie.id,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            selected_languages=[Language.ENGLISH],
        ),
        current_user_id=user.id,
    )
    assert showtime_matching_subtitles in french_movie_showtimes
    assert showtime_no_match not in french_movie_showtimes


def test_get_movies_filters_by_runtime(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    movie_short = movie_factory(duration=80)
    movie_match = movie_factory(duration=105)
    movie_long = movie_factory(duration=150)

    showtime_factory(movie=movie_short)
    showtime_factory(movie=movie_match)
    showtime_factory(movie=movie_long)

    movies = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            runtime_min=90,
            runtime_max=120,
        ),
    )

    assert {movie.id for movie in movies} == {movie_match.id}


def test_get_movies_and_count_movies_hide_watched_filter(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()

    movie_watched = movie_factory()
    movie_unwatched = movie_factory()

    showtime_factory(movie=movie_watched)
    showtime_factory(movie=movie_unwatched)

    db_transaction.add(
        WatchedSelection(
            letterboxd_username=user.letterboxd_username,
            letterboxd_slug=movie_watched.letterboxd_slug,
            movie_id=movie_watched.id,
        )
    )
    db_transaction.flush()

    movies = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            hide_watched=True,
        ),
    )
    assert {movie.id for movie in movies} == {movie_unwatched.id}

    count = movie_crud.count_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            hide_watched=True,
        ),
    )
    assert count == 1


def test_get_showtimes_for_movie_hide_watched_filter(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()

    movie_watched = movie_factory()

    showtime_watched = showtime_factory(movie=movie_watched)

    db_transaction.add(
        WatchedSelection(
            letterboxd_username=user.letterboxd_username,
            letterboxd_slug=movie_watched.letterboxd_slug,
            movie_id=movie_watched.id,
        )
    )
    db_transaction.flush()

    showtimes = movie_crud.get_showtimes_for_movie(
        session=db_transaction,
        movie_id=movie_watched.id,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            hide_watched=True,
        ),
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
    )

    assert showtime_watched not in showtimes


def test_get_movies_query_is_diacritics_insensitive(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    movie = movie_factory(title="München", directors=[])
    other = movie_factory(title="Some Other Film", directors=[])
    showtime_factory(movie=movie)
    showtime_factory(movie=other)

    movies = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            query="munchen",
        ),
    )

    assert {m.id for m in movies} == {movie.id}


def test_get_movies_exact_title_match_ranked_first(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    movie_substring = movie_factory(title="Madagascar", directors=[])
    movie_exact = movie_factory(title="M", directors=[])

    # The substring match's showtime is earlier, so without ranking it would
    # sort first by min(showtime.datetime) — ranking must override that.
    showtime_factory(movie=movie_substring, datetime=now_amsterdam_naive() + timedelta(hours=1))
    showtime_factory(movie=movie_exact, datetime=now_amsterdam_naive() + timedelta(hours=2))

    movies = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            query="M",
        ),
    )

    assert [m.id for m in movies] == [movie_exact.id, movie_substring.id]


def test_get_movies_search_field_director(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    movie_match = movie_factory(title="A Film", directors=["Greta Gerwig"])
    movie_other = movie_factory(title="B Film", directors=["Someone Else"])
    showtime_factory(movie=movie_match)
    showtime_factory(movie=movie_other)

    movies = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            query="gerwig",
            search_field=SearchField.DIRECTOR,
        ),
    )

    assert {m.id for m in movies} == {movie_match.id}


def test_get_movies_search_field_actor(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    movie_match = movie_factory(
        title="A Film", directors=[], cast=["Timothée Chalamet"]
    )
    movie_other = movie_factory(title="B Film", directors=[], cast=["Someone Else"])
    showtime_factory(movie=movie_match)
    showtime_factory(movie=movie_other)

    movies = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            query="chalamet",
            search_field=SearchField.ACTOR,
        ),
    )

    assert {m.id for m in movies} == {movie_match.id}


def test_get_movies_search_field_cinema(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    cinema_factory: Callable[..., Cinema],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    cinema_match = cinema_factory(name="The Grand Picture House")
    cinema_other = cinema_factory(name="Plaza")
    movie_match = movie_factory(title="A Film", directors=[])
    movie_other = movie_factory(title="B Film", directors=[])
    showtime_factory(movie=movie_match, cinema=cinema_match)
    showtime_factory(movie=movie_other, cinema=cinema_other)

    movies = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            query="grand",
            search_field=SearchField.CINEMA,
        ),
    )

    assert {m.id for m in movies} == {movie_match.id}


def test_get_movies_search_field_friend(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    user = user_factory()
    friend = user_factory(display_name="Alice Wonderland")
    stranger = user_factory(display_name="Bob Builder")

    friendship_crud.create_friendship(
        session=db_transaction, user_id=user.id, friend_id=friend.id
    )

    movie_match = movie_factory(title="A Film", directors=[])
    movie_other = movie_factory(title="B Film", directors=[])
    showtime_match = showtime_factory(movie=movie_match)
    showtime_other = showtime_factory(movie=movie_other)

    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_match.id,
        user_id=friend.id,
        going_status=GoingStatus.INTERESTED,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime_other.id,
        user_id=stranger.id,
        going_status=GoingStatus.GOING,
    )
    user_crud.set_cinema_selections(
        session=db_transaction,
        user_id=user.id,
        cinema_ids=[showtime_match.cinema_id, showtime_other.cinema_id],
    )

    movies = movie_crud.get_movies(
        session=db_transaction,
        current_user_id=user.id,
        letterboxd_username=user.letterboxd_username,
        limit=20,
        offset=0,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            query="alice",
            search_field=SearchField.FRIEND,
        ),
    )

    assert {m.id for m in movies} == {movie_match.id}


def test_get_showtimes_for_movie_shows_showtimes_for_card_when_watchlist_only(
    *,
    db_transaction: Session,
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
    user_factory: Callable[..., User],
):
    """A grouped movie card must still show its own showtimes under watchlist-only.

    Cards call get_showtimes_for_movie WITHOUT a letterboxd_username (the movie has
    already qualified via the list-level query), so the movie-set filters must be
    skipped rather than forcing an empty result.
    """
    user = user_factory()
    movie = movie_factory()
    showtime = showtime_factory(movie=movie)

    showtimes = movie_crud.get_showtimes_for_movie(
        session=db_transaction,
        movie_id=movie.id,
        filters=Filters(
            snapshot_time=now_amsterdam_naive() - timedelta(minutes=1),
            watchlist_only=True,
        ),
        current_user_id=user.id,
        # no letterboxd_username — mirrors the grouped-movie card path
    )

    assert showtime in showtimes


# def test_get_showtimes_for_movie(
#     *,
#     db_transaction: Session,
#     movie_factory: Callable[..., Movie],
#     showtime_factory: Callable[..., Showtime],
#     user_factory: Callable[..., User],
# ):
#     user = user_factory()
#     past = now_amsterdam_naive() - timedelta(minutes=10)
#     future = now_amsterdam_naive() + timedelta(minutes=10)

#     showtimes = [
#         showtime_factory(datetime=past),
#         showtime_factory(datetime=future),
#         showtime_factory(datetime=future),
#     ]

#     movie = movie_factory(showtimes=showtimes)

#     user_crud.set_cinema_selections(
#         session=db_transaction,
#         user_id=user.id,
#         cinema_ids=list({showtime.cinema_id for showtime in showtimes}),
#     )

#     retrieved_showtimes = movie_crud.get_showtimes_for_movie(
#         session=db_transaction,
#         movie_id=movie.id,
#         snapshot_time=now_amsterdam_naive(),
#         current_user_id=user.id,
#     )

#     assert showtimes[1] in retrieved_showtimes
#     assert showtimes[2] in retrieved_showtimes
#     assert len(retrieved_showtimes) == 2

#     retrieved_showtimes_limited = movie_crud.get_showtimes_for_movie(
#         session=db_transaction,
#         movie_id=movie.id,
#         limit=1,
#         snapshot_time=now_amsterdam_naive(),
#         current_user_id=user.id,
#     )
#     assert len(retrieved_showtimes_limited) == 1


# def test_get_last_showtime_datetime(
#     *,
#     db_transaction: Session,
#     movie_factory: Callable[..., Movie],
#     showtime_factory: Callable[..., Showtime],
#     user_factory: Callable[..., User],
# ):
#     user = user_factory()
#     past = now_amsterdam_naive() - timedelta(minutes=10)
#     future = now_amsterdam_naive() + timedelta(minutes=10)
#     far_future = now_amsterdam_naive() + timedelta(days=10)
#     very_far_future = now_amsterdam_naive() + timedelta(days=100)

#     showtimes_1 = [
#         showtime_factory(datetime=past),
#         showtime_factory(datetime=far_future),
#     ]

#     showtimes_2 = [
#         showtime_factory(datetime=very_far_future),
#         showtime_factory(datetime=future),
#     ]

#     showtimes = showtimes_1 + showtimes_2

#     movie = movie_factory(showtimes=showtimes_1)
#     other_movie = movie_factory(showtimes=showtimes_2)

#     user_crud.set_cinema_selections(
#         session=db_transaction,
#         user_id=user.id,
#         cinema_ids=list({showtime.cinema_id for showtime in showtimes}),
#     )

#     last_showtime_datetime = movie_crud.get_last_showtime_datetime(
#         session=db_transaction,
#         movie_id=movie.id,
#         current_user_id=user.id,
#     )

#     assert last_showtime_datetime == far_future

#     last_showtime_datetime_other = movie_crud.get_last_showtime_datetime(
#         session=db_transaction,
#         movie_id=other_movie.id,
#         current_user_id=user.id,
#     )

#     assert last_showtime_datetime_other == very_far_future


# def test_get_last_showtime_datetime_no_showtimes(
#     *,
#     db_transaction: Session,
#     movie_factory: Callable[..., Movie],
#     user_factory: Callable[..., User],
# ):
#     user = user_factory()
#     movie = movie_factory()

#     last_showtime_datetime = movie_crud.get_last_showtime_datetime(
#         session=db_transaction,
#         movie_id=movie.id,
#         current_user_id=user.id,
#     )

#     assert last_showtime_datetime is None


# def test_get_total_number_of_future_showtimes(
#     *,
#     db_transaction: Session,
#     movie_factory: Callable[..., Movie],
#     showtime_factory: Callable[..., Showtime],
#     user_factory: Callable[..., User],
# ):
#     user = user_factory()
#     past = now_amsterdam_naive() - timedelta(minutes=10)
#     future = now_amsterdam_naive() + timedelta(minutes=10)

#     showtimes = [
#         showtime_factory(datetime=past),
#         showtime_factory(datetime=future),
#         showtime_factory(datetime=future),
#     ]

#     movie = movie_factory(showtimes=showtimes)

#     user_crud.set_cinema_selections(
#         session=db_transaction,
#         user_id=user.id,
#         cinema_ids=list({showtime.cinema_id for showtime in showtimes}),
#     )

#     total_showtimes = movie_crud.get_total_number_of_future_showtimes(
#         session=db_transaction,
#         movie_id=movie.id,
#         snapshot_time=now_amsterdam_naive(),
#         current_user_id=user.id,
#     )

#     assert total_showtimes == 2

#     total_showtimes_past = movie_crud.get_total_number_of_future_showtimes(
#         session=db_transaction,
#         movie_id=movie.id,
#         snapshot_time=past,
#         current_user_id=user.id,
#     )

#     assert total_showtimes_past == 3


# def test_get_movies(
#     *,
#     db_transaction: Session,
#     movie_factory: Callable[..., Movie],
#     showtime_factory: Callable[..., Showtime],
#     user_factory: Callable[..., User],
# ):
#     past = now_amsterdam_naive() - timedelta(minutes=10)
#     tomorrow = now_amsterdam_naive() + timedelta(days=1)
#     far_future = now_amsterdam_naive() + timedelta(days=10)

#     showtimes_1 = [showtime_factory(datetime=past)]
#     showtimes_2 = [showtime_factory(datetime=far_future)]
#     showtimes_3 = []
#     showtimes_4 = [showtime_factory(datetime=tomorrow)]
#     showtimes = showtimes_1 + showtimes_2 + showtimes_3 + showtimes_4

#     # Create movies with different showtimes
#     movie_factory(
#         title="Gone Girl", showtimes=showtimes_1
#     )
#     movie_2 = movie_factory(
#         title="A girl Walks Home Alone At Night",
#         showtimes=showtimes_2
#     )
#     movie_factory(
#         title="Girly Pop",
#         showtimes=showtimes_3
#     )
#     movie_4 = movie_factory(
#         title="Forrest Gump", showtimes=showtimes_4
#     )
#     user = user_factory()

#     user_crud.set_cinema_selections(
#         session=db_transaction,
#         user_id=user.id,
#         cinema_ids=list({showtime.cinema_id for showtime in showtimes}),
#     )

#     # Retrieve all movies
#     movies = movie_crud.get_movies(
#         session=db_transaction,
#         letterboxd_username=user.letterboxd_username,
#         limit=10,
#         offset=0,
#         snapshot_time=now_amsterdam_naive(),
#         query="",
#         watchlist_only=False,
#         current_user_id=user.id,
#     )

#     assert movie_2 in movies
#     assert movie_4 in movies
#     assert len(movies) == 2  # Only movies with future showtimes should be returned
#     assert movies[1] == movie_2  # Ensure the order is correct

#     movies_with_query = movie_crud.get_movies(
#         session=db_transaction,
#         letterboxd_username=user.letterboxd_username,
#         limit=10,
#         offset=0,
#         snapshot_time=now_amsterdam_naive(),
#         query="girl",
#         watchlist_only=False,
#         current_user_id=user.id,
#     )

#     assert movie_2 in movies_with_query
#     assert len(movies_with_query) == 1


def _add_watch_selection(
    *,
    session: Session,
    selection_model: type,
    user: User,
    movie: Movie,
) -> None:
    """Record `movie` in the given Letterboxd selection table for `user`."""
    assert user.letterboxd_username is not None
    session.add(
        selection_model(
            letterboxd_username=user.letterboxd_username,
            letterboxd_slug=movie.letterboxd_slug or f"slug-{movie.id}",
            movie_id=movie.id,
        )
    )
    session.flush()


def test_get_friends_who_watchlisted_movie(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
):
    current_user = user_factory()
    friend = user_factory()
    non_friend = user_factory()
    movie: Movie = movie_factory()
    other_movie: Movie = movie_factory()

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user.id,
        friend_id=friend.id,
    )

    # Friend watchlisted the target movie → should be returned.
    _add_watch_selection(
        session=db_transaction,
        selection_model=WatchlistSelection,
        user=friend,
        movie=movie,
    )
    # Non-friend watchlisted it too → must be excluded.
    _add_watch_selection(
        session=db_transaction,
        selection_model=WatchlistSelection,
        user=non_friend,
        movie=movie,
    )
    # Friend watchlisted a different movie → must not leak into this result.
    _add_watch_selection(
        session=db_transaction,
        selection_model=WatchlistSelection,
        user=friend,
        movie=other_movie,
    )

    friends = movie_crud.get_friends_who_watchlisted_movie(
        session=db_transaction,
        movie_id=movie.id,
        current_user=current_user.id,
    )

    assert [f.id for f in friends] == [friend.id]


def test_get_friends_who_watched_movie(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
):
    current_user = user_factory()
    friend = user_factory()
    non_friend = user_factory()
    movie: Movie = movie_factory()

    friendship_crud.create_friendship(
        session=db_transaction,
        user_id=current_user.id,
        friend_id=friend.id,
    )

    _add_watch_selection(
        session=db_transaction,
        selection_model=WatchedSelection,
        user=friend,
        movie=movie,
    )
    _add_watch_selection(
        session=db_transaction,
        selection_model=WatchedSelection,
        user=non_friend,
        movie=movie,
    )

    friends = movie_crud.get_friends_who_watched_movie(
        session=db_transaction,
        movie_id=movie.id,
        current_user=current_user.id,
    )

    assert [f.id for f in friends] == [friend.id]

    # A movie no friend has watched yields an empty list.
    assert (
        movie_crud.get_friends_who_watched_movie(
            session=db_transaction,
            movie_id=movie_factory().id,
            current_user=current_user.id,
        )
        == []
    )
