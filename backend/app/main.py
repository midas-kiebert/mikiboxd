"""FastAPI application factory.

This module creates the `app` instance and wires everything together:
  - Sentry error tracking (production/staging only)
  - CORS middleware (controls which origins can call the API)
  - API router (all endpoints under /api/v1)
  - Exception handlers (converts domain exceptions to HTTP responses)
"""

from logging import getLogger

import sentry_sdk
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

from app.api.main import api_router
from app.core.config import settings
from app.core.enums import Environment
from app.exceptions.base import AppError

logger = getLogger(__name__)


def _generate_operation_id(route: APIRoute) -> str:
    """Generate a unique operation ID for each route in the OpenAPI schema.

    The ID is used by the TypeScript client generator (openapi-ts) to name the
    generated functions. Format: "<tag>-<route_name>", e.g. "movies-list_movies".
    """
    return f"{route.tags[0]}-{route.name}"


# Sentry captures unhandled exceptions and sends them to the Sentry dashboard,
# including the full stack trace and request context. Only enabled outside local
# development so you don't pollute the project with dev noise.
if settings.SENTRY_DSN and settings.ENVIRONMENT is not Environment.LOCAL:
    sentry_sdk.init(dsn=str(settings.SENTRY_DSN), enable_tracing=True)

app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    generate_unique_id_function=_generate_operation_id,
)

# Allow browsers from whitelisted origins to make cross-origin requests.
# Configured via BACKEND_CORS_ORIGINS and FRONTEND_HOST in settings.
if settings.all_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

if settings.ENABLE_GZIP:
    app.add_middleware(
        GZipMiddleware,
        minimum_size=settings.GZIP_MINIMUM_SIZE_BYTES,
        compresslevel=settings.GZIP_COMPRESS_LEVEL,
    )

app.include_router(api_router, prefix=settings.API_V1_STR)

@app.exception_handler(AppError)
async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    """Convert domain exceptions (AppError subclasses) to JSON HTTP responses."""
    logger.warning(f"{exc.status_code} Error: {exc.detail}")
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.exception_handler(Exception)
async def generic_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    """Catch-all for unhandled exceptions — returns a generic 500 response.

    Note: if Sentry is enabled, call sentry_sdk.capture_exception(exc) here
    before returning, otherwise Sentry never sees exceptions caught by this handler.
    """
    logger.error("Unexpected error", exc_info=exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={"detail": "An unexpected error occurred."},
    )
