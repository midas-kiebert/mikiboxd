"""Authentication and password management endpoints."""

import logging
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from fastapi import status as http_status
from fastapi.security import OAuth2PasswordRequestForm

from app.api.deps import SessionDep
from app.core.config import settings
from app.core.security import (
    create_access_token,
    generate_password_reset_token,
    get_password_hash,
    verify_password_reset_token,
)
from app.crud import user as users_crud
from app.mailer import EmailDeliveryError, generate_reset_password_email, send_email
from app.models.auth_schemas import Message, NewPassword, Token

router = APIRouter(tags=["login"])
logger = logging.getLogger(__name__)


@router.post("/login/access-token")
def login_access_token(
    session: SessionDep, form_data: Annotated[OAuth2PasswordRequestForm, Depends()]
) -> Token:
    """Authenticate a user and return a JWT access token.

    Uses OAuth2 password flow — credentials are submitted as form data.
    The returned token should be included in subsequent requests as:
        Authorization: Bearer <token>
    """
    user = users_crud.authenticate(
        session=session, email=form_data.username, password=form_data.password
    )
    if not user:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Incorrect email or password",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Inactive user",
        )
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return Token(
        access_token=create_access_token(user.id, expires_delta=access_token_expires)
    )


@router.post("/password-recovery/{email}")
def recover_password(email: str, session: SessionDep) -> Message:
    """Send a password reset email to the given address.

    Always returns 200 regardless of whether the email exists, to prevent
    user enumeration attacks.
    """
    user = users_crud.get_user_by_email(session=session, email=email)
    if not user:
        # Return success without sending to avoid leaking account existence.
        return Message(
            message="If that email is registered, a recovery link has been sent."
        )
    password_reset_token = generate_password_reset_token(email=email)
    email_data = generate_reset_password_email(
        email_to=user.email, email=email, token=password_reset_token
    )
    try:
        send_email(
            email_to=user.email,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
    except EmailDeliveryError as e:
        logger.exception("Password recovery email delivery failed for %s", user.email)
        raise HTTPException(
            status_code=http_status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not deliver password recovery email: {e}",
        ) from e
    return Message(
        message="If that email is registered, a recovery link has been sent."
    )


@router.post("/reset-password/")
def reset_password(session: SessionDep, body: NewPassword) -> Message:
    """Reset the user's password using a valid password reset token."""
    email = verify_password_reset_token(token=body.token)
    if not email:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Invalid token",
        )
    user = users_crud.get_user_by_email(session=session, email=email)
    if not user:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="The user with this email does not exist in the system.",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Inactive user",
        )
    user.hashed_password = get_password_hash(password=body.new_password)
    session.add(user)
    session.commit()
    return Message(message="Password updated successfully")
