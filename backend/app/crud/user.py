from dataclasses import dataclass
from datetime import datetime, time, timedelta
from logging import getLogger
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, Time, case, cast, col, delete, or_, select

from app.core.enums import (
    GoingStatus,
    LoginEmailSource,
    NotificationChannel,
    SocialProvider,
)
from app.core.security import get_password_hash, verify_password
from app.crud import showtime_visibility as showtime_visibility_crud
from app.crud.movie import apply_language_filter
from app.inputs.movie import Filters
from app.models.cinema_selection import CinemaSelection
from app.models.friendship import FriendRequest, Friendship
from app.models.letterboxd import Letterboxd
from app.models.movie import Movie
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.models.showtime_visibility import ShowtimeVisibilityEffective
from app.models.user import User, UserCreate, UserUpdate
from app.models.user_login_email import UserLoginEmail
from app.models.watchlist_selection import WatchlistSelection
from app.utils import now_amsterdam_naive

# The partial unique index on `lower(display_name)` (migration c3f7b1a5d8e2).
# Named here because both `user` uniqueness rules raise the same psycopg
# UniqueViolation, and the caller has to tell a taken username from a taken
# email to report either one honestly.
DISPLAY_NAME_UNIQUE_INDEX = "uq_user_display_name_lower"

# The global unique index on `lower(email)` across every row of
# user_login_email (migration c2d4e6f8a0b1) — the actual guarantee that no
# loginable email (primary, or a linked Google/Apple email) is ever shared by
# two users, or by two sources on the same user.
LOGIN_EMAIL_UNIQUE_INDEX = "uq_user_login_email_lower"

logger = getLogger(__name__)

DAY_BUCKET_CUTOFF = time(4, 0)
DAY_BUCKET_OFFSET = timedelta(
    hours=DAY_BUCKET_CUTOFF.hour,
    minutes=DAY_BUCKET_CUTOFF.minute,
    seconds=DAY_BUCKET_CUTOFF.second,
)


def normalize_letterboxd_username(letterboxd_username: str) -> str:
    return letterboxd_username.strip().lower()


def time_range_clause(
    start_datetime_column,
    end_datetime_column,
    start: time | None,
    end: time | None,
) -> ColumnElement[bool]:
    def _single_time_col_clause(time_col) -> ColumnElement[bool]:
        if start is None and end is None:
            return time_col.is_not(None)
        if start is None:
            end_time = end
            assert end_time is not None
            # Open-ended "-end" ranges start at the configured day-bucket cutoff.
            if end_time >= DAY_BUCKET_CUTOFF:
                return time_col.between(DAY_BUCKET_CUTOFF, end_time)
            return or_(
                time_col >= DAY_BUCKET_CUTOFF,
                time_col <= end_time,
            )
        if end is None:
            start_time = start
            assert start_time is not None
            # Open-ended "start-" ranges are bounded by the day-bucket cutoff (04:00).
            if start_time <= DAY_BUCKET_CUTOFF:
                return time_col.between(start_time, DAY_BUCKET_CUTOFF)
            return or_(
                time_col >= start_time,
                time_col <= DAY_BUCKET_CUTOFF,
            )
        start_time = start
        end_time = end
        assert start_time is not None
        assert end_time is not None
        if start_time <= end_time:
            return time_col.between(start_time, end_time)

        # crosses midnight
        return or_(
            time_col >= start_time,
            time_col <= end_time,
        )

    start_time_col = cast(start_datetime_column, Time)
    start_clause = _single_time_col_clause(start_time_col)

    # When a range has an explicit end, the showtime's end must also fit that window.
    if end is not None:
        end_time_col = cast(
            func.coalesce(end_datetime_column, start_datetime_column), Time
        )
        end_clause = _single_time_col_clause(end_time_col)
        return start_clause & end_clause

    return start_clause


def day_bucket_date_clause(datetime_column):
    # Shift by the configured day-bucket cutoff so post-midnight slots stay on the prior day.
    return func.date(datetime_column - DAY_BUCKET_OFFSET)


def get_user_by_id(*, session: Session, user_id: UUID) -> User | None:
    """
    Get a user by their ID.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user to retrieve.
    Returns:
        User | None: The user object if found, otherwise None.
    """
    return session.get(User, user_id)


def get_users_by_ids(*, session: Session, user_ids: list[UUID]) -> list[User]:
    if not user_ids:
        return []
    stmt = select(User).where(col(User.id).in_(user_ids))
    return list(session.exec(stmt).all())


def get_letterboxd_username(
    *,
    session: Session,
    user_id: UUID,
) -> str | None:
    """
    Get the Letterboxd username for a user.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user.
    Returns:
        str | None: The Letterboxd username if it exists, otherwise None.
    """
    user = get_user_by_id(session=session, user_id=user_id)
    if not user or not user.letterboxd or not user.letterboxd.letterboxd_username:
        return None
    return user.letterboxd.letterboxd_username


def get_user_by_email(*, session: Session, email: str) -> User | None:
    """
    Get a user by their email address.

    Matched case-insensitively. Mailbox providers treat addresses that differ
    only in capitalisation as the same mailbox, and so does everyone typing one
    in: an exact match meant `Bob@x.com` could register a second account
    alongside `bob@x.com`, could not log in as it, and — the reason this
    surfaced — a "Continue with Google" for a provider-lowercased address failed
    to find the password account the same person had already created, and
    silently made them a new, empty one instead.

    Parameters:
        session (Session): The database session.
        email (str): The email address of the user to retrieve.
    Returns:
        User | None: The user object if found, otherwise None.
    """
    statement = select(User).where(func.lower(col(User.email)) == email.strip().lower())
    session_user = session.exec(statement).one_or_none()
    return session_user


def is_display_name_conflict(error: IntegrityError) -> bool:
    """True when an IntegrityError came from the case-insensitive username index.

    The alternative on `user` is the email unique constraint, and reporting one
    as the other tells the user to change the wrong field.
    """
    constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
    return constraint == DISPLAY_NAME_UNIQUE_INDEX


def get_user_by_display_name(*, session: Session, display_name: str) -> User | None:
    normalized_display_name = display_name.strip()
    if not normalized_display_name:
        return None
    statement = select(User).where(
        func.lower(col(User.display_name)) == normalized_display_name.lower()
    )
    session_user = session.exec(statement).one_or_none()
    return session_user


def get_user_by_login_email(*, session: Session, email: str) -> User | None:
    """Resolve any reserved loginable email (primary, Google, or Apple) to its
    owning user, via `user_login_email` rather than `User.email` directly.

    This is what lets someone log in with an email their account no longer
    shows as its primary — e.g. the Google address they originally signed up
    with, after changing their primary email away from it.
    """
    statement = (
        select(User)
        .join(UserLoginEmail, col(UserLoginEmail.user_id) == col(User.id))
        .where(func.lower(col(UserLoginEmail.email)) == email.strip().lower())
    )
    return session.exec(statement).one_or_none()


def is_login_email_conflict(error: IntegrityError) -> bool:
    """True when an IntegrityError came from the global login-email uniqueness
    index, as opposed to `User`'s own `email`/display-name constraints."""
    constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
    return constraint == LOGIN_EMAIL_UNIQUE_INDEX


class LoginEmailConflict(Exception):
    """`email` is already reserved by a different user than the one asking."""

    def __init__(self, email: str):
        self.email = email
        super().__init__(f"{email!r} is already reserved by another account.")


def _reserve_login_email(
    *, session: Session, user_id: UUID, email: str, source: LoginEmailSource
) -> None:
    """Ensure `email` is reserved for `user_id`.

    A no-op if this user already holds it — from *any* source, including a
    previous call for a different purpose, since a value reserved once stays
    reserved to that user permanently and is never replaced. `source` only
    records why this row first came to exist, should a new reservation be
    needed. Raises `LoginEmailConflict` if a different user already holds it;
    the pre-check keeps that the common case, and a `session.flush()` inside a
    SAVEPOINT is the actual, race-safe arbiter (two concurrent requests
    reserving the same never-before-seen address).
    """
    normalized_email = email.strip()
    owner = get_user_by_login_email(session=session, email=normalized_email)
    if owner is not None:
        if owner.id != user_id:
            raise LoginEmailConflict(normalized_email)
        return
    try:
        with session.begin_nested():
            session.add(
                UserLoginEmail(user_id=user_id, source=source, email=normalized_email)
            )
            session.flush()
    except IntegrityError as e:
        if not is_login_email_conflict(e):
            raise
        raise LoginEmailConflict(normalized_email) from e


def sync_primary_login_email(*, session: Session, user_id: UUID, email: str) -> None:
    """Ensure this user's current primary email is reserved. Call in the same
    transaction as the `User.email` write, so a `LoginEmailConflict` here
    rolls back the email change too rather than leaving them out of sync.
    Raises `LoginEmailConflict` if someone else already holds the address."""
    _reserve_login_email(
        session=session, user_id=user_id, email=email, source=LoginEmailSource.PRIMARY
    )


def _try_reserve_social_email(
    *, session: Session, user_id: UUID, provider: SocialProvider, email: str
) -> None:
    """Best-effort reservation of a linked provider's reported email.

    A sub match (or a fresh account/link just proven by a provider token)
    already establishes who this is — a stale or newly colliding email on the
    provider's side (e.g. their Google account now reports an address someone
    else has since reserved) must never fail the sign-in over it.
    """
    try:
        _reserve_login_email(
            session=session,
            user_id=user_id,
            email=email,
            source=LoginEmailSource(provider.value),
        )
    except LoginEmailConflict:
        logger.warning(
            "Skipping %s email reservation for user %s: %r is already reserved "
            "by another account",
            provider.value,
            user_id,
            email,
        )


def _social_sub_column(provider: SocialProvider):
    return User.apple_sub if provider is SocialProvider.APPLE else User.google_sub


def get_user_by_social_sub(
    *, session: Session, provider: SocialProvider, provider_sub: str
) -> User | None:
    statement = select(User).where(_social_sub_column(provider) == provider_sub)
    return session.exec(statement).one_or_none()


def restore_unverified_email_preferences(user: User) -> None:
    """Undo the switch-to-push/digest-off that happened when `user` went
    unverified, now that its (possibly new) email address is confirmed.

    Caller is responsible for `session.add`/`session.commit`.
    """
    for field in user.unverified_email_saved_channels or []:
        setattr(user, field, NotificationChannel.EMAIL)
    if user.unverified_email_saved_digest_enabled:
        user.notify_watchlist_digest_enabled = True
    user.unverified_email_saved_channels = None
    user.unverified_email_saved_digest_enabled = False


@dataclass(frozen=True)
class SocialUserResolution:
    """What resolving a social identity turned out to mean for the account."""

    user: User
    """Whether this sign-in created the account rather than finding it."""
    is_new: bool
    """
    Whether an existing account's password was discarded to link this identity.

    True only for the unverified-account takeover below. The caller passes it on
    so the app can tell the user their password no longer works — silently
    breaking someone's sign-in method and letting them discover it on their next
    password attempt would be its own kind of broken.
    """
    password_removed: bool


def get_or_create_social_user(
    *,
    session: Session,
    provider: SocialProvider,
    provider_sub: str,
    email: str,
) -> SocialUserResolution:
    """
    Get the user for a verified social identity, creating or linking one if needed.

    Parameters:
        session (Session): The database session.
        provider (SocialProvider): Which identity provider issued the token.
        provider_sub (str): The provider's stable subject identifier for the user.
        email (str): The verified email address from the provider's token.
    Returns:
        SocialUserResolution: The user, whether it was created, and whether an
            existing account's password had to be discarded to link it.
    """
    existing = get_user_by_social_sub(
        session=session, provider=provider, provider_sub=provider_sub
    )
    if existing:
        # Opportunistically (re)capture what this provider currently reports as
        # the account's email — the only way an account that predates this
        # table, or whose Google/Apple email has since changed, ever gets a
        # row here. Never lets a collision with someone else's reserved email
        # fail the sign-in: the sub match already proves who this is.
        _try_reserve_social_email(
            session=session, user_id=existing.id, provider=provider, email=email
        )
        return SocialUserResolution(user=existing, is_new=False, password_removed=False)

    # Same email, different provider (or a pre-existing password account) —
    # link this provider to it rather than creating a duplicate account.
    by_email = get_user_by_email(session=session, email=email)
    if by_email:
        if provider is SocialProvider.APPLE:
            by_email.apple_sub = provider_sub
        else:
            by_email.google_sub = provider_sub
        password_removed = False
        if not by_email.email_verified:
            # The provider has just proven this address belongs to whoever is
            # signing in. The account being linked into was created by someone
            # who typed the address and was never asked to prove anything, so
            # any password on it is an unproven claim on a mailbox that now has
            # a proven owner — registering someone else's address ahead of them
            # would otherwise have been a way into their account the moment they
            # signed in with Google. Discard the password; the address is now
            # confirmed, and a legitimate user who simply had not clicked their
            # confirmation link yet can set a new one from Settings or "Forgot
            # password" (both of which reach only this mailbox).
            password_removed = by_email.hashed_password is not None
            by_email.hashed_password = None
            by_email.email_verified = True
            restore_unverified_email_preferences(by_email)
        session.add(by_email)
        session.flush()
        # Belt-and-suspenders: the PRIMARY row should already exist (backfill
        # or an earlier write), this just guarantees it. The provider row
        # reserves the linked identity's own email under its own source.
        sync_primary_login_email(
            session=session, user_id=by_email.id, email=by_email.email
        )
        _try_reserve_social_email(
            session=session, user_id=by_email.id, provider=provider, email=email
        )
        return SocialUserResolution(
            user=by_email, is_new=False, password_removed=password_removed
        )

    # display_name is left unset so this always routes through the
    # pick-username screen — display_name doubles as the public username and
    # has no DB-level unique constraint, so a provider-supplied name (e.g.
    # "Jan de Vries") could otherwise silently collide with an existing user.
    db_obj = User(
        email=email,
        display_name=None,
        hashed_password=None,
        # The caller only reaches here with a provider-signed token carrying
        # `email_verified` (see `_claims_from_payload`), which is a stronger
        # proof than our own confirmation link asks for.
        email_verified=True,
        apple_sub=provider_sub if provider is SocialProvider.APPLE else None,
        google_sub=provider_sub if provider is SocialProvider.GOOGLE else None,
    )
    session.add(db_obj)
    session.flush()  # Check for unique constraints (email, apple_sub, google_sub)
    sync_primary_login_email(session=session, user_id=db_obj.id, email=db_obj.email)
    _try_reserve_social_email(
        session=session, user_id=db_obj.id, provider=provider, email=email
    )
    return SocialUserResolution(user=db_obj, is_new=True, password_removed=False)


def create_user(
    *,
    session: Session,
    user_create: UserCreate,
) -> User:
    """
    Create a new user in the database.
    Parameters:
        session (Session): The database session.
        user_create (UserCreate): The user creation data.
    Returns:
        User: The created user object.
    Raises:
        IntegrityError: If a user with the same email already exists.
        LoginEmailConflict: If the email is already reserved by a different
            user via user_login_email (e.g. it's someone else's linked
            Google/Apple email, even though it's nobody's current primary).
    """
    db_obj = User.model_validate(
        user_create, update={"hashed_password": get_password_hash(user_create.password)}
    )
    session.add(db_obj)
    session.flush()  # Check for unique constraints
    # Reserve the email as this user's PRIMARY login identifier — without this,
    # a freshly-created account's email would be unreachable by
    # get_user_by_login_email, and it could never log in.
    sync_primary_login_email(session=session, user_id=db_obj.id, email=db_obj.email)
    return db_obj


def create_letterboxd(
    *,
    session: Session,
    letterboxd_username: str,
    last_watchlist_sync: datetime | None = None,
):
    """
    Create a Letterboxd entry for a user.

    Parameters:
        session (Session): The database session.
        letterboxd_username (str): The Letterboxd username.
        last_watchlist_sync (datetime | None): The last time the watchlist was synced.
    Returns:
        User: The user object with the Letterboxd entry created.
    Raises:
        IntegrityError: If a Letterboxd entry with the same username already exists.
    """

    normalized_letterboxd_username = normalize_letterboxd_username(letterboxd_username)

    letterboxd = Letterboxd(
        letterboxd_username=normalized_letterboxd_username,
        last_watchlist_sync=last_watchlist_sync,
    )
    session.add(letterboxd)
    session.flush()  # Check for unique constraints
    return letterboxd


def update_user(
    *,
    session: Session,
    db_user: User,
    user_in: UserUpdate,
) -> User:
    """
    Update an existing user in the database.
    Parameters:
        db_user (User): The user object to update.
        user_in (UserUpdate): The user update data.
    Returns:
        User: The updated user object.
    Raises:
        IntegrityError: If a user with the same email already exists.
    """
    user_data = user_in.model_dump(exclude_unset=True)
    if "letterboxd_username" in user_data:
        letterboxd_username = user_data["letterboxd_username"]
        if letterboxd_username:
            normalized_letterboxd_username = normalize_letterboxd_username(
                letterboxd_username
            )
            letterboxd = session.get(Letterboxd, normalized_letterboxd_username)
            if not letterboxd:
                letterboxd = create_letterboxd(
                    session=session,
                    letterboxd_username=normalized_letterboxd_username,
                )
            db_user.letterboxd = letterboxd
            user_data["letterboxd_username"] = normalized_letterboxd_username
        else:
            user_data["letterboxd_username"] = None
            db_user.letterboxd = None
    extra_data = {}
    if "password" in user_data:
        password = user_data["password"]
        hashed_password = get_password_hash(password)
        extra_data["hashed_password"] = hashed_password
    db_user.sqlmodel_update(user_data, update=extra_data)
    session.flush()  # Check for unique constraints
    return db_user


def set_report_ban(
    *,
    db_user: User,
    banned: bool,
    duration_days: int | None,
) -> User:
    """Ban/unban a user from reporting showtimes. `duration_days=None` while
    banning means indefinite; unbanning always clears both fields."""
    db_user.report_banned = banned
    if not banned:
        db_user.report_ban_expires_at = None
    elif duration_days is not None:
        db_user.report_ban_expires_at = now_amsterdam_naive() + timedelta(
            days=duration_days
        )
    else:
        db_user.report_ban_expires_at = None
    return db_user


def authenticate(*, session: Session, identifier: str, password: str) -> User | None:
    """
    Authenticate a user by password, resolving them from either an email or a
    username.

    Usernames are validated to `^[A-Za-z0-9_]+$` (see app.validators.username)
    and so can never contain "@" — an email always does — which makes the
    branch below unambiguous without needing to try both lookups. "Email"
    here means any reserved login email (current primary, or a linked
    Google/Apple email), not just the account's current primary.

    Parameters:
        session (Session): The database session.
        identifier (str): Whatever the client's "email or username" field
            held — an email address or a username.
        password (str): The password of the user.
    Returns:
        User | None: The authenticated user object if credentials are valid, otherwise None.
    """
    normalized_identifier = identifier.strip()
    if "@" in normalized_identifier:
        db_user = get_user_by_login_email(session=session, email=normalized_identifier)
    else:
        db_user = get_user_by_display_name(
            session=session, display_name=normalized_identifier
        )
    if not db_user:
        return None
    if db_user.hashed_password is None:
        # Social-only account (e.g. signed up via Apple/Google) — has no
        # password to check against.
        return None
    if not verify_password(password, db_user.hashed_password):
        return None
    return db_user


def get_users(
    *,
    session: Session,
    query: str,
    limit: int,
    offset: int,
    current_user_id: UUID,
) -> list[User]:
    """
    Get a list of users based on a search query, excluding the current user.

    Parameters:
        session (Session): The database session.
        query (str): The search query for user display names.
        limit (int): The maximum number of users to return.
        offset (int): The offset for pagination.
        current_user_id (UUID): The ID of the current user to exclude from results.
    Returns:
        list[User]: A list of User objects matching the search criteria.
    """
    stmt = select(User).where(col(User.display_name).isnot(None))
    if query:
        stmt = stmt.where(col(User.display_name).ilike(f"%{query}%"))
    stmt = stmt.where(col(User.id) != current_user_id).limit(limit).offset(offset)

    users: list[User] = list(session.exec(stmt).all())
    return users


def get_friends(*, session: Session, user_id: UUID) -> list[User]:
    """
    Get a list of friends for a user.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose friends are to be retrieved.
    Returns:
        list[User]: A list of User objects representing the user's friends.
    """
    stmt = (
        select(User)
        .join(
            Friendship,
            col(Friendship.friend_id) == User.id,
        )
        .where(Friendship.user_id == user_id)
    )
    friends: list[User] = list(session.exec(stmt).all())
    return friends


def _build_selected_showtimes_query(
    *,
    user_id: UUID,
    viewer_id: UUID | None,
    filters: Filters,
    letterboxd_username: str | None,
) -> tuple[Any, bool]:
    """
    Shared filter-application logic for get_selected_showtimes and
    count_selected_showtimes. Every filter dimension must be applied here
    exactly once so the two entry points can never drift out of sync.
    """
    stmt = (
        select(Showtime)
        .join(
            ShowtimeSelection,
            col(Showtime.id) == ShowtimeSelection.showtime_id,
        )
        .where(
            ShowtimeSelection.user_id == user_id,
            Showtime.datetime >= filters.snapshot_time,
        )
    )

    if viewer_id is not None and viewer_id != user_id:
        stmt = stmt.join(
            ShowtimeVisibilityEffective,
            (col(ShowtimeVisibilityEffective.owner_id) == user_id)
            & (col(ShowtimeVisibilityEffective.showtime_id) == col(Showtime.id))
            & (col(ShowtimeVisibilityEffective.viewer_id) == viewer_id),
        )

    if filters.selected_statuses is not None and len(filters.selected_statuses) > 0:
        stmt = stmt.where(
            col(ShowtimeSelection.going_status).in_(filters.selected_statuses)
        )

    if filters.selected_cinema_ids is not None and len(filters.selected_cinema_ids) > 0:
        stmt = stmt.where(col(Showtime.cinema_id).in_(filters.selected_cinema_ids))

    if filters.days is not None and len(filters.days) > 0:
        stmt = stmt.where(
            day_bucket_date_clause(col(Showtime.datetime)).in_(filters.days)
        )

    if filters.time_ranges is not None and len(filters.time_ranges) > 0:
        stmt = stmt.where(
            or_(
                *[
                    time_range_clause(
                        col(Showtime.datetime),
                        col(Showtime.end_datetime),
                        tr.start,
                        tr.end,
                    )
                    for tr in filters.time_ranges
                ]
            )
        )

    has_languages_filter = (
        filters.selected_languages is not None and len(filters.selected_languages) > 0
    )

    if (
        filters.query
        or filters.watchlist_only
        or filters.runtime_min is not None
        or filters.runtime_max is not None
        or has_languages_filter
    ):
        stmt = stmt.join(Movie, col(Movie.id) == col(Showtime.movie_id))

    if filters.query:
        pattern = f"%{filters.query}%"
        stmt = stmt.where(
            col(Movie.title).ilike(pattern) | col(Movie.original_title).ilike(pattern)
        )

    if filters.runtime_min is not None:
        stmt = stmt.where(col(Movie.duration) >= filters.runtime_min)

    if filters.runtime_max is not None:
        stmt = stmt.where(col(Movie.duration) <= filters.runtime_max)

    if has_languages_filter:
        stmt = apply_language_filter(stmt, filters=filters)

    if filters.watchlist_only:
        if letterboxd_username is None:
            return stmt, True
        stmt = stmt.join(
            WatchlistSelection,
            col(WatchlistSelection.movie_id) == col(Showtime.movie_id),
        ).where(col(WatchlistSelection.letterboxd_username) == letterboxd_username)

    return stmt, False


def get_selected_showtimes(
    *,
    session: Session,
    user_id: UUID,
    viewer_id: UUID | None,
    limit: int,
    offset: int,
    filters: Filters,
    letterboxd_username: str | None = None,
) -> list[Showtime]:
    """
    Get a list of showtimes that a user has selected.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose selected showtimes are to be retrieved.
    Returns:
        list[Showtime]: A list of Showtime objects that the user has selected.
    """
    stmt, force_empty = _build_selected_showtimes_query(
        user_id=user_id,
        viewer_id=viewer_id,
        filters=filters,
        letterboxd_username=letterboxd_username,
    )
    if force_empty:
        return []

    stmt = stmt.order_by(col(Showtime.datetime)).limit(limit).offset(offset)
    showtimes = list(session.exec(stmt).all())
    return showtimes


def count_selected_showtimes(
    *,
    session: Session,
    user_id: UUID,
    viewer_id: UUID | None,
    filters: Filters,
    letterboxd_username: str | None = None,
) -> int:
    stmt, force_empty = _build_selected_showtimes_query(
        user_id=user_id,
        viewer_id=viewer_id,
        filters=filters,
        letterboxd_username=letterboxd_username,
    )
    if force_empty:
        return 0

    count_stmt = select(func.count()).select_from(stmt.subquery())
    return session.execute(count_stmt).scalar_one()


def get_sent_friend_requests(*, session: Session, user_id: UUID) -> list[User]:
    """
    Get a list of users to whom the specified user has sent friend requests.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose sent friend requests are to be retrieved.
    Returns:
        list[User]: A list of User objects representing the users who received friend requests from the specified user.
    """
    stmt = (
        select(User)
        .join(
            FriendRequest,
            col(FriendRequest.receiver_id) == col(User.id),
        )
        .where(FriendRequest.sender_id == user_id)
    )
    users: list[User] = list(session.exec(stmt).all())
    return users


def get_received_friend_requests(*, session: Session, user_id: UUID) -> list[User]:
    """
    Get a list of users who have sent friend requests to the specified user.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose received friend requests are to be retrieved.
    Returns:
        list[User]: A list of User objects representing the users who sent friend requests to the specified user.
    """
    stmt = (
        select(User)
        .join(
            FriendRequest,
            col(FriendRequest.sender_id) == col(User.id),
        )
        .where(FriendRequest.receiver_id == user_id)
    )
    users: list[User] = list(session.exec(stmt).all())
    return users


def add_showtime_selection(
    *,
    session: Session,
    user_id: UUID,
    showtime_id: int,
) -> Showtime:
    """
    Add a selection for a showtime by a user.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user making the selection.
        showtime_id (int): The ID of the showtime to select.
    Returns:
        Showtime: The showtime object if the selection was added successfully.
    Raises:
        IntegrityError: If the selection already exists for the user and showtime
        or the showtime/user doesnt exist.
    """
    selection = ShowtimeSelection(user_id=user_id, showtime_id=showtime_id)
    session.add(selection)
    session.flush()
    showtime_visibility_crud.rebuild_effective_visibility_for_showtime(
        session=session,
        owner_id=user_id,
        showtime_id=showtime_id,
    )

    stmt = select(Showtime).where(Showtime.id == showtime_id)
    showtime = session.exec(stmt).one()

    return showtime


def delete_showtime_selection(
    *,
    session: Session,
    user_id: UUID,
    showtime_id: int,
) -> Showtime:
    """
    Delete a user's selection for a specific showtime.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose selection is to be deleted.
        showtime_id (int): The ID of the showtime to delete the selection for.
    Returns:
        Showtime: The showtime object if the selection was deleted successfully.
    Raises:
        NoResultsFound: If the selection does not exist for the user and showtime.
        MultipleResultsFound: If multiple selections exist (should not happen in a well-formed database).
    """
    showtime_selection = session.exec(
        select(ShowtimeSelection).where(
            ShowtimeSelection.user_id == user_id,
            ShowtimeSelection.showtime_id == showtime_id,
        )
    ).one()
    showtime = session.exec(
        select(Showtime).where(Showtime.id == showtime_selection.showtime_id)
    ).one()

    session.delete(showtime_selection)
    session.flush()
    showtime_visibility_crud.rebuild_effective_visibility_for_showtime(
        session=session,
        owner_id=user_id,
        showtime_id=showtime_id,
    )
    return showtime


def get_showtime_going_status(
    *, session: Session, showtime_id: int, user_id: UUID
) -> GoingStatus:
    """
    Check if a user has selected a specific showtime.

    Parameters:
        session (Session): The database session.
        showtime_id (int): The ID of the showtime to check.
        user_id (UUID): The ID of the user to check.
    Returns:
        bool: True if the user has selected the showtime, otherwise False.
    """
    stmt = select(ShowtimeSelection).where(
        ShowtimeSelection.showtime_id == showtime_id,
        ShowtimeSelection.user_id == user_id,
    )
    selection = session.exec(stmt).one_or_none()
    return selection.going_status if selection else GoingStatus.NOT_GOING


def is_user_going_to_movie(
    *,
    session: Session,
    movie_id: int,
    user_id: UUID,
    snapshot_time: datetime,
) -> GoingStatus:
    """
    Check if a user is going to a movie by checking their future showtime selections.

    Parameters:
        session (Session): The database session.
        movie_id (int): The ID of the movie to check.
        user_id (UUID): The ID of the user to check.
        snapshot_time (datetime): The time to consider for the showtime selections.
    """
    stmt = (
        select(ShowtimeSelection)
        .join(Showtime, col(ShowtimeSelection.showtime_id) == col(Showtime.id))
        .where(
            col(ShowtimeSelection.user_id) == user_id,
            col(Showtime.movie_id) == movie_id,
            col(Showtime.datetime) >= snapshot_time,
        )
        .order_by(
            case(
                (ShowtimeSelection.going_status == GoingStatus.GOING, 0),
                (ShowtimeSelection.going_status == GoingStatus.INTERESTED, 1),
            )
        )
        .limit(1)
    )
    result = session.exec(stmt).one_or_none()

    if result is None:
        return GoingStatus.NOT_GOING

    return result.going_status


def get_selected_cinemas_ids(
    *,
    session: Session,
    user_id: UUID,
) -> list[int]:
    """
    Get a list of cinema IDs that a user has selected.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose selected cinemas are to be retrieved.
        limit (int): The maximum number of cinema IDs to return.
        offset (int): The offset for pagination.
    Returns:
        list[int]: A list of cinema IDs that the user has selected.
    """
    stmt = select(CinemaSelection.cinema_id).where(CinemaSelection.user_id == user_id)
    cinema_ids = list(session.exec(stmt).all())
    return cinema_ids


def set_cinema_selections(
    *,
    session: Session,
    user_id: UUID,
    cinema_ids: list[int],
) -> None:
    """
    Set the cinema selections for a user.

    Parameters:
        session (Session): The database session.
        user_id (UUID): The ID of the user whose cinema selections are to be set.
        cinema_ids (list[int]): A list of cinema IDs to select.
    Raises:
        IntegrityError: If there is a database integrity error, such as an invalid cinema_id.
    """
    # Clear existing selections
    stmt = delete(CinemaSelection).where(col(CinemaSelection.user_id) == user_id)
    session.execute(stmt)

    session.add_all(
        CinemaSelection(user_id=user_id, cinema_id=cinema_id)
        for cinema_id in cinema_ids
    )

    session.flush()
