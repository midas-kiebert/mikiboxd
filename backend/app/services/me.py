from datetime import datetime
from logging import getLogger
from uuid import UUID

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.converters import user as user_converters
from app.core.enums import FilterPresetScope, ShowtimePingSort
from app.core.username import (
    USERNAME_VALIDATION_MESSAGE,
    is_valid_username,
    normalize_username,
)
from app.crud import cinema as cinemas_crud
from app.crud import cinema_preset as cinema_presets_crud
from app.crud import filter_preset as filter_presets_crud
from app.crud import friend_group as friend_groups_crud
from app.crud import push_token as push_tokens_crud
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
from app.models.filter_preset import FilterPreset
from app.models.friend_group import FriendGroup
from app.models.push_token import PushToken
from app.models.showtime import Showtime
from app.models.user import User, UserUpdate
from app.schemas.cinema_preset import CinemaPresetCreate, CinemaPresetPublic
from app.schemas.filter_preset import FilterPresetCreate, FilterPresetPublic
from app.schemas.friend_group import FriendGroupCreate, FriendGroupPublic
from app.schemas.showtime import ShowtimeLoggedIn
from app.schemas.showtime_ping import ShowtimePingPublic
from app.schemas.user import UserMe
from app.utils import now_amsterdam_naive

logger = getLogger(__name__)

DEFAULT_FILTER_PRESET_IDS = {
    FilterPresetScope.SHOWTIMES: UUID("00000000-0000-0000-0000-000000000001"),
    FilterPresetScope.MOVIES: UUID("00000000-0000-0000-0000-000000000002"),
}
DEFAULT_CINEMA_PRESET_ID = UUID("00000000-0000-0000-0000-000000000003")
DEFAULT_CINEMA_PRESET_NAME = "All Cinemas"


def _build_default_filter_preset(scope: FilterPresetScope) -> FilterPresetPublic:
    now = now_amsterdam_naive()
    return FilterPresetPublic.model_validate(
        {
            "id": DEFAULT_FILTER_PRESET_IDS[scope],
            "name": "Default",
            "scope": scope,
            "is_default": True,
            "is_favorite": False,
            "filters": {
                "selected_showtime_filter": "all",
                "showtime_audience": "including-friends",
                "watchlist_only": False,
                "days": None,
                "time_ranges": None,
                "runtime_ranges": None,
            },
            "created_at": now,
            "updated_at": now,
        }
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

    if "display_name" in user_data:
        display_name = user_data["display_name"]
        if display_name is not None:
            normalized_display_name = normalize_username(display_name)
            if normalized_display_name == "":
                user_data["display_name"] = None
                normalized_display_name = None
            else:
                user_data["display_name"] = normalized_display_name
            normalized_current_display_name = normalize_username(
                current_user.display_name
            )
            username_changed = (normalized_display_name or "").lower() != (
                normalized_current_display_name or ""
            ).lower()
            if normalized_display_name:
                if username_changed and not is_valid_username(normalized_display_name):
                    raise InvalidUsername(USERNAME_VALIDATION_MESSAGE)
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


def _to_filter_preset_public(preset: FilterPreset) -> FilterPresetPublic:
    return FilterPresetPublic.model_validate(
        {
            "id": preset.id,
            "name": preset.name,
            "scope": preset.scope,
            "is_default": preset.is_default,
            "is_favorite": preset.is_favorite,
            "filters": preset.filters,
            "created_at": preset.created_at,
            "updated_at": preset.updated_at,
        }
    )


def list_filter_presets(
    *,
    session: Session,
    user_id: UUID,
    scope: FilterPresetScope,
) -> list[FilterPresetPublic]:
    presets = filter_presets_crud.get_visible_presets(
        session=session,
        user_id=user_id,
        scope=scope,
    )
    public_presets = [_to_filter_preset_public(preset) for preset in presets]
    has_named_default = any(
        preset.is_default and preset.name.strip().lower() == "default"
        for preset in public_presets
    )
    if not has_named_default:
        public_presets.insert(0, _build_default_filter_preset(scope))
    return public_presets


def save_filter_preset(
    *,
    session: Session,
    user_id: UUID,
    payload: FilterPresetCreate,
) -> FilterPresetPublic:
    now = now_amsterdam_naive()
    preset_name = payload.name.strip()
    filters = payload.filters.model_dump(mode="json")
    should_set_favorite = payload.is_favorite is True
    existing = filter_presets_crud.get_user_preset_by_name(
        session=session,
        user_id=user_id,
        scope=payload.scope,
        name=preset_name,
    )

    if should_set_favorite:
        filter_presets_crud.clear_user_favorite_preset(
            session=session,
            user_id=user_id,
            scope=payload.scope,
        )

    if existing is None:
        preset = filter_presets_crud.create_preset(
            session=session,
            user_id=user_id,
            name=preset_name,
            scope=payload.scope,
            filters=filters,
            is_favorite=should_set_favorite,
            now=now,
        )
    else:
        preset = filter_presets_crud.update_preset(
            session=session,
            preset=existing,
            filters=filters,
            is_favorite=payload.is_favorite,
            now=now,
        )

    session.commit()
    return _to_filter_preset_public(preset)


def delete_filter_preset(
    *,
    session: Session,
    user_id: UUID,
    preset_id: UUID,
) -> bool:
    deleted = filter_presets_crud.delete_user_preset(
        session=session,
        user_id=user_id,
        preset_id=preset_id,
    )
    if deleted:
        session.commit()
    return deleted


def get_favorite_filter_preset(
    *,
    session: Session,
    user_id: UUID,
    scope: FilterPresetScope,
) -> FilterPresetPublic | None:
    preset = filter_presets_crud.get_user_favorite_preset(
        session=session,
        user_id=user_id,
        scope=scope,
    )
    if preset is None:
        return None
    return _to_filter_preset_public(preset)


def set_favorite_filter_preset(
    *,
    session: Session,
    user_id: UUID,
    preset_id: UUID,
) -> FilterPresetPublic | None:
    now = now_amsterdam_naive()
    preset = filter_presets_crud.get_user_preset_by_id(
        session=session,
        user_id=user_id,
        preset_id=preset_id,
    )
    if preset is None:
        return None

    filter_presets_crud.clear_user_favorite_preset(
        session=session,
        user_id=user_id,
        scope=preset.scope,
    )
    favorite = filter_presets_crud.set_preset_favorite(
        session=session,
        preset=preset,
        is_favorite=True,
        now=now,
    )
    session.commit()
    return _to_filter_preset_public(favorite)


def clear_favorite_filter_preset(
    *,
    session: Session,
    user_id: UUID,
    scope: FilterPresetScope,
) -> None:
    filter_presets_crud.clear_user_favorite_preset(
        session=session,
        user_id=user_id,
        scope=scope,
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


def _to_friend_group_public(
    *,
    group: FriendGroup,
    friend_ids: list[UUID],
) -> FriendGroupPublic:
    return FriendGroupPublic.model_validate(
        {
            "id": group.id,
            "name": group.name,
            "friend_ids": sorted(friend_ids, key=str),
            "is_favorite": group.is_favorite,
            "created_at": group.created_at,
            "updated_at": group.updated_at,
        }
    )


def _normalize_friend_ids(friend_ids: list[UUID]) -> list[UUID]:
    return sorted(set(friend_ids), key=str)


def _find_group_with_same_members(
    *,
    session: Session,
    user_id: UUID,
    friend_ids: list[UUID],
    exclude_group_id: UUID | None = None,
    all_friend_ids: set[UUID] | None = None,
) -> FriendGroup | None:
    target_member_ids = set(_normalize_friend_ids(friend_ids))
    if len(target_member_ids) == 0:
        return None

    groups = friend_groups_crud.list_user_groups(
        session=session,
        user_id=user_id,
    )
    for group in groups:
        if exclude_group_id is not None and group.id == exclude_group_id:
            continue
        group_member_ids = set(
            friend_groups_crud.get_group_member_ids(
                session=session,
                group_id=group.id,
            )
        )
        if all_friend_ids is not None:
            group_member_ids &= all_friend_ids
        if group_member_ids == target_member_ids:
            return group
    return None


def _sanitize_group_member_ids(
    *,
    session: Session,
    group: FriendGroup,
    all_friend_ids: set[UUID],
    now: datetime,
) -> tuple[list[UUID], bool]:
    group_member_ids = set(
        friend_groups_crud.get_group_member_ids(
            session=session,
            group_id=group.id,
        )
    )
    normalized_friend_ids = sorted(group_member_ids & all_friend_ids, key=str)
    if len(group_member_ids) == len(normalized_friend_ids):
        return sorted(group_member_ids, key=str), False

    friend_groups_crud.replace_group_members(
        session=session,
        group=group,
        friend_ids=normalized_friend_ids,
        now=now,
    )
    group.updated_at = now
    session.add(group)
    return normalized_friend_ids, True


def list_friend_groups(
    *,
    session: Session,
    user_id: UUID,
) -> list[FriendGroupPublic]:
    all_friend_ids = {
        friend.id for friend in users_crud.get_friends(session=session, user_id=user_id)
    }
    now = now_amsterdam_naive()
    groups = friend_groups_crud.list_user_groups(
        session=session,
        user_id=user_id,
    )
    sanitized_groups: list[tuple[FriendGroup, list[UUID], bool]] = []
    had_updates = False
    for group in groups:
        friend_ids, was_updated = _sanitize_group_member_ids(
            session=session,
            group=group,
            all_friend_ids=all_friend_ids,
            now=now,
        )
        if was_updated:
            had_updates = True
        if len(friend_ids) == 0:
            session.delete(group)
            had_updates = True
            continue
        sanitized_groups.append((group, friend_ids, was_updated))

    groups_by_member_key: dict[
        tuple[UUID, ...], list[tuple[FriendGroup, list[UUID], bool]]
    ] = {}
    for entry in sanitized_groups:
        _, friend_ids, _ = entry
        groups_by_member_key.setdefault(tuple(friend_ids), []).append(entry)

    retained_group_ids: set[UUID] = set()
    for grouped_entries in groups_by_member_key.values():
        if len(grouped_entries) == 1:
            retained_group_ids.add(grouped_entries[0][0].id)
            continue

        # If a shrinkage creates a duplicate, prefer a non-updated group.
        # Tie-break deterministically by earliest creation time.
        non_updated_entries = [entry for entry in grouped_entries if not entry[2]]
        candidate_entries = non_updated_entries or grouped_entries
        preferred_entry = min(
            candidate_entries,
            key=lambda entry: (entry[0].created_at, str(entry[0].id)),
        )
        retained_group_ids.add(preferred_entry[0].id)
        for entry in grouped_entries:
            group, _, _ = entry
            if group.id == preferred_entry[0].id:
                continue
            session.delete(group)
            had_updates = True

    public_groups: list[FriendGroupPublic] = []
    for group, friend_ids, _ in sanitized_groups:
        if group.id not in retained_group_ids:
            continue
        public_groups.append(
            _to_friend_group_public(
                group=group,
                friend_ids=friend_ids,
            )
        )

    if had_updates:
        showtime_visibility_crud.rebuild_effective_visibility_for_owner(
            session=session,
            owner_id=user_id,
        )
        session.commit()

    return public_groups


def save_friend_group(
    *,
    session: Session,
    user_id: UUID,
    payload: FriendGroupCreate,
) -> FriendGroupPublic:
    now = now_amsterdam_naive()
    group_name = payload.name.strip()
    friend_ids = _normalize_friend_ids(payload.friend_ids)
    should_set_favorite = payload.is_favorite is True

    all_friend_ids = {
        friend.id for friend in users_crud.get_friends(session=session, user_id=user_id)
    }
    invalid_friend_ids = [
        friend_id for friend_id in friend_ids if friend_id not in all_friend_ids
    ]
    if invalid_friend_ids:
        raise ValueError("Friend group contains users who are not your friends.")
    if len(friend_ids) == 0:
        raise ValueError("Friend group must contain at least one friend.")

    existing = friend_groups_crud.get_user_group_by_name(
        session=session,
        user_id=user_id,
        name=group_name,
    )
    duplicate_group = _find_group_with_same_members(
        session=session,
        user_id=user_id,
        friend_ids=friend_ids,
        exclude_group_id=existing.id if existing is not None else None,
        all_friend_ids=all_friend_ids,
    )
    if duplicate_group is not None:
        raise ValueError("A friend group with the same members already exists.")

    if should_set_favorite:
        friend_groups_crud.clear_user_favorite_group(
            session=session,
            user_id=user_id,
        )

    if existing is None:
        group = friend_groups_crud.create_group(
            session=session,
            user_id=user_id,
            name=group_name,
            is_favorite=should_set_favorite,
            now=now,
        )
    else:
        group = friend_groups_crud.update_group(
            session=session,
            group=existing,
            is_favorite=payload.is_favorite,
            now=now,
        )

    friend_groups_crud.replace_group_members(
        session=session,
        group=group,
        friend_ids=friend_ids,
        now=now,
    )

    showtime_visibility_crud.rebuild_effective_visibility_for_owner(
        session=session,
        owner_id=user_id,
    )
    session.commit()
    return _to_friend_group_public(group=group, friend_ids=friend_ids)


def delete_friend_group(
    *,
    session: Session,
    user_id: UUID,
    group_id: UUID,
) -> bool:
    deleted = friend_groups_crud.delete_group(
        session=session,
        user_id=user_id,
        group_id=group_id,
    )
    if deleted:
        showtime_visibility_crud.rebuild_effective_visibility_for_owner(
            session=session,
            owner_id=user_id,
        )
        session.commit()
    return deleted


def get_favorite_friend_group(
    *,
    session: Session,
    user_id: UUID,
) -> FriendGroupPublic | None:
    groups = list_friend_groups(
        session=session,
        user_id=user_id,
    )
    for group in groups:
        if group.is_favorite:
            return group
    return None


def set_favorite_friend_group(
    *,
    session: Session,
    user_id: UUID,
    group_id: UUID,
) -> FriendGroupPublic | None:
    now = now_amsterdam_naive()
    group = friend_groups_crud.get_user_group_by_id(
        session=session,
        user_id=user_id,
        group_id=group_id,
    )
    if group is None:
        return None

    friend_groups_crud.clear_user_favorite_group(
        session=session,
        user_id=user_id,
    )
    favorite = friend_groups_crud.set_group_favorite(
        session=session,
        group=group,
        is_favorite=True,
        now=now,
    )
    all_friend_ids = {
        friend.id for friend in users_crud.get_friends(session=session, user_id=user_id)
    }
    friend_ids, _ = _sanitize_group_member_ids(
        session=session,
        group=favorite,
        all_friend_ids=all_friend_ids,
        now=now,
    )
    if len(friend_ids) == 0:
        session.delete(favorite)
        showtime_visibility_crud.rebuild_effective_visibility_for_owner(
            session=session,
            owner_id=user_id,
        )
        session.commit()
        return None
    showtime_visibility_crud.rebuild_effective_visibility_for_owner(
        session=session,
        owner_id=user_id,
    )
    session.commit()
    return _to_friend_group_public(group=favorite, friend_ids=friend_ids)


def clear_favorite_friend_group(
    *,
    session: Session,
    user_id: UUID,
) -> None:
    friend_groups_crud.clear_user_favorite_group(
        session=session,
        user_id=user_id,
    )
    showtime_visibility_crud.rebuild_effective_visibility_for_owner(
        session=session,
        owner_id=user_id,
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
