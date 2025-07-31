from fastapi import APIRouter

from app.api.routes import (
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
