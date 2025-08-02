from collections.abc import Callable
from datetime import timedelta
from uuid import uuid4

import pytest
from psycopg.errors import ForeignKeyViolation, UniqueViolation
from sqlalchemy.exc import IntegrityError, NoResultFound
from sqlmodel import Session

from app.core.security import verify_password
from app.crud import friendship as friendship_crud
from app.crud import user as user_crud
from app.models.movie import Movie
from app.models.showtime import Showtime
from app.models.user import User, UserCreate, UserUpdate
from app.utils import now_amsterdam_naive


def test_get_user_by_id_success(
    *, db_transaction: Session, user_factory: Callable[..., User]
):
    user = user_factory()

    user_from_db = user_crud.get_user_by_id(session=db_transaction, user_id=user.id)

    assert user_from_db is not None
    assert user_from_db is user


def test_get_user_by_id_not_found(*, db_transaction: Session):
    user_from_db = user_crud.get_user_by_id(session=db_transaction, user_id=uuid4())

    assert user_from_db is None


def test_create_user_success(
    *, db_transaction: Session, user_create_factory: Callable[..., UserCreate]
):
    user_create = user_create_factory()

    user = user_crud.create_user(session=db_transaction, user_create=user_create)

    assert user.id is not None
    assert user.email == user_create.email
    assert verify_password(user_create.password, user.hashed_password)
    assert user.is_active is user_create.is_active
    assert user.is_superuser is user_create.is_superuser


def test_create_user_duplicate_email(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    user_create_factory: Callable[..., UserCreate],
):
    user = user_factory()

    user_create = user_create_factory(email=user.email)

    # Attempt to create a second user with the same email
    with pytest.raises(IntegrityError) as exc_info:
        user_crud.create_user(session=db_transaction, user_create=user_create)

    # Check that the error is a UniqueViolation
    assert isinstance(exc_info.value.orig, UniqueViolation)


def test_update_user_success(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user = user_factory()

    original_hashed_password = user.hashed_password
    original_email = user.email
    original_display_name = user.display_name
    original_letterboxd_username = user.letterboxd_username

    user_update = UserUpdate(
        email="new-email@example.com",
        password="new-password",
        display_name="New Display Name",
    )
    assert user_update.password is not None

    updated_user = user_crud.update_user(
        session=db_transaction, db_user=user, user_in=user_update
    )

    assert updated_user is user

    assert updated_user.email == user_update.email
    assert verify_password(user_update.password, updated_user.hashed_password)
    assert updated_user.display_name == user_update.display_name
    assert updated_user.letterboxd_username == original_letterboxd_username

    # Assert it has changed from the original fields
    assert updated_user.email != original_email
    assert not verify_password(original_hashed_password, updated_user.hashed_password)
    assert updated_user.display_name != original_display_name


def test_update_user_duplicate_email(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
):
    user_1 = user_factory()
    user_2 = user_factory()

    user_update = UserUpdate(
        email=user_1.email,
    )

    # Attempt to update user_2 with the email of user_1
    with pytest.raises(IntegrityError) as exc_info:
        user_crud.update_user(
            session=db_transaction, db_user=user_2, user_in=user_update
        )

    # Check that the error is a UniqueViolation
    assert isinstance(exc_info.value.orig, UniqueViolation)


def test_get_user_by_email_success(
    *, db_transaction: Session, user_factory: Callable[..., User]
):
    user = user_factory()

    user_from_db = user_crud.get_user_by_email(session=db_transaction, email=user.email)

    assert user_from_db is not None
    assert user_from_db is user


def test_get_user_by_email_not_found(*, db_transaction: Session):
    user_from_db = user_crud.get_user_by_email(
        session=db_transaction, email="non-existant-email@example.com"
    )

    assert user_from_db is None


def test_authenticate_success(
    *, db_transaction: Session, user_factory: Callable[..., User]
):
    password = "my-secret-password"
    user = user_factory(password=password)

    authenticated_user = user_crud.authenticate(
        session=db_transaction, email=user.email, password=password
    )

    assert authenticated_user is not None
    assert authenticated_user is user


def test_authenticate_email_doesnt_exist(*, db_transaction: Session):
    authenticated_user = user_crud.authenticate(
        session=db_transaction,
        email="non-existant-email@example.com",
        password="password",
    )

    assert authenticated_user is None


def test_authenticate_incorrect_password(
    *, db_transaction: Session, user_factory: Callable[..., User]
):
    password = "my-secret-password"
    user = user_factory(password=password)

    authenticated_user = user_crud.authenticate(
        session=db_transaction, email=user.email, password="wrong-password"
    )

    assert authenticated_user is None


def test_get_users_limit_offset(
    *, db_transaction: Session, user_factory: Callable[..., User]
):
    # Create 5 users
    for _ in range(5):
        user_factory()

    users = user_crud.get_users(
        session=db_transaction, query="", limit=3, offset=0, current_user_id=uuid4()
    )
    user_contd = user_crud.get_users(
        session=db_transaction, query="", limit=3, offset=3, current_user_id=uuid4()
    )

    assert len(users) == 3
    assert len(user_contd) == 2


def test_get_users_not_current_user(
    *, db_transaction: Session, user_factory: Callable[..., User]
):
    # Create 3 users
    user_1 = user_factory()
    user_factory()
    user_factory()

    users = user_crud.get_users(
        session=db_transaction, query="", limit=10, offset=0, current_user_id=user_1.id
    )

    assert user_1 not in users
    assert len(users) == 2


def test_get_users_query(*, db_transaction: Session, user_factory: Callable[..., User]):
    # Create users with different display names
    user_1 = user_factory(display_name="Alice Wonderland")
    user_2 = user_factory(display_name="aLicia Keys")
    user_factory(display_name="Bob Builder")
    user_factory(display_name="Charlie Brown")

    users = user_crud.get_users(
        session=db_transaction, query="lic", limit=10, offset=0, current_user_id=uuid4()
    )

    assert user_1 in users
    assert user_2 in users
    assert len(users) == 2


def test_get_friends(*, db_transaction: Session, user_factory: Callable[..., User]):
    user_1 = user_factory()
    user_2 = user_factory()
    user_3 = user_factory()
    user_4 = user_factory()

    # Create friendships
    friendship_crud.create_friendship(
        session=db_transaction, user_id=user_1.id, friend_id=user_2.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=user_4.id, friend_id=user_1.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=user_2.id, friend_id=user_3.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=user_3.id, friend_id=user_4.id
    )

    friends = user_crud.get_friends(session=db_transaction, user_id=user_1.id)

    assert user_2 in friends
    assert user_4 in friends
    assert len(friends) == 2


def test_add_showtime_selection_success(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    user = user_factory()
    showtime = showtime_factory()

    before_selection = user_crud.has_user_selected_showtime(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime.id,
    )

    assert before_selection is False

    selected_showtime = user_crud.add_showtime_selection(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime.id,
    )

    is_selected = user_crud.has_user_selected_showtime(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime.id,
    )

    assert is_selected is True
    assert selected_showtime is showtime
    assert selected_showtime is not None

    db_transaction.flush()  # ensure that there were no database violations


def test_add_showtime_selection_invalid_showtime(
    *, db_transaction: Session, user_factory: Callable[..., User]
):
    user = user_factory()

    with pytest.raises(IntegrityError) as exc_info:
        user_crud.add_showtime_selection(
            session=db_transaction,
            user_id=user.id,
            showtime_id=9999,
        )

    assert isinstance(exc_info.value.orig, ForeignKeyViolation)


def test_add_showtime_selection_invalid_user(
    *, db_transaction: Session, showtime_factory: Callable[..., Showtime]
):
    showtime = showtime_factory()

    with pytest.raises(IntegrityError) as exc_info:
        user_crud.add_showtime_selection(
            session=db_transaction,
            user_id=uuid4(),
            showtime_id=showtime.id,
        )

    assert isinstance(exc_info.value.orig, ForeignKeyViolation)


def test_add_duplicate_showtime_selection(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    user = user_factory()
    showtime = showtime_factory()

    # Add selection first
    user_crud.add_showtime_selection(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime.id,
    )

    with pytest.raises(IntegrityError) as exc_info:
        user_crud.add_showtime_selection(
            session=db_transaction,
            user_id=user.id,
            showtime_id=showtime.id,
        )

    assert isinstance(exc_info.value.orig, UniqueViolation)


def test_has_selected_showtime_invalid_user(
    *, db_transaction: Session, showtime_factory: Callable[..., Showtime]
):
    showtime = showtime_factory()

    is_selected = user_crud.has_user_selected_showtime(
        session=db_transaction,
        user_id=uuid4(),
        showtime_id=showtime.id,
    )

    assert is_selected is False


def test_has_selected_showtime_invalid_showtime(
    *, db_transaction: Session, user_factory: Callable[..., User]
):
    user = user_factory()

    is_selected = user_crud.has_user_selected_showtime(
        session=db_transaction,
        user_id=user.id,
        showtime_id=9999,
    )

    assert is_selected is False


def test_delete_showtime_selection_success(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    user = user_factory()
    showtime = showtime_factory()

    # Add selection first
    selected_showtime = user_crud.add_showtime_selection(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime.id,
    )

    before_deletion = user_crud.has_user_selected_showtime(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime.id,
    )

    assert before_deletion is True

    # Now delete the selection
    deleted = user_crud.delete_showtime_selection(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime.id,
    )

    assert deleted is selected_showtime

    after_deletion = user_crud.has_user_selected_showtime(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime.id,
    )

    assert after_deletion is False


def test_delete_showtime_selection_doesnt_exist(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    user = user_factory()
    showtime = showtime_factory()

    with pytest.raises(NoResultFound):
        user_crud.delete_showtime_selection(
            session=db_transaction,
            user_id=user.id,
            showtime_id=showtime.id,
        )


def test_delete_showtime_selection_invalid_user(
    *, db_transaction: Session, showtime_factory: Callable[..., Showtime]
):
    showtime = showtime_factory()

    with pytest.raises(NoResultFound):
        user_crud.delete_showtime_selection(
            session=db_transaction,
            user_id=uuid4(),
            showtime_id=showtime.id,
        )


def test_delete_showtime_selection_invalid_showtime(
    *, db_transaction: Session, user_factory: Callable[..., User]
):
    user = user_factory()

    with pytest.raises(NoResultFound):
        user_crud.delete_showtime_selection(
            session=db_transaction,
            user_id=user.id,
            showtime_id=9999,
        )


def test_get_selected_showtimes(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    snapshot_time = now_amsterdam_naive()
    past = now_amsterdam_naive() - timedelta(minutes=10)
    user = user_factory()
    showtime_1 = showtime_factory()
    showtime_2 = showtime_factory()
    showtime_3 = showtime_factory(datetime=past)
    showtime_factory()

    user_crud.add_showtime_selection(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime_1.id,
    )
    user_crud.add_showtime_selection(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime_2.id,
    )
    user_crud.add_showtime_selection(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime_3.id,
    )

    selected_showtimes = user_crud.get_selected_showtimes(
        session=db_transaction,
        user_id=user.id,
        snapshot_time=snapshot_time,
        limit=10,
        offset=0,
    )

    assert showtime_1 in selected_showtimes
    assert showtime_2 in selected_showtimes
    assert len(selected_showtimes) == 2


def test_is_user_going_to_movie(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    movie_factory: Callable[..., Movie],
    showtime_factory: Callable[..., Showtime],
):
    user = user_factory()
    movie = movie_factory()

    past = now_amsterdam_naive() - timedelta(minutes=10)
    future = now_amsterdam_naive() + timedelta(minutes=10)
    more_future = now_amsterdam_naive() + timedelta(minutes=20)

    showtime_1 = showtime_factory()
    showtime_2 = showtime_factory(movie=movie, datetime=past)
    showtime_3 = showtime_factory(movie=movie, datetime=future)

    user_crud.add_showtime_selection(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime_1.id,
    )

    is_going = user_crud.is_user_going_to_movie(
        session=db_transaction,
        user_id=user.id,
        movie_id=movie.id,
    )

    assert is_going is False

    user_crud.add_showtime_selection(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime_2.id,
    )

    is_going = user_crud.is_user_going_to_movie(
        session=db_transaction,
        user_id=user.id,
        movie_id=movie.id,
    )

    assert is_going is False

    user_crud.add_showtime_selection(
        session=db_transaction,
        user_id=user.id,
        showtime_id=showtime_3.id,
    )
    is_going = user_crud.is_user_going_to_movie(
        session=db_transaction,
        user_id=user.id,
        movie_id=movie.id,
    )

    assert is_going is True

    is_going_future = user_crud.is_user_going_to_movie(
        session=db_transaction,
        user_id=user.id,
        movie_id=movie.id,
        snapshot_time=more_future,
    )

    assert is_going_future is False


def test_get_sent_and_received_friend_requests(
    *, db_transaction: Session, user_factory: Callable[..., User]
):
    user_1 = user_factory()
    user_2 = user_factory()
    user_3 = user_factory()

    friendship_crud.create_friend_request(
        session=db_transaction, sender_id=user_1.id, receiver_id=user_2.id
    )
    friendship_crud.create_friend_request(
        session=db_transaction, sender_id=user_3.id, receiver_id=user_1.id
    )

    sent_requests = user_crud.get_sent_friend_requests(
        session=db_transaction, user_id=user_1.id
    )

    assert user_2 in sent_requests
    assert len(sent_requests) == 1

    received_requests = user_crud.get_received_friend_requests(
        session=db_transaction, user_id=user_1.id
    )

    assert user_3 in received_requests
    assert len(received_requests) == 1
