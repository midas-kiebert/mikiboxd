from datetime import datetime, timedelta
from logging import getLogger
from typing import Any
from uuid import UUID

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.converters import user as user_converters
from app.core.enums import NotificationChannel, NotificationType, ShowtimePingSort
from app.core.security import verify_password
from app.crud import cinema as cinemas_crud
from app.crud import cinema_preset as cinema_presets_crud
from app.crud import friendship as friendship_crud
from app.crud import notification as notification_crud
from app.crud import push_token as push_tokens_crud
from app.crud import saved_preset as saved_presets_crud
from app.crud import showtime as showtimes_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.crud import showtime_visibility as showtime_visibility_crud
from app.crud import user as users_crud
from app.exceptions.base import AppError
from app.exceptions.cinema_preset_exceptions import (
    CinemaPresetNameRequired,
    CinemaPresetNameTaken,
    CinemaPresetNotFound,
)
from app.exceptions.user_exceptions import (
    DisplayNameAlreadyExists,
    EmailAlreadyExists,
    EmailNotVerified,
    EmailRequired,
    IncorrectPassword,
    InvalidUsername,
    PasswordNotSet,
    UsernameRequired,
)
from app.models.cinema_preset import (
    DEFAULT_CINEMA_PRESET_ID,
    DEFAULT_CINEMA_PRESET_NAME,
    FAVORITE_CINEMA_PRESET_NAME,
    CinemaPreset,
)
from app.models.push_token import PushToken
from app.models.saved_preset import SavedPreset
from app.models.showtime import Showtime
from app.models.user import User, UserUpdate
from app.schemas.cinema_preset import CinemaPresetCreate, CinemaPresetPublic
from app.schemas.notification import NotificationFeedItem, NotificationFeedType
from app.schemas.saved_preset import SavedPresetCreate, SavedPresetPublic
from app.schemas.showtime import ShowtimePublic
from app.schemas.showtime_ping import ShowtimePingPublic
from app.schemas.user import UserMe
from app.services import users as users_service
from app.utils import now_amsterdam_naive
from app.validators.username import is_valid_username

logger = getLogger(__name__)

# Notification-centre entries older than this (or already dismissed) are purged.
NOTIFICATION_MAX_AGE = timedelta(days=30)

# Maps stored notification types to the strings the client feed expects.
_NOTIFICATION_FEED_TYPES: dict[NotificationType, NotificationFeedType] = {
    NotificationType.FRIEND_SHOWTIME_MATCH: "friend_showtime_match",
    NotificationType.INVITE_RESPONSE: "invite_response",
    NotificationType.FRIEND_REQUEST_ACCEPTED: "friend_request_accepted",
}


# Every field on `UserUpdate` that can point something at the user's inbox.
# Listed rather than derived from the `notify_channel_` prefix, so that adding a
# channel is a deliberate decision about whether it may reach an unconfirmed
# address rather than something a naming convention decides silently.
_EMAIL_DELIVERY_FIELDS: tuple[str, ...] = (
    "notify_channel_friend_showtime_match",
    "notify_channel_friend_requests",
    "notify_channel_showtime_ping",
    "notify_channel_invite_response",
    "notify_channel_interest_reminder",
)


def _wants_email_delivery(user_data: dict[str, Any]) -> bool:
    """Whether this update opts *into* email for anything."""
    if user_data.get("notify_watchlist_digest_enabled") is True:
        return True
    return any(
        user_data.get(field) == NotificationChannel.EMAIL
        for field in _EMAIL_DELIVERY_FIELDS
    )


def update_me(
    *,
    session: Session,
    user_in: UserUpdate,
    current_user: User,
) -> UserMe:
    user_data = user_in.model_dump(exclude_unset=True)
    incognito_mode_changed = False
    if "incognito_mode" in user_data and user_data["incognito_mode"] is not None:
        incognito_mode_changed = (
            user_data["incognito_mode"] != current_user.incognito_mode
        )

    # Nothing may route mail to an address nobody has proven belongs to this
    # account — not a notification channel, not the digest. An unconfirmed
    # address is quite possibly a stranger's, and mail they never asked for is
    # how a sender ends up in spam folders. Switching *away* from email is
    # always allowed; only opting in waits for the confirmation link.
    if not current_user.email_verified and _wants_email_delivery(user_data):
        raise EmailNotVerified()

    # Sticky, so the tip that points this feature out never nags someone who has
    # already found it — including someone who tried it and switched it back off.
    if user_data.get("notify_watchlist_digest_enabled") is True:
        current_user.watchlist_digest_ever_enabled = True

    requested_display_name: str | None = None
    if "display_name" in user_data:
        display_name = user_data["display_name"]
        # No account gives up its username. `None` and `""` both arrive from the
        # same empty field, and either one would leave a user that nobody can
        # search for, recognise in a friend list, or invite to anything.
        requested_display_name = display_name.strip() if display_name else None
        if not requested_display_name:
            raise UsernameRequired()
        user_data["display_name"] = requested_display_name
        normalized_current_display_name = (
            current_user.display_name.strip() if current_user.display_name else None
        )
        # Compared case-insensitively so re-saving the same name in different
        # capitalisation is a rename to itself, not a clash with itself.
        username_changed = (
            requested_display_name.lower()
            != (normalized_current_display_name or "").lower()
        )
        if username_changed:
            if not is_valid_username(requested_display_name):
                raise InvalidUsername()
            existing_user = users_crud.get_user_by_display_name(
                session=session,
                display_name=requested_display_name,
            )
            if existing_user and existing_user.id != current_user.id:
                raise DisplayNameAlreadyExists(requested_display_name)

    requested_email: str | None = None
    email_changed = False
    if "email" in user_data:
        email = user_data["email"]
        requested_email = str(email).strip() if email else None
        if not requested_email:
            # No account gives up its email either — EmailStr validation on
            # UserUpdate rejects a malformed string, but an explicit
            # `"email": null` still reaches here.
            raise EmailRequired()
        normalized_current_email = current_user.email.strip().lower()
        email_changed = requested_email.lower() != normalized_current_email
        if email_changed:
            existing_owner = users_crud.get_user_by_login_email(
                session=session, email=requested_email
            )
            if existing_owner and existing_owner.id != current_user.id:
                raise EmailAlreadyExists(requested_email)

    # Changing the username or email is who-you-are, not a preference — it
    # requires proving you're still the one holding the account, exactly like
    # changing the password itself does. An account with no password yet has
    # nothing to confirm with, so it must set one first rather than treating a
    # blank confirmation as good enough. Gated on the field being present at
    # all (not just actually changed) — re-saving the same value is still a
    # deliberate identity-field submission, and keeping the rule simple means
    # there's no separate "did it really change" edge case to get wrong here.
    # Exception: a social sign-in account starts with both no display_name and
    # no password at all, and giving it its first username is filling in a
    # required field, not proving continued ownership of an existing one —
    # there's nothing to confirm against yet, and no password to set one up
    # with either, so it must not be blocked on PasswordNotSet. A password
    # already being set means there's something to confirm with, so that case
    # still goes through the normal check below even for a first username.
    # Scoped to a display_name-only submission — an email change riding along
    # in the same request still needs the account to set a password first,
    # exactly as before.
    initial_username_set_without_password = (
        "display_name" in user_data
        and "email" not in user_data
        and current_user.display_name is None
        and current_user.hashed_password is None
    )
    current_password = user_data.pop("current_password", None)
    identity_fields_changed = (
        "email" in user_data or "display_name" in user_data
    ) and not initial_username_set_without_password
    if identity_fields_changed:
        if current_user.hashed_password is None:
            raise PasswordNotSet()
        if current_password is None or not verify_password(
            current_password, current_user.hashed_password
        ):
            raise IncorrectPassword()

    validated_user_update = UserUpdate.model_validate(user_data)

    try:
        users_crud.update_user(
            session=session,
            db_user=current_user,
            user_in=validated_user_update,
        )
        if email_changed:
            # Only snapshot on the transition into "unverified" — a second email
            # change while still unverified from a prior one must not overwrite
            # the saved preferences with the already-switched-to-push state.
            if current_user.email_verified:
                saved_channels = [
                    field
                    for field in _EMAIL_DELIVERY_FIELDS
                    if getattr(current_user, field) == NotificationChannel.EMAIL
                ]
                saved_digest_enabled = current_user.notify_watchlist_digest_enabled
                for field in saved_channels:
                    setattr(current_user, field, NotificationChannel.PUSH)
                if saved_digest_enabled:
                    current_user.notify_watchlist_digest_enabled = False
                current_user.unverified_email_saved_channels = saved_channels or None
                current_user.unverified_email_saved_digest_enabled = (
                    saved_digest_enabled
                )
            current_user.email_verified = False
            session.add(current_user)
            users_crud.sync_primary_login_email(
                session=session, user_id=current_user.id, email=current_user.email
            )
    except users_crud.LoginEmailConflict as e:
        raise EmailAlreadyExists(e.email) from e
    except IntegrityError as e:
        if isinstance(e.orig, UniqueViolation):
            # Both of this table's unique rules surface as the same error, and
            # naming the wrong one sends the user to fix the wrong field. The
            # username check above can still be lost to a request that
            # interleaved between it and this write; the index is what actually
            # decides, so this is where that race is reported.
            if users_crud.is_display_name_conflict(e):
                raise DisplayNameAlreadyExists(requested_display_name or "") from e
            raise EmailAlreadyExists(
                validated_user_update.email or current_user.email
            ) from e
        else:
            raise AppError from e
    except Exception as e:
        raise AppError() from e

    if incognito_mode_changed:
        showtime_visibility_crud.rebuild_effective_visibility_for_owner(
            session=session,
            owner_id=current_user.id,
        )

    session.commit()
    user_public = user_converters.to_me(current_user, session=session)
    if email_changed:
        users_service.send_email_verification(user=current_user)
    return user_public


def delete_me(
    *,
    session: Session,
    current_user: User,
) -> None:
    session.delete(current_user)
    session.commit()


def register_push_token(
    *,
    session: Session,
    user_id: UUID,
    token: str,
    platform: str | None = None,
) -> None:
    try:
        push_tokens_crud.upsert_push_token(
            session=session,
            user_id=user_id,
            token=token,
            platform=platform,
        )
    except Exception as e:
        raise AppError from e
    session.commit()


def delete_push_token_for_user(
    *,
    session: Session,
    user_id: UUID,
    token: str,
) -> bool:
    db_obj = session.get(PushToken, token)
    if db_obj is None:
        return False
    if db_obj.user_id != user_id:
        raise AppError(detail="Push token belongs to a different user")

    try:
        push_tokens_crud.delete_push_token(session=session, token=token)
    except Exception as e:
        raise AppError from e
    session.commit()
    return True


def _to_saved_preset_public(preset: SavedPreset) -> SavedPresetPublic:
    return SavedPresetPublic.model_validate(
        {
            "id": preset.id,
            "name": preset.name,
            "is_favorite": preset.is_favorite,
            "untouched_fields": preset.untouched_fields,
            "filters": preset.filters,
            "cinema_ids": preset.cinema_ids,
            "created_at": preset.created_at,
            "updated_at": preset.updated_at,
        }
    )


def list_saved_presets(
    *,
    session: Session,
    user_id: UUID,
) -> list[SavedPresetPublic]:
    presets = saved_presets_crud.list_user_presets(
        session=session,
        user_id=user_id,
    )
    return [_to_saved_preset_public(preset) for preset in presets]


def save_saved_preset(
    *,
    session: Session,
    user_id: UUID,
    payload: SavedPresetCreate,
) -> SavedPresetPublic:
    now = now_amsterdam_naive()
    preset_name = payload.name.strip()
    filters = payload.filters.model_dump(mode="json")
    cinema_ids = list(payload.cinema_ids) if payload.cinema_ids is not None else None
    should_set_favorite = payload.is_favorite is True
    existing = saved_presets_crud.get_user_preset_by_name(
        session=session,
        user_id=user_id,
        name=preset_name,
    )

    if should_set_favorite:
        saved_presets_crud.clear_user_favorite_preset(
            session=session,
            user_id=user_id,
        )

    if existing is None:
        preset = saved_presets_crud.create_preset(
            session=session,
            user_id=user_id,
            name=preset_name,
            untouched_fields=payload.untouched_fields,
            filters=filters,
            cinema_ids=cinema_ids,
            is_favorite=should_set_favorite,
            now=now,
        )
    else:
        preset = saved_presets_crud.update_preset(
            session=session,
            preset=existing,
            untouched_fields=payload.untouched_fields,
            filters=filters,
            cinema_ids=cinema_ids,
            is_favorite=payload.is_favorite,
            now=now,
        )

    session.commit()
    return _to_saved_preset_public(preset)


def delete_saved_preset(
    *,
    session: Session,
    user_id: UUID,
    preset_id: UUID,
) -> bool:
    deleted = saved_presets_crud.delete_user_preset(
        session=session,
        user_id=user_id,
        preset_id=preset_id,
    )
    if deleted:
        session.commit()
    return deleted


def get_favorite_saved_preset(
    *,
    session: Session,
    user_id: UUID,
) -> SavedPresetPublic | None:
    preset = saved_presets_crud.get_user_favorite_preset(
        session=session,
        user_id=user_id,
    )
    if preset is None:
        return None
    return _to_saved_preset_public(preset)


def set_favorite_saved_preset(
    *,
    session: Session,
    user_id: UUID,
    preset_id: UUID,
) -> SavedPresetPublic | None:
    now = now_amsterdam_naive()
    preset = saved_presets_crud.get_user_preset_by_id(
        session=session,
        user_id=user_id,
        preset_id=preset_id,
    )
    if preset is None:
        return None

    saved_presets_crud.clear_user_favorite_preset(
        session=session,
        user_id=user_id,
    )
    favorite = saved_presets_crud.set_preset_favorite(
        session=session,
        preset=preset,
        is_favorite=True,
        now=now,
    )
    session.commit()
    return _to_saved_preset_public(favorite)


def clear_favorite_saved_preset(
    *,
    session: Session,
    user_id: UUID,
) -> None:
    saved_presets_crud.clear_user_favorite_preset(
        session=session,
        user_id=user_id,
    )
    session.commit()


def _to_cinema_preset_public(preset: CinemaPreset) -> CinemaPresetPublic:
    return CinemaPresetPublic.model_validate(
        {
            "id": preset.id,
            "name": preset.name,
            "is_default": False,
            "cinema_ids": preset.cinema_ids,
            "is_favorite": preset.is_favorite,
            "created_at": preset.created_at,
            "updated_at": preset.updated_at,
        }
    )


def _normalize_cinema_ids(cinema_ids: list[int]) -> list[int]:
    return sorted(set(cinema_ids))


def _get_all_cinema_ids(*, session: Session) -> list[int]:
    return sorted(cinema.id for cinema in cinemas_crud.get_cinemas(session=session))


def _free_cinema_preset_name(
    *,
    session: Session,
    user_id: UUID,
    base_name: str,
) -> str:
    """`base_name`, or the first numbered variant the user does not already use.

    Names are unique per user, so a user who happens to have a preset called
    "My Cinemas" would otherwise either hit the constraint or have that preset
    overwritten when their favorite row is first created for them.
    """
    candidate = base_name
    suffix = 1
    while (
        cinema_presets_crud.get_user_preset_by_name(
            session=session,
            user_id=user_id,
            name=candidate,
        )
        is not None
    ):
        suffix += 1
        candidate = f"{base_name} {suffix}"
    return candidate


def _build_default_cinema_preset(*, session: Session) -> CinemaPresetPublic:
    now = now_amsterdam_naive()
    return CinemaPresetPublic.model_validate(
        {
            "id": DEFAULT_CINEMA_PRESET_ID,
            "name": DEFAULT_CINEMA_PRESET_NAME,
            "is_default": True,
            "cinema_ids": _get_all_cinema_ids(session=session),
            "is_favorite": False,
            "created_at": now,
            "updated_at": now,
        }
    )


def list_cinema_presets(
    *,
    session: Session,
    user_id: UUID,
) -> list[CinemaPresetPublic]:
    presets = cinema_presets_crud.list_user_presets(
        session=session,
        user_id=user_id,
    )
    public_presets = [_to_cinema_preset_public(preset) for preset in presets]
    has_default = any(
        preset.id == DEFAULT_CINEMA_PRESET_ID for preset in public_presets
    )
    if not has_default:
        public_presets.insert(0, _build_default_cinema_preset(session=session))
    return public_presets


def save_cinema_preset(
    *,
    session: Session,
    user_id: UUID,
    payload: CinemaPresetCreate,
) -> CinemaPresetPublic:
    """Create a named preset, or replace an existing one the caller named.

    Names used to upsert silently, which was survivable while a name was the
    only way to address a preset. Now that presets can be renamed, reusing a
    name is far more likely to be an accident than an intention, so a clash is
    a 409 unless the caller says `overwrite` — the client asks first and sends
    it on the second tap.
    """
    now = now_amsterdam_naive()
    preset_name = payload.name.strip()
    cinema_ids = _normalize_cinema_ids(payload.cinema_ids)
    should_set_favorite = payload.is_favorite is True
    existing = cinema_presets_crud.get_user_preset_by_name(
        session=session,
        user_id=user_id,
        name=preset_name,
    )
    if existing is not None and not payload.overwrite:
        raise CinemaPresetNameTaken()

    if should_set_favorite:
        cinema_presets_crud.clear_user_favorite_preset(
            session=session,
            user_id=user_id,
        )

    if existing is None:
        preset = cinema_presets_crud.create_preset(
            session=session,
            user_id=user_id,
            name=preset_name,
            cinema_ids=cinema_ids,
            is_favorite=should_set_favorite,
            now=now,
        )
    else:
        preset = cinema_presets_crud.update_preset(
            session=session,
            preset=existing,
            cinema_ids=cinema_ids,
            is_favorite=payload.is_favorite,
            now=now,
        )

    session.commit()
    return _to_cinema_preset_public(preset)


def rename_cinema_preset(
    *,
    session: Session,
    user_id: UUID,
    preset_id: UUID,
    name: str,
) -> CinemaPresetPublic:
    """Rename a saved preset, including the favorite one.

    The favorite is identified by its flag, never by its name, so the user is
    free to call their cinemas whatever they like without any of the code that
    reads the favorite losing track of it.
    """
    now = now_amsterdam_naive()
    preset_name = name.strip()
    if not preset_name:
        raise CinemaPresetNameRequired()

    preset = cinema_presets_crud.get_user_preset_by_id(
        session=session,
        user_id=user_id,
        preset_id=preset_id,
    )
    if preset is None:
        raise CinemaPresetNotFound()

    clashing = cinema_presets_crud.get_user_preset_by_name(
        session=session,
        user_id=user_id,
        name=preset_name,
    )
    if clashing is not None and clashing.id != preset.id:
        raise CinemaPresetNameTaken()

    renamed = cinema_presets_crud.rename_preset(
        session=session,
        preset=preset,
        name=preset_name,
        now=now,
    )
    session.commit()
    return _to_cinema_preset_public(renamed)


def delete_cinema_preset(
    *,
    session: Session,
    user_id: UUID,
    preset_id: UUID,
) -> bool:
    if preset_id == DEFAULT_CINEMA_PRESET_ID:
        return False

    deleted = cinema_presets_crud.delete_preset(
        session=session,
        user_id=user_id,
        preset_id=preset_id,
    )
    if deleted:
        session.commit()
    return deleted


def get_favorite_cinema_preset(
    *,
    session: Session,
    user_id: UUID,
) -> CinemaPresetPublic | None:
    favorite = cinema_presets_crud.get_user_favorite_preset(
        session=session,
        user_id=user_id,
    )
    if favorite is None:
        return None
    return _to_cinema_preset_public(favorite)


def apply_cinema_preset_as_favorite(
    *,
    session: Session,
    user_id: UUID,
    preset_id: UUID,
) -> CinemaPresetPublic | None:
    """Point "my cinemas" at what a saved preset covers.

    Copies the cinemas across rather than moving the favorite flag onto the
    preset. Moving it would leave the row the user thinks of as "my cinemas"
    sitting in the list as an ordinary preset under that same name, and would
    quietly turn a preset they saved for one purpose into the thing applied on
    every startup. One row is the favorite, always, and it keeps its identity.
    """
    preset = cinema_presets_crud.get_user_preset_by_id(
        session=session,
        user_id=user_id,
        preset_id=preset_id,
    )
    if preset is None:
        return None

    set_favorite_cinema_ids(
        session=session,
        user_id=user_id,
        cinema_ids=list(preset.cinema_ids),
    )
    return get_favorite_cinema_preset(session=session, user_id=user_id)


def clear_favorite_cinema_preset(
    *,
    session: Session,
    user_id: UUID,
) -> None:
    cinema_presets_crud.clear_user_favorite_preset(
        session=session,
        user_id=user_id,
    )
    session.commit()


def get_favorite_cinema_ids(
    *,
    session: Session,
    user_id: UUID,
) -> list[int]:
    favorite = cinema_presets_crud.get_user_favorite_preset(
        session=session,
        user_id=user_id,
    )
    if favorite is not None:
        return list(favorite.cinema_ids)

    # Compatibility fallback for existing web users until they save a cinema preset.
    legacy_cinema_ids = users_crud.get_selected_cinemas_ids(
        session=session,
        user_id=user_id,
    )
    return _normalize_cinema_ids(legacy_cinema_ids)


def set_favorite_cinema_ids(
    *,
    session: Session,
    user_id: UUID,
    cinema_ids: list[int],
) -> None:
    now = now_amsterdam_naive()
    normalized_ids = _normalize_cinema_ids(cinema_ids)
    favorite = cinema_presets_crud.get_user_favorite_preset(
        session=session,
        user_id=user_id,
    )
    if favorite is None:
        cinema_presets_crud.create_preset(
            session=session,
            user_id=user_id,
            name=_free_cinema_preset_name(
                session=session,
                user_id=user_id,
                base_name=FAVORITE_CINEMA_PRESET_NAME,
            ),
            cinema_ids=normalized_ids,
            is_favorite=True,
            now=now,
        )
    else:
        cinema_presets_crud.update_preset(
            session=session,
            preset=favorite,
            cinema_ids=normalized_ids,
            is_favorite=True,
            now=now,
        )
    session.commit()


def get_received_showtime_pings(
    *,
    session: Session,
    user_id: UUID,
    sort_by: ShowtimePingSort,
    limit: int,
    offset: int,
) -> list[ShowtimePingPublic]:
    _prune_past_showtime_pings(session=session, user_id=user_id)
    pings = showtime_ping_crud.get_received_showtime_pings(
        session=session,
        receiver_id=user_id,
        sort_by=sort_by,
        limit=limit,
        offset=offset,
    )

    sender_cache: dict[UUID, User | None] = {}
    showtime_cache: dict[int, Showtime | None] = {}
    showtime_public_cache: dict[int, ShowtimePublic] = {}
    result: list[ShowtimePingPublic] = []

    for ping in pings:
        sender = sender_cache.get(ping.sender_id)
        if sender is None:
            sender = users_crud.get_user_by_id(session=session, user_id=ping.sender_id)
            sender_cache[ping.sender_id] = sender
        if sender is None:
            continue

        showtime = showtime_cache.get(ping.showtime_id)
        if showtime is None:
            showtime = showtimes_crud.get_showtime_by_id(
                session=session,
                showtime_id=ping.showtime_id,
            )
            showtime_cache[ping.showtime_id] = showtime
        if showtime is None:
            continue

        showtime_public = showtime_public_cache.get(showtime.id)
        if showtime_public is None:
            showtime_public = showtime_converters.to_public(
                showtime=showtime,
                session=session,
                user_id=user_id,
            )
            showtime_public_cache[showtime.id] = showtime_public

        if ping.id is None:
            continue

        result.append(
            ShowtimePingPublic(
                id=ping.id,
                showtime_id=ping.showtime_id,
                movie_id=showtime.movie_id,
                movie_title=showtime.movie.title,
                movie_poster_link=showtime.movie.poster_link,
                cinema_name=showtime.cinema.name,
                datetime=showtime.datetime,
                ticket_link=showtime.ticket_link,
                showtime=showtime_public,
                sender=user_converters.to_public(sender),
                created_at=ping.created_at,
                seen_at=ping.seen_at,
            )
        )

    return result


def get_agenda_showtimes(
    *,
    session: Session,
    user_id: UUID,
    snapshot_time: datetime,
    include_interested: bool,
    include_invited: bool,
    limit: int,
    offset: int,
) -> list[ShowtimePublic]:
    showtimes = showtimes_crud.get_agenda_showtimes(
        session=session,
        user_id=user_id,
        snapshot_time=snapshot_time,
        include_interested=include_interested,
        include_invited=include_invited,
        limit=limit,
        offset=offset,
    )
    return [
        showtime_converters.to_public(
            showtime=showtime,
            session=session,
            user_id=user_id,
        )
        for showtime in showtimes
    ]


def get_unseen_showtime_ping_count(
    *,
    session: Session,
    user_id: UUID,
) -> int:
    _prune_past_showtime_pings(session=session, user_id=user_id)
    return showtime_ping_crud.get_unseen_showtime_ping_count(
        session=session,
        receiver_id=user_id,
    )


def mark_showtime_pings_seen(
    *,
    session: Session,
    user_id: UUID,
) -> None:
    _prune_past_showtime_pings(session=session, user_id=user_id)
    showtime_ping_crud.mark_received_showtime_pings_seen(
        session=session,
        receiver_id=user_id,
        seen_at=now_amsterdam_naive(),
    )
    session.commit()


def delete_received_showtime_ping(
    *,
    session: Session,
    user_id: UUID,
    ping_id: int,
) -> bool:
    deleted = showtime_ping_crud.delete_received_showtime_ping(
        session=session,
        ping_id=ping_id,
        receiver_id=user_id,
    )
    if deleted:
        session.commit()
    return deleted


def dismiss_received_showtime_ping(
    *,
    session: Session,
    user_id: UUID,
    ping_id: int,
) -> bool:
    ping = showtime_ping_crud.get_showtime_ping_by_id(session=session, ping_id=ping_id)
    dismissed = showtime_ping_crud.dismiss_received_showtime_ping(
        session=session,
        ping_id=ping_id,
        receiver_id=user_id,
        dismissed_at=now_amsterdam_naive(),
    )
    if dismissed and ping is not None:
        # Dismissing drops the dismisser from the inviter's active invite group,
        # which can also drop their co-invitees out of each other's visibility —
        # rebuild the whole group, not just the dismisser.
        try:
            showtime_visibility_crud.rebuild_effective_visibility_for_showtime_participants(
                session=session,
                showtime_id=ping.showtime_id,
            )
            showtime_visibility_crud.rebuild_effective_visibility_for_showtime(
                session=session,
                owner_id=user_id,
                showtime_id=ping.showtime_id,
            )
            session.commit()
        except Exception as e:
            session.rollback()
            raise AppError from e
    return dismissed


def _prune_past_showtime_pings(
    *,
    session: Session,
    user_id: UUID,
) -> None:
    deleted_count = showtime_ping_crud.delete_received_past_showtime_pings(
        session=session,
        receiver_id=user_id,
        now=now_amsterdam_naive(),
    )
    if deleted_count > 0:
        session.commit()


def _prune_notification_sources(*, session: Session, user_id: UUID) -> None:
    """Drop notifications and invites whose showtime has already started."""
    now = now_amsterdam_naive()
    notifications_pruned = notification_crud.delete_past_showtime_notifications(
        session=session,
        user_id=user_id,
        now=now,
    )
    pings_pruned = showtime_ping_crud.delete_received_past_showtime_pings(
        session=session,
        receiver_id=user_id,
        now=now,
    )
    if notifications_pruned or pings_pruned:
        session.commit()


def get_notification_feed(
    *,
    session: Session,
    user_id: UUID,
    limit: int,
    offset: int,
) -> list[NotificationFeedItem]:
    """Merge the three notification sources into one time-sorted feed."""
    _prune_notification_sources(session=session, user_id=user_id)

    # Over-fetch each source so the merged-then-sliced page is correct.
    fetch_count = limit + offset

    user_cache: dict[UUID, User | None] = {}
    showtime_public_cache: dict[int, ShowtimePublic | None] = {}

    def resolve_user(uid: UUID) -> User | None:
        if uid not in user_cache:
            user_cache[uid] = users_crud.get_user_by_id(session=session, user_id=uid)
        return user_cache[uid]

    def resolve_showtime_public(sid: int) -> ShowtimePublic | None:
        if sid not in showtime_public_cache:
            showtime = showtimes_crud.get_showtime_by_id(
                session=session, showtime_id=sid
            )
            showtime_public_cache[sid] = (
                showtime_converters.to_public(
                    showtime=showtime, session=session, user_id=user_id
                )
                if showtime is not None
                else None
            )
        return showtime_public_cache[sid]

    items: list[NotificationFeedItem] = []

    for notification in notification_crud.get_feed_notifications(
        session=session, user_id=user_id, limit=fetch_count, offset=0
    ):
        if notification.id is None:
            continue
        showtime_public = (
            resolve_showtime_public(notification.showtime_id)
            if notification.showtime_id is not None
            else None
        )
        if notification.showtime_id is not None and showtime_public is None:
            continue
        actor = (
            resolve_user(notification.actor_id)
            if notification.actor_id is not None
            else None
        )
        items.append(
            NotificationFeedItem(
                source="notification",
                id=str(notification.id),
                type=_NOTIFICATION_FEED_TYPES[notification.type],
                created_at=notification.created_at,
                seen_at=notification.seen_at,
                actor=user_converters.to_public(actor) if actor else None,
                showtime=showtime_public,
            )
        )

    for ping in showtime_ping_crud.get_received_showtime_pings(
        session=session,
        receiver_id=user_id,
        sort_by=ShowtimePingSort.PING_CREATED_AT,
        limit=fetch_count,
        offset=0,
    ):
        if ping.id is None:
            continue
        sender = resolve_user(ping.sender_id)
        showtime_public = resolve_showtime_public(ping.showtime_id)
        if sender is None or showtime_public is None:
            continue
        items.append(
            NotificationFeedItem(
                source="ping",
                id=str(ping.id),
                type="showtime_invite",
                created_at=ping.created_at,
                seen_at=ping.seen_at,
                actor=user_converters.to_public(sender),
                showtime=showtime_public,
            )
        )

    for request, sender in friendship_crud.get_received_friend_requests_with_sender(
        session=session, receiver_id=user_id, limit=fetch_count, offset=0
    ):
        items.append(
            NotificationFeedItem(
                source="friend_request",
                id=str(request.sender_id),
                type="friend_request_received",
                created_at=request.created_at,
                seen_at=None,
                actor=user_converters.to_public(sender),
                showtime=None,
            )
        )

    items.sort(key=lambda item: item.created_at, reverse=True)
    return items[offset : offset + limit]


def get_notifications_unseen_count(*, session: Session, user_id: UUID) -> int:
    """Bell badge: unseen new-table notifications plus unseen invites."""
    _prune_notification_sources(session=session, user_id=user_id)
    return notification_crud.get_unseen_count(
        session=session, user_id=user_id
    ) + showtime_ping_crud.get_unseen_showtime_ping_count(
        session=session, receiver_id=user_id
    )


def mark_notifications_seen(*, session: Session, user_id: UUID) -> None:
    """Clear the bell badge: mark notifications and invites seen."""
    _prune_notification_sources(session=session, user_id=user_id)
    now = now_amsterdam_naive()
    notification_crud.mark_seen(session=session, user_id=user_id, seen_at=now)
    showtime_ping_crud.mark_received_showtime_pings_seen(
        session=session, receiver_id=user_id, seen_at=now
    )
    session.commit()


def dismiss_notification(
    *,
    session: Session,
    user_id: UUID,
    notification_id: int,
) -> bool:
    dismissed = notification_crud.dismiss(
        session=session,
        notification_id=notification_id,
        user_id=user_id,
        dismissed_at=now_amsterdam_naive(),
    )
    if dismissed:
        session.commit()
    return dismissed


def purge_stale_notifications(*, session: Session) -> int:
    """Decay job: delete dismissed or aged-out notification rows (all users)."""
    deleted = notification_crud.delete_stale_notifications(
        session=session,
        now=now_amsterdam_naive(),
        max_age=NOTIFICATION_MAX_AGE,
    )
    if deleted:
        session.commit()
    return deleted
