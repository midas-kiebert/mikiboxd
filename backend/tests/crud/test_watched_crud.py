"""Watched-selection CRUD, focused on relinking rows to the movie catalog."""

from sqlmodel import Session

from app.crud import watched as watched_crud


def _selection(session: Session, *, username: str, slug: str):
    return watched_crud.add_watched_selection(
        session=session,
        letterboxd_username=username,
        letterboxd_slug=slug,
    )


def test_relink_attaches_movie_ids_to_previously_unlinked_rows(
    db_transaction: Session,
    user_factory,
    movie_factory,
):
    # A row written before its film reached our catalog: the film exists now.
    user = user_factory()
    username = user.letterboxd_username
    _selection(db_transaction, username=username, slug="heat")
    movie = movie_factory(letterboxd_slug="heat")
    db_transaction.flush()

    linked = watched_crud.relink_watched_selections_to_catalog(
        session=db_transaction, letterboxd_username=username
    )

    assert linked == 1
    assert watched_crud.get_watched(
        session=db_transaction, letterboxd_username=username
    ) == [movie]


def test_relink_leaves_rows_without_a_catalog_match_alone(
    db_transaction: Session,
    user_factory,
):
    # The common case: the film has simply never played in one of our cinemas.
    user = user_factory()
    username = user.letterboxd_username
    _selection(db_transaction, username=username, slug="a-film-we-never-screened")
    db_transaction.flush()

    linked = watched_crud.relink_watched_selections_to_catalog(
        session=db_transaction, letterboxd_username=username
    )

    assert linked == 0
    assert (
        watched_crud.get_watched(session=db_transaction, letterboxd_username=username)
        == []
    )


def test_relink_only_touches_the_requested_user(
    db_transaction: Session,
    user_factory,
    movie_factory,
):
    user = user_factory()
    other_user = user_factory()
    movie_factory(letterboxd_slug="heat")
    _selection(db_transaction, username=user.letterboxd_username, slug="heat")
    _selection(db_transaction, username=other_user.letterboxd_username, slug="heat")
    db_transaction.flush()

    linked = watched_crud.relink_watched_selections_to_catalog(
        session=db_transaction, letterboxd_username=user.letterboxd_username
    )

    assert linked == 1
    assert (
        watched_crud.get_watched(
            session=db_transaction, letterboxd_username=other_user.letterboxd_username
        )
        == []
    )


def test_count_watched_selections_zero_when_none(
    db_transaction: Session,
    user_factory,
):
    user = user_factory()
    username = user.letterboxd_username

    count = watched_crud.count_watched_selections(
        session=db_transaction, letterboxd_username=username
    )

    assert count == 0


def test_count_watched_selections_counts_all_selections(
    db_transaction: Session,
    user_factory,
):
    user = user_factory()
    username = user.letterboxd_username
    _selection(db_transaction, username=username, slug="heat")
    _selection(db_transaction, username=username, slug="the-conversation")
    db_transaction.flush()

    count = watched_crud.count_watched_selections(
        session=db_transaction, letterboxd_username=username
    )

    assert count == 2


def test_count_watched_selections_only_counts_requested_user(
    db_transaction: Session,
    user_factory,
):
    user = user_factory()
    other_user = user_factory()
    _selection(db_transaction, username=other_user.letterboxd_username, slug="heat")
    db_transaction.flush()

    count = watched_crud.count_watched_selections(
        session=db_transaction, letterboxd_username=user.letterboxd_username
    )

    assert count == 0


def test_relink_is_idempotent(
    db_transaction: Session,
    user_factory,
    movie_factory,
):
    user = user_factory()
    username = user.letterboxd_username
    movie_factory(letterboxd_slug="heat")
    _selection(db_transaction, username=username, slug="heat")
    db_transaction.flush()

    first = watched_crud.relink_watched_selections_to_catalog(
        session=db_transaction, letterboxd_username=username
    )
    second = watched_crud.relink_watched_selections_to_catalog(
        session=db_transaction, letterboxd_username=username
    )

    assert first == 1
    assert second == 0
