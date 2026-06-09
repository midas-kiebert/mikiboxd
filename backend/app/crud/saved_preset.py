from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core.enums import FilterPresetScope
from app.models.saved_preset import SavedPreset


def list_user_presets(
    *,
    session: Session,
    user_id: UUID,
    scope: FilterPresetScope,
) -> list[SavedPreset]:
    stmt = (
        select(SavedPreset)
        .where(
            col(SavedPreset.owner_user_id) == user_id,
            col(SavedPreset.scope) == scope,
        )
        .order_by(
            col(SavedPreset.is_favorite).desc(),
            func.lower(col(SavedPreset.name)),
            col(SavedPreset.created_at),
        )
    )
    return list(session.exec(stmt).all())


def get_user_preset_by_name(
    *,
    session: Session,
    user_id: UUID,
    scope: FilterPresetScope,
    name: str,
) -> SavedPreset | None:
    stmt = select(SavedPreset).where(
        col(SavedPreset.owner_user_id) == user_id,
        col(SavedPreset.scope) == scope,
        col(SavedPreset.name) == name,
    )
    return session.exec(stmt).one_or_none()


def get_user_preset_by_id(
    *,
    session: Session,
    user_id: UUID,
    preset_id: UUID,
) -> SavedPreset | None:
    stmt = select(SavedPreset).where(
        col(SavedPreset.id) == preset_id,
        col(SavedPreset.owner_user_id) == user_id,
    )
    return session.exec(stmt).one_or_none()


def get_user_favorite_preset(
    *,
    session: Session,
    user_id: UUID,
    scope: FilterPresetScope,
) -> SavedPreset | None:
    stmt = select(SavedPreset).where(
        col(SavedPreset.owner_user_id) == user_id,
        col(SavedPreset.scope) == scope,
        col(SavedPreset.is_favorite).is_(True),
    )
    return session.exec(stmt).one_or_none()


def create_preset(
    *,
    session: Session,
    user_id: UUID,
    name: str,
    scope: FilterPresetScope,
    included_fields: list[str],
    filters: dict[str, Any],
    cinema_ids: list[int] | None,
    is_favorite: bool,
    now: datetime,
) -> SavedPreset:
    preset = SavedPreset(
        owner_user_id=user_id,
        name=name,
        scope=scope,
        is_favorite=is_favorite,
        included_fields=included_fields,
        filters=filters,
        cinema_ids=cinema_ids,
        created_at=now,
        updated_at=now,
    )
    session.add(preset)
    session.flush()
    return preset


def update_preset(
    *,
    session: Session,
    preset: SavedPreset,
    included_fields: list[str],
    filters: dict[str, Any],
    cinema_ids: list[int] | None,
    is_favorite: bool | None,
    now: datetime,
) -> SavedPreset:
    preset.included_fields = included_fields
    preset.filters = filters
    preset.cinema_ids = cinema_ids
    if is_favorite is not None:
        preset.is_favorite = is_favorite
    preset.updated_at = now
    session.add(preset)
    session.flush()
    return preset


def clear_user_favorite_preset(
    *,
    session: Session,
    user_id: UUID,
    scope: FilterPresetScope,
) -> None:
    stmt = select(SavedPreset).where(
        col(SavedPreset.owner_user_id) == user_id,
        col(SavedPreset.scope) == scope,
        col(SavedPreset.is_favorite).is_(True),
    )
    presets = list(session.exec(stmt).all())
    for preset in presets:
        preset.is_favorite = False
        session.add(preset)
    session.flush()


def set_preset_favorite(
    *,
    session: Session,
    preset: SavedPreset,
    is_favorite: bool,
    now: datetime,
) -> SavedPreset:
    preset.is_favorite = is_favorite
    preset.updated_at = now
    session.add(preset)
    session.flush()
    return preset


def delete_user_preset(
    *,
    session: Session,
    user_id: UUID,
    preset_id: UUID,
) -> bool:
    preset = get_user_preset_by_id(
        session=session,
        user_id=user_id,
        preset_id=preset_id,
    )
    if preset is None:
        return False
    session.delete(preset)
    session.flush()
    return True
