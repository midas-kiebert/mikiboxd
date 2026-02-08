from typing import Literal

from pydantic import BaseModel, Field

__all__ = [
    "PushTokenRegister",
]


class PushTokenRegister(BaseModel):
    token: str = Field(min_length=1, max_length=255)
    platform: Literal["ios", "android", "web"] | None = None
