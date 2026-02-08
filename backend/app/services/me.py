from logging import getLogger
from uuid import UUID

from psycopg.errors import UniqueViolation
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.converters import user as user_converters
from app.crud import push_token as push_tokens_crud
from app.crud import user as users_crud
from app.exceptions.base import AppError
from app.exceptions.user_exceptions import EmailAlreadyExists
from app.models.user import User, UserUpdate
from app.schemas.user import UserPublic

logger = getLogger(__name__)


def update_me(
    *,
    session: Session,
    user_in: UserUpdate,
    current_user: User,
) -> UserPublic:
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
    user_public = user_converters.to_public(current_user)
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
