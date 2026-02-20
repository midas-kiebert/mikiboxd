from datetime import datetime
from uuid import UUID

from sqlmodel import Session, col, select

from app.models.cinema_preset import CinemaPreset


def list_user_presets(
    *,
    session: Session,
    user_id: UUID,
) -> list[CinemaPreset]:
    stmt = (
        select(CinemaPreset)
        .where(col(CinemaPreset.owner_user_id) == user_id)
        .order_by(col(CinemaPreset.is_favorite).desc(), col(CinemaPreset.name))
    )
    return list(session.exec(stmt).all())


def get_user_preset_by_name(
    *,
    session: Session,
    user_id: UUID,
    name: str,
) -> CinemaPreset | None:
    stmt = select(CinemaPreset).where(
        col(CinemaPreset.owner_user_id) == user_id,
        col(CinemaPreset.name) == name,
    )
    return session.exec(stmt).one_or_none()


def get_user_preset_by_id(
    *,
    session: Session,
    user_id: UUID,
    preset_id: UUID,
) -> CinemaPreset | None:
    stmt = select(CinemaPreset).where(
        col(CinemaPreset.owner_user_id) == user_id,
        col(CinemaPreset.id) == preset_id,
    )
    return session.exec(stmt).one_or_none()


def get_user_favorite_preset(
    *,
    session: Session,
    user_id: UUID,
) -> CinemaPreset | None:
    stmt = select(CinemaPreset).where(
        col(CinemaPreset.owner_user_id) == user_id,
        col(CinemaPreset.is_favorite).is_(True),
    )
    return session.exec(stmt).one_or_none()


def get_favorite_cinema_ids(
    *,
    session: Session,
    user_id: UUID,
) -> list[int]:
    favorite = get_user_favorite_preset(
        session=session,
        user_id=user_id,
    )
    if favorite is None:
        return []
    return list(favorite.cinema_ids)


def create_preset(
    *,
    session: Session,
    user_id: UUID,
    name: str,
    cinema_ids: list[int],
    is_favorite: bool,
    now: datetime,
) -> CinemaPreset:
    preset = CinemaPreset(
        owner_user_id=user_id,
        name=name,
        cinema_ids=cinema_ids,
        is_favorite=is_favorite,
        created_at=now,
        updated_at=now,
    )
    session.add(preset)
    session.flush()
    return preset


def update_preset(
    *,
    session: Session,
    preset: CinemaPreset,
    cinema_ids: list[int],
    is_favorite: bool | None,
    now: datetime,
) -> CinemaPreset:
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
) -> None:
    stmt = select(CinemaPreset).where(
        col(CinemaPreset.owner_user_id) == user_id,
        col(CinemaPreset.is_favorite).is_(True),
    )
    favorites = list(session.exec(stmt).all())
    for favorite in favorites:
        favorite.is_favorite = False
        session.add(favorite)
    session.flush()


def set_preset_favorite(
    *,
    session: Session,
    preset: CinemaPreset,
    is_favorite: bool,
    now: datetime,
) -> CinemaPreset:
    preset.is_favorite = is_favorite
    preset.updated_at = now
    session.add(preset)
    session.flush()
    return preset


def delete_preset(
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
