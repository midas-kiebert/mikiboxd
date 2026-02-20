from datetime import datetime
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, and_, col, delete, or_, select

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
    now: datetime,
) -> FilterPreset:
    preset = FilterPreset(
        owner_user_id=user_id,
        name=name,
        scope=scope,
        is_default=False,
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
    now: datetime,
) -> FilterPreset:
    preset.filters = filters
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
    stmt = delete(FilterPreset).where(
        col(FilterPreset.id) == preset_id,
        col(FilterPreset.owner_user_id) == user_id,
    )
    result = session.exec(stmt)
    return result.rowcount > 0
