from datetime import datetime
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, and_, col, or_, select

from app.core.enums import FilterPresetScope
from app.models.filter_preset import FilterPreset


def get_visible_presets(
    *,
    session: Session,
    user_id: UUID,
    scope: FilterPresetScope,
) -> list[FilterPreset]:
    stmt = (
        select(FilterPreset)
        .where(
            col(FilterPreset.scope) == scope,
            or_(
                col(FilterPreset.owner_user_id) == user_id,
                and_(
                    col(FilterPreset.owner_user_id).is_(None),
                    col(FilterPreset.is_default).is_(True),
                ),
            ),
        )
        .order_by(
            col(FilterPreset.is_default).desc(),
            col(FilterPreset.is_favorite).desc(),
            func.lower(col(FilterPreset.name)),
            col(FilterPreset.created_at),
        )
    )
    return list(session.exec(stmt).all())


def get_user_preset_by_name(
    *,
    session: Session,
    user_id: UUID,
    scope: FilterPresetScope,
    name: str,
) -> FilterPreset | None:
    stmt = select(FilterPreset).where(
        col(FilterPreset.owner_user_id) == user_id,
        col(FilterPreset.scope) == scope,
        col(FilterPreset.name) == name,
    )
    return session.exec(stmt).one_or_none()


def get_user_favorite_preset(
    *,
    session: Session,
    user_id: UUID,
    scope: FilterPresetScope,
) -> FilterPreset | None:
    stmt = select(FilterPreset).where(
        col(FilterPreset.owner_user_id) == user_id,
        col(FilterPreset.scope) == scope,
        col(FilterPreset.is_favorite).is_(True),
    )
    return session.exec(stmt).one_or_none()


def get_user_preset_by_id(
    *,
    session: Session,
    user_id: UUID,
    preset_id: UUID,
) -> FilterPreset | None:
    stmt = select(FilterPreset).where(
        col(FilterPreset.id) == preset_id,
        col(FilterPreset.owner_user_id) == user_id,
    )
    return session.exec(stmt).one_or_none()


def create_preset(
    *,
    session: Session,
    user_id: UUID,
    name: str,
    scope: FilterPresetScope,
    filters: dict,
    is_favorite: bool,
    now: datetime,
) -> FilterPreset:
    preset = FilterPreset(
        owner_user_id=user_id,
        name=name,
        scope=scope,
        is_default=False,
        is_favorite=is_favorite,
        filters=filters,
        created_at=now,
        updated_at=now,
    )
    session.add(preset)
    session.flush()
    return preset


def update_preset(
    *,
    session: Session,
    preset: FilterPreset,
    filters: dict,
    is_favorite: bool | None,
    now: datetime,
) -> FilterPreset:
    preset.filters = filters
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
    stmt = select(FilterPreset).where(
        col(FilterPreset.owner_user_id) == user_id,
        col(FilterPreset.scope) == scope,
        col(FilterPreset.is_favorite).is_(True),
    )
    presets = list(session.exec(stmt).all())
    for preset in presets:
        preset.is_favorite = False
        session.add(preset)
    session.flush()


def set_preset_favorite(
    *,
    session: Session,
    preset: FilterPreset,
    is_favorite: bool,
    now: datetime,
) -> FilterPreset:
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
    stmt = select(FilterPreset).where(
        col(FilterPreset.id) == preset_id,
        col(FilterPreset.owner_user_id) == user_id,
    )
    preset = session.exec(stmt).one_or_none()
    if preset is None:
        return False
    session.delete(preset)
    session.flush()
    return True
