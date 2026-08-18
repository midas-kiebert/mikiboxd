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

import hmac
from collections.abc import Generator
from contextlib import contextmanager
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import APIKeyHeader, OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from pydantic import ValidationError
from sqlmodel import Session

from app.core import security
from app.core.config import settings
from app.core.db import engine
from app.core.viewer import ViewerId
from app.models.auth_schemas import TokenPayload
from app.models.user import User

# Tells FastAPI that this API uses Bearer token authentication.
# The tokenUrl is only used to generate the OpenAPI "Authorize" button in the
# docs UI — it points at the login endpoint that issues tokens.
reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token"
)

# Same scheme, but a missing Authorization header yields None instead of a 401.
# Used by the browse endpoints, which serve signed-out visitors too — see
# `MaybeCurrentUser` below.
optional_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token",
    auto_error=False,
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
OptionalTokenDep = Annotated[str | None, Depends(optional_oauth2)]


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
        HTTPException 401: If the token is missing, expired, tampered with, or
            names a user that no longer exists in the DB.
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
        # A 401 rather than a 404, because this is a dead credential, not a
        # missing resource: the token decodes fine but names a user that no
        # longer exists (deleted account, or a staging DB reseeded from prod
        # under a session that was signed in before the reseed). As a 404 the
        # client could not tell it apart from a genuinely missing resource, so
        # it kept retrying with a token that would never work again and the app
        # was stuck — unable to reach a state from which it could even log out.
        # 401 puts it on the refresh path, and /login/refresh-token rejects a
        # missing user too, so the session clears and the app returns to login.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


# Shorthand for routes that require an authenticated user.
# Declare this as a parameter type and FastAPI injects the current user:
#   def my_route(user: CurrentUser): ...
CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_user_optional(
    session: SessionDep, token: OptionalTokenDep
) -> User | None:
    """Return the authenticated User, or None when the request carries no token.

    For the browse endpoints, which serve the public catalogue to signed-out
    visitors and the same catalogue *annotated* to signed-in ones — see
    `app.core.viewer`.

    A token that is present but bad is still a 401: the caller believes it has
    a session, and silently downgrading it to anonymous would hide an expired
    login behind a page that looks signed-out but never says so, with no 401 to
    put the client on its refresh path.

    Args:
        session: Injected DB session (from get_db).
        token:   The raw JWT string, or None if no Authorization header was sent.

    Returns:
        The authenticated User, or None for an anonymous visitor.

    Raises:
        HTTPException: Whatever `get_current_user` raises for a token that was
            sent but is not usable.
    """
    if token is None:
        return None
    return get_current_user(session=session, token=token)


# Shorthand for routes that serve signed-out visitors as well as signed-in ones
# and need the whole User. Most only need who is asking, so they declare
# `CurrentViewer` below instead.
MaybeCurrentUser = Annotated[User | None, Depends(get_current_user_optional)]


def get_viewer_id(current_user: MaybeCurrentUser) -> ViewerId:
    """Who this request is being answered for — None when nobody is signed in."""
    return current_user.id if current_user is not None else None


# Declare this on a browse route and pass it straight down to the service layer:
#   def read_movies(session: SessionDep, viewer: CurrentViewer): ...
CurrentViewer = Annotated[ViewerId, Depends(get_viewer_id)]

# FastAPI derives one security requirement per scheme and has no way to say
# "the token is optional" — `auto_error=False` changes the runtime behaviour
# but not the generated schema, which still documents these routes as requiring
# a bearer token. An empty requirement is how OpenAPI spells "or no credentials
# at all"; FastAPI appends `openapi_extra`'s entries to the ones it derived, so
# the published requirement ends up "bearer token, or nothing". Pass this on
# every route that takes a `CurrentViewer`, so the contract says out loud what
# the code does.
OPTIONAL_AUTH_OPENAPI_EXTRA: dict[str, Any] = {"security": [{}]}


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


scrape_monitor_api_key_header = APIKeyHeader(name="X-Monitor-Api-Key", auto_error=False)


def verify_scrape_monitor_api_key(
    api_key: Annotated[str | None, Depends(scrape_monitor_api_key_header)],
) -> None:
    """Gate the /monitor/scrape/* routes with a static bearer key instead of a
    user JWT, for machine consumers (e.g. an unattended monitoring agent) that
    can't hold a login session.

    Raises:
        HTTPException 401: If SCRAPE_MONITOR_API_KEY isn't configured, or the
            header is missing or doesn't match.
    """
    configured_key = settings.SCRAPE_MONITOR_API_KEY
    if (
        not configured_key
        or not api_key
        or not hmac.compare_digest(api_key, configured_key)
    ):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")
