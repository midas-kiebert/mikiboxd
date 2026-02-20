from logging import getLogger
from uuid import UUID

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.converters import user as user_converters
from app.core.enums import FilterPresetScope
from app.crud import filter_preset as filter_presets_crud
from app.crud import push_token as push_tokens_crud
from app.crud import user as users_crud
from app.exceptions.base import AppError
from app.exceptions.user_exceptions import EmailAlreadyExists
from app.models.filter_preset import FilterPreset
from app.models.user import User, UserUpdate
from app.schemas.filter_preset import FilterPresetCreate, FilterPresetPublic
from app.schemas.user import UserMe
from app.utils import now_amsterdam_naive

logger = getLogger(__name__)


def update_me(
    *,
    session: Session,
    user_in: UserUpdate,
    current_user: User,
) -> UserMe:
    try:
        users_crud.update_user(
            session=session,
            db_user=current_user,
            user_in=user_in,
        )
    except IntegrityError as e:
        if isinstance(e.orig, UniqueViolation):
            assert user_in.email is not None
            raise EmailAlreadyExists(user_in.email) from e
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
    existing = filter_presets_crud.get_user_preset_by_name(
        session=session,
        user_id=user_id,
        scope=payload.scope,
        name=preset_name,
    )

    if existing is None:
        preset = filter_presets_crud.create_preset(
            session=session,
            user_id=user_id,
            name=preset_name,
            scope=payload.scope,
            filters=filters,
            now=now,
        )
    else:
        preset = filter_presets_crud.update_preset(
            session=session,
            preset=existing,
            filters=filters,
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
