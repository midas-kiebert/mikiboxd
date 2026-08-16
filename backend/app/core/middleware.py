"""Client-version gate middleware.

Rejects requests from mobile app builds older than
`settings.MIN_SUPPORTED_CLIENT_VERSION` with a 426 Upgrade Required, so a
breaking API change (an endpoint removed/renamed, a response shape changed
non-additively) can't strand users on a native build that no longer
understands the response — instead of a confusing empty screen, the app gets
a machine-readable signal it can turn into a "please update" prompt.

Only native builds are gated: the web frontend (`X-Client-Platform: web`)
ships instantly on deploy, so it can never be stale in the way a store-gated
native build can.

Each platform carries its own floor, because iOS and Android are never on the
same version at the same time — App Store review is measured in weeks and Play
review in days, so a single shared floor would hold the faster store hostage to
the slower one. Reach for this only when a change genuinely cannot be served to
an old build; an additive response (see `app.schemas.legacy_viewer_compat`)
avoids the wall entirely and needs no store coordination at all.
"""

from collections.abc import Awaitable, Callable

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse
from pydantic import HttpUrl
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.client_version import is_supported
from app.core.config import settings

CLIENT_VERSION_HEADER = "X-Client-Version"
CLIENT_PLATFORM_HEADER = "X-Client-Platform"

# The platform header values that identify a native build distributed through
# an app store, and thus the only ones subject to the gate. Read lazily so a
# settings change takes effect without reimporting the module.
_GATED_PLATFORMS: dict[str, Callable[[], tuple[str | None, HttpUrl | None]]] = {
    "ios": lambda: (
        settings.MIN_SUPPORTED_CLIENT_VERSION_IOS,
        settings.APP_STORE_URL_IOS,
    ),
    "android": lambda: (
        settings.MIN_SUPPORTED_CLIENT_VERSION_ANDROID,
        settings.APP_STORE_URL_ANDROID,
    ),
}


class ClientVersionGateMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        platform_gate = _GATED_PLATFORMS.get(
            request.headers.get(CLIENT_PLATFORM_HEADER, "")
        )
        if platform_gate is None:
            return await call_next(request)

        min_version, store_url = platform_gate()
        if min_version is None:
            return await call_next(request)

        client_version = request.headers.get(CLIENT_VERSION_HEADER, "")
        if is_supported(client_version, min_version):
            return await call_next(request)

        return JSONResponse(
            status_code=status.HTTP_426_UPGRADE_REQUIRED,
            content={
                "detail": "This app version is no longer supported. Please update to continue.",
                "min_supported_version": min_version,
                "store_url": str(store_url) if store_url else None,
            },
        )
