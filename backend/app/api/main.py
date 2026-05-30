"""API router composition.

Mounts all route modules onto a single `api_router`, which is included in the
FastAPI app in `app/main.py` under the `/api/` prefix.
"""

from fastapi import APIRouter

from app.api.routes import (
    cinemas,
    friends,
    login,
    me,
    movies,
    showtimes,
    users,
    utils,
)

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(movies.router)
api_router.include_router(showtimes.router)
api_router.include_router(friends.router)
api_router.include_router(me.router)
api_router.include_router(cinemas.router)
