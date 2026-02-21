from logging import getLogger
from uuid import UUID

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.converters import user as user_converters
from app.core.enums import FilterPresetScope, ShowtimePingSort
from app.crud import cinema_preset as cinema_presets_crud
from app.crud import filter_preset as filter_presets_crud
from app.crud import push_token as push_tokens_crud
from app.crud import showtime as showtimes_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.crud import user as users_crud
from app.exceptions.base import AppError
from app.exceptions.user_exceptions import DisplayNameAlreadyExists, EmailAlreadyExists
from app.models.cinema_preset import CinemaPreset
from app.models.filter_preset import FilterPreset
from app.models.showtime import Showtime
from app.models.user import User, UserUpdate
from app.schemas.cinema_preset import CinemaPresetCreate, CinemaPresetPublic
from app.schemas.filter_preset import FilterPresetCreate, FilterPresetPublic
from app.schemas.showtime_ping import ShowtimePingPublic
from app.schemas.user import UserMe
from app.utils import now_amsterdam_naive

logger = getLogger(__name__)


def update_me(
    *,
    session: Session,
    user_in: UserUpdate,
    current_user: User,
) -> UserMe:
    user_data = user_in.model_dump(exclude_unset=True)
    if "display_name" in user_data:
        display_name = user_data["display_name"]
        if display_name is not None:
            normalized_display_name = display_name.strip()
            user_data["display_name"] = normalized_display_name
            if normalized_display_name:
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
    session.commit()
    user_public = user_converters.to_me(current_user)
    return user_public


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
    return [_to_filter_preset_public(preset) for preset in presets]


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
            "cinema_ids": preset.cinema_ids,
            "is_favorite": preset.is_favorite,
            "created_at": preset.created_at,
            "updated_at": preset.updated_at,
        }
    )


def _normalize_cinema_ids(cinema_ids: list[int]) -> list[int]:
    return sorted(set(cinema_ids))


def list_cinema_presets(
    *,
    session: Session,
    user_id: UUID,
) -> list[CinemaPresetPublic]:
    presets = cinema_presets_crud.list_user_presets(
        session=session,
        user_id=user_id,
    )
    return [_to_cinema_preset_public(preset) for preset in presets]


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
