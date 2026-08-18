from fastapi import status

from .base import AppError


class CinemaPresetNotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    detail = "Cinema preset not found."


class CinemaPresetNameRequired(AppError):
    status_code = status.HTTP_400_BAD_REQUEST
    detail = "Preset name cannot be empty."


class CinemaPresetNameTaken(AppError):
    status_code = status.HTTP_409_CONFLICT
    detail = "You already have a cinema preset with that name."
