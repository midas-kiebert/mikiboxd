"""FastAPI dependency functions.

FastAPI's dependency injection system lets route handlers declare what they need
as type-annotated parameters, and FastAPI resolves and provides them automatically.
This file defines the reusable dependencies used across the API.

Usage in a route:
    @router.get("/me")
    def read_me(user: CurrentUser, session: SessionDep) -> UserPublic:
        ...

FastAPI sees the type annotations, calls the corresponding dependency functions
(get_current_user, get_db), and passes the results into the route handler.
The session is automatically closed after the response is sent.

See: https://fastapi.tiangolo.com/tutorial/dependencies/
"""

from collections.abc import Generator
from contextlib import contextmanager
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from pydantic import ValidationError
from sqlmodel import Session

from app.core import security
from app.core.config import settings
from app.core.db import engine
from app.models.auth_schemas import TokenPayload
from app.models.user import User

# Tells FastAPI that this API uses Bearer token authentication.
# The tokenUrl is only used to generate the OpenAPI "Authorize" button in the
# docs UI — it points at the login endpoint that issues tokens.
reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token"
)


def get_db() -> Generator[Session, None, None]:
    """Open a database session for the duration of one request.

    This is a generator function used as a FastAPI dependency. FastAPI calls it
    before the route handler runs and closes the session (via the `with` block)
    after the response is sent — even if an exception is raised.

    Yields:
        An open SQLModel Session connected to the main database.
    """
    with Session(engine) as session:
        yield session


@contextmanager
def get_db_context() -> Generator[Session, None, None]:
    """Context manager wrapper around get_db for use outside FastAPI's DI system.

    FastAPI's dependency injection only works inside route handlers. For scripts
    and background tasks that need a DB session, use this as a regular context
    manager:

        with get_db_context() as session:
            session.exec(...)

    Yields:
        An open SQLModel Session connected to the main database.
    """
    yield from get_db()


# Type aliases — import these in route files instead of the full Annotated form.
# `SessionDep` gives you a DB session; `TokenDep` gives you the raw JWT string.
SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[str, Depends(reusable_oauth2)]


def get_current_user(session: SessionDep, token: TokenDep) -> User:
    """Decode the JWT and return the corresponding User from the database.

    FastAPI calls this automatically for any route that declares `CurrentUser`
    as a parameter. If the token is missing, expired, or invalid, a 401 is
    raised before the route handler runs.

    Args:
        session: Injected DB session (from get_db).
        token:   The raw JWT string extracted from the Authorization header.

    Returns:
        The authenticated User object.

    Raises:
        HTTPException 401: If the token is missing, expired, or tampered with.
        HTTPException 404: If the user ID in the token no longer exists in the DB.
        HTTPException 400: If the user account has been deactivated.
    """
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[security.ALGORITHM]
        )
        token_data = TokenPayload(**payload)
    except (InvalidTokenError, ValidationError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

    # Refresh tokens may only be exchanged at /login/refresh-token, never used as
    # bearer credentials. (Older access tokens predate the "type" claim and have
    # type=None, so they remain valid until they expire.)
    if token_data.type == "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

    user = session.get(User, token_data.sub)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


# Shorthand for routes that require an authenticated user.
# Declare this as a parameter type and FastAPI injects the current user:
#   def my_route(user: CurrentUser): ...
CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_active_superuser(current_user: CurrentUser) -> User:
    """Require that the current user is a superuser.

    Use this as a dependency on admin-only routes. Non-superusers receive a 403.

    Args:
        current_user: Injected from get_current_user (must be authenticated first).

    Returns:
        The current user, confirmed to be a superuser.

    Raises:
        HTTPException 403: If the user is not a superuser.
    """
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="The user doesn't have enough privileges"
        )
    return current_user
