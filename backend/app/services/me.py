from logging import getLogger

from sqlmodel import Session

from app.converters import user as user_converters
from app.crud import user as users_crud
from app.exceptions.user_exceptions import EmailAlreadyExists
from app.models.auth_schemas import UserUpdateMe
from app.models.user import User
from app.schemas.user import UserPublic

logger = getLogger(__name__)

def update_me(
    *,
    session: Session,
    user_in: UserUpdateMe,
    current_user: User,
) -> UserPublic:
    if user_in.email:
        existing_user = users_crud.get_user_by_email(
            session=session, email=user_in.email
        )
        if existing_user is not None and existing_user.id != current_user.id:
            raise EmailAlreadyExists(user_in.email)
    user_data = user_in.model_dump(exclude_unset=True)
    current_user.sqlmodel_update(user_data)
    session.commit()
    user_public = user_converters.to_public(current_user)
    return user_public
