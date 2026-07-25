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
"""

from collections.abc import Awaitable, Callable

from fastapi import Request, Response, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.client_version import is_supported
from app.core.config import settings

CLIENT_VERSION_HEADER = "X-Client-Version"
CLIENT_PLATFORM_HEADER = "X-Client-Platform"

# Only these platform header values are native builds distributed through an
# app store and thus subject to the gate.
_GATED_PLATFORMS = {"ios", "android"}

_STORE_URLS = {
    "ios": lambda: settings.APP_STORE_URL_IOS,
    "android": lambda: settings.APP_STORE_URL_ANDROID,
}


class ClientVersionGateMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        min_version = settings.MIN_SUPPORTED_CLIENT_VERSION
        platform = request.headers.get(CLIENT_PLATFORM_HEADER)

        if min_version is None or platform not in _GATED_PLATFORMS:
            return await call_next(request)

        client_version = request.headers.get(CLIENT_VERSION_HEADER, "")
        if is_supported(client_version, min_version):
            return await call_next(request)

        store_url = _STORE_URLS[platform]()
        return JSONResponse(
            status_code=status.HTTP_426_UPGRADE_REQUIRED,
            content={
                "detail": "This app version is no longer supported. Please update to continue.",
                "min_supported_version": min_version,
                "store_url": str(store_url) if store_url else None,
            },
        )
