from logging import getLogger

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse

from .base import AppError

logger = getLogger(__name__)


def register_exception_handlers(app: FastAPI):
    @app.exception_handler(AppError)
    async def app_error_handler(_: Request, exc: AppError):
        logger.warning(f" {exc.status_code} Error: {exc.detail}")
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.exception_handler(Exception)
    async def generic_exception_handler(_: Request, __: Exception):
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "An unexpected error occurred."},
        )
