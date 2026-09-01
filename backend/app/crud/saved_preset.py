from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.crud import cinema_preset as cinema_preset_crud
from app.crud.cinema_scope import parse_cinema_scope, resolve_cinema_scope
from app.models.saved_preset import SavedPreset


def list_user_presets(
    *,
    session: Session,
    user_id: UUID,
) -> list[SavedPreset]:
    stmt = (
        select(SavedPreset)
        .where(col(SavedPreset.owner_user_id) == user_id)
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
    name: str,
) -> SavedPreset | None:
    stmt = select(SavedPreset).where(
        col(SavedPreset.owner_user_id) == user_id,
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
) -> SavedPreset | None:
    stmt = select(SavedPreset).where(
        col(SavedPreset.owner_user_id) == user_id,
        col(SavedPreset.is_favorite).is_(True),
    )
    return session.exec(stmt).one_or_none()


def create_preset(
    *,
    session: Session,
    user_id: UUID,
    name: str,
    untouched_fields: list[str],
    filters: dict[str, Any],
    cinema_ids: list[int] | None,
    cinema_scope: dict[str, Any] | None,
    cinema_preset_id: UUID | None = None,
    is_favorite: bool,
    now: datetime,
) -> SavedPreset:
    preset = SavedPreset(
        owner_user_id=user_id,
        name=name,
        is_favorite=is_favorite,
        untouched_fields=untouched_fields,
        filters=filters,
        cinema_ids=cinema_ids,
        cinema_scope=cinema_scope,
        cinema_preset_id=cinema_preset_id,
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
    untouched_fields: list[str],
    filters: dict[str, Any],
    cinema_ids: list[int] | None,
    cinema_scope: dict[str, Any] | None,
    cinema_preset_id: UUID | None = None,
    is_favorite: bool | None,
    now: datetime,
) -> SavedPreset:
    preset.untouched_fields = untouched_fields
    preset.filters = filters
    preset.cinema_ids = cinema_ids
    preset.cinema_scope = cinema_scope
    preset.cinema_preset_id = cinema_preset_id
    if is_favorite is not None:
        preset.is_favorite = is_favorite
    preset.updated_at = now
    session.add(preset)
    session.flush()
    return preset


def resolve_preset_cinema_ids(
    *,
    session: Session,
    preset: SavedPreset,
) -> list[int] | None:
    """The preset's cinemas expanded against today's cinema list.

    ``None`` stays ``None``: a preset with no cinema selection leaves the
    user's cinemas alone, and must not be turned into one that selects some.

    A preset that follows a `CinemaPreset` (``cinema_preset_id`` set) reads
    that preset's cinemas live, so editing the cinema preset changes this
    one's resolved cinemas too. If the linked preset has been deleted, this
    converts the saved preset back to its own raw snapshot permanently —
    clearing the dangling reference — rather than re-checking a preset that
    is gone on every future read.
    """
    if preset.cinema_preset_id is not None:
        cinema_preset = cinema_preset_crud.get_user_preset_by_id(
            session=session,
            user_id=preset.owner_user_id,
            preset_id=preset.cinema_preset_id,
        )
        if cinema_preset is not None:
            return (
                cinema_preset_crud.resolve_preset_cinema_ids(
                    session=session, preset=cinema_preset
                )
                or []
            )
        preset.cinema_preset_id = None
        session.add(preset)
        session.commit()
    if preset.cinema_ids is None:
        return None
    return resolve_cinema_scope(
        session=session,
        scope=parse_cinema_scope(preset.cinema_scope),
        stored_cinema_ids=list(preset.cinema_ids),
    )


def clear_user_favorite_preset(
    *,
    session: Session,
    user_id: UUID,
) -> None:
    stmt = select(SavedPreset).where(
        col(SavedPreset.owner_user_id) == user_id,
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


def clear_cinema_preset_link(
    *,
    session: Session,
    user_id: UUID,
    cinema_preset_id: UUID,
) -> None:
    """Detach every saved preset following this cinema preset, permanently.

    Called right before the cinema preset itself is deleted, so a saved
    preset converts to its own raw `cinema_ids`/`cinema_scope` snapshot
    immediately rather than waiting for the next read to notice the dangling
    reference (see `resolve_preset_cinema_ids`).
    """
    stmt = select(SavedPreset).where(
        col(SavedPreset.owner_user_id) == user_id,
        col(SavedPreset.cinema_preset_id) == cinema_preset_id,
    )
    for preset in session.exec(stmt).all():
        preset.cinema_preset_id = None
        session.add(preset)
    session.flush()


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
