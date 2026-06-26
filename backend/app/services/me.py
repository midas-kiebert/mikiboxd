from datetime import datetime, timedelta
from logging import getLogger
from uuid import UUID

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.converters import user as user_converters
from app.core.enums import NotificationType, ShowtimePingSort
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
from app.exceptions.user_exceptions import (
    DisplayNameAlreadyExists,
    EmailAlreadyExists,
    InvalidUsername,
)
from app.models.cinema_preset import CinemaPreset
from app.models.push_token import PushToken
from app.models.saved_preset import SavedPreset
from app.models.showtime import Showtime
from app.models.user import User, UserUpdate
from app.schemas.cinema_preset import CinemaPresetCreate, CinemaPresetPublic
from app.schemas.notification import NotificationFeedItem
from app.schemas.saved_preset import SavedPresetCreate, SavedPresetPublic
from app.schemas.showtime import ShowtimeLoggedIn
from app.schemas.showtime_ping import ShowtimePingPublic
from app.schemas.user import UserMe
from app.utils import now_amsterdam_naive
from app.validators.username import is_valid_username

logger = getLogger(__name__)

# Notification-centre entries older than this (or already dismissed) are purged.
NOTIFICATION_MAX_AGE = timedelta(days=30)

# Maps stored notification types to the strings the client feed expects.
_NOTIFICATION_FEED_TYPES = {
    NotificationType.FRIEND_SHOWTIME_MATCH: "friend_showtime_match",
    NotificationType.INVITE_RESPONSE: "invite_response",
    NotificationType.FRIEND_REQUEST_ACCEPTED: "friend_request_accepted",
}

DEFAULT_CINEMA_PRESET_ID = UUID("00000000-0000-0000-0000-000000000003")
DEFAULT_CINEMA_PRESET_NAME = "All Cinemas"


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

    if "display_name" in user_data:
        display_name = user_data["display_name"]
        if display_name is not None:
            normalized_display_name = display_name.strip()
            if normalized_display_name == "":
                user_data["display_name"] = None
                normalized_display_name = None
            else:
                user_data["display_name"] = normalized_display_name
            normalized_current_display_name = (
                current_user.display_name.strip() if current_user.display_name else None
            )
            username_changed = (normalized_display_name or "").lower() != (
                normalized_current_display_name or ""
            ).lower()
            if normalized_display_name:
                if username_changed and not is_valid_username(normalized_display_name):
                    raise InvalidUsername()
                if username_changed:
                    existing_user = users_crud.get_user_by_display_name(
                        session=session,
                        display_name=normalized_display_name,
                    )
                    if existing_user and existing_user.id != current_user.id:
                        raise DisplayNameAlreadyExists(normalized_display_name)
    validated_user_update = UserUpdate.model_validate(user_data)

    try:
        users_crud.update_user(
            session=session,
            db_user=current_user,
            user_in=validated_user_update,
        )
    except IntegrityError as e:
        if isinstance(e.orig, UniqueViolation):
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
    user_public = user_converters.to_me(current_user)
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
    now = now_amsterdam_naive()
    preset_name = payload.name.strip()
    cinema_ids = _normalize_cinema_ids(payload.cinema_ids)
    should_set_favorite = payload.is_favorite is True
    existing = cinema_presets_crud.get_user_preset_by_name(
        session=session,
        user_id=user_id,
        name=preset_name,
    )

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


def set_favorite_cinema_preset(
    *,
    session: Session,
    user_id: UUID,
    preset_id: UUID,
) -> CinemaPresetPublic | None:
    now = now_amsterdam_naive()
    preset = cinema_presets_crud.get_user_preset_by_id(
        session=session,
        user_id=user_id,
        preset_id=preset_id,
    )
    if preset is None:
        return None

    cinema_presets_crud.clear_user_favorite_preset(
        session=session,
        user_id=user_id,
    )
    favorite = cinema_presets_crud.set_preset_favorite(
        session=session,
        preset=preset,
        is_favorite=True,
        now=now,
    )
    session.commit()
    return _to_cinema_preset_public(favorite)


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
        fallback_name = "Preferred"
        existing_named = cinema_presets_crud.get_user_preset_by_name(
            session=session,
            user_id=user_id,
            name=fallback_name,
        )
        if existing_named is None:
            cinema_presets_crud.create_preset(
                session=session,
                user_id=user_id,
                name=fallback_name,
                cinema_ids=normalized_ids,
                is_favorite=True,
                now=now,
            )
        else:
            cinema_presets_crud.clear_user_favorite_preset(
                session=session,
                user_id=user_id,
            )
            cinema_presets_crud.update_preset(
                session=session,
                preset=existing_named,
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
    showtime_public_cache: dict[int, ShowtimeLoggedIn] = {}
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
            showtime_public = showtime_converters.to_logged_in(
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
) -> list[ShowtimeLoggedIn]:
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
        showtime_converters.to_logged_in(
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
    showtime_public_cache: dict[int, ShowtimeLoggedIn | None] = {}

    def resolve_user(uid: UUID) -> User | None:
        if uid not in user_cache:
            user_cache[uid] = users_crud.get_user_by_id(session=session, user_id=uid)
        return user_cache[uid]

    def resolve_showtime_public(sid: int) -> ShowtimeLoggedIn | None:
        if sid not in showtime_public_cache:
            showtime = showtimes_crud.get_showtime_by_id(
                session=session, showtime_id=sid
            )
            showtime_public_cache[sid] = (
                showtime_converters.to_logged_in(
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
