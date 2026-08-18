from datetime import datetime
from typing import TYPE_CHECKING

from pydantic import BaseModel, computed_field

from app.core.enums import GoingStatus
from app.models.movie import MovieBase
from app.schemas.legacy_viewer_compat import LEGACY_VIEWER_FIELD

if TYPE_CHECKING:
    from .cinema import CinemaPublic
    from .showtime import ShowtimeInMoviePublic
    from .user import UserPublic

__all__ = [
    "MovieInShowtime",
    "MovieSummaryPublic",
    "MovieSummaryViewerState",
    "MoviePublic",
    "MovieViewerState",
]


class MovieInShowtime(MovieBase):
    pass


class MovieSummaryViewerState(BaseModel):
    """What a movie card means to the person who asked for it.

    Same reasoning as `ShowtimeViewerState`: everything here is about the
    requester rather than the film, so it is carried apart from it and is
    absent — not empty — when there is no requester.
    """

    going: GoingStatus
    friends_going: list["UserPublic"] = []
    friends_interested: list["UserPublic"] = []


class MovieViewerState(BaseModel):
    """What a movie page means to the person who asked for it."""

    friends_watchlisted: list["UserPublic"] = []
    friends_watched: list["UserPublic"] = []


class MovieSummaryPublic(MovieBase):
    """A movie card: the film, and the screenings it currently has."""

    showtimes: list["ShowtimeInMoviePublic"]
    cinemas: list["CinemaPublic"]
    last_showtime_datetime: datetime | None
    total_showtimes: int
    original_title: str | None = None
    release_year: int | None = None
    directors: list[str] | None = None
    viewer: "MovieSummaryViewerState | None" = None

    # --- LEGACY_VIEWER_FIELDS: delete this whole block with the shim ---
    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def going(self) -> GoingStatus:
        return self.viewer.going if self.viewer else GoingStatus.NOT_GOING

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def friends_going(self) -> list["UserPublic"]:
        return self.viewer.friends_going if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def friends_interested(self) -> list["UserPublic"]:
        return self.viewer.friends_interested if self.viewer else []

    # --- end LEGACY_VIEWER_FIELDS ---


class MoviePublic(MovieBase):
    """A movie page: the film, and every screening matching the filters."""

    showtimes: list["ShowtimeInMoviePublic"]
    original_title: str | None = None
    release_year: int | None = None
    directors: list[str] | None = None
    viewer: "MovieViewerState | None" = None

    # --- LEGACY_VIEWER_FIELDS: delete this whole block with the shim ---
    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def friends_watchlisted(self) -> list["UserPublic"]:
        return self.viewer.friends_watchlisted if self.viewer else []

    @computed_field(deprecated=LEGACY_VIEWER_FIELD)  # type: ignore[prop-decorator]  # known mypy false positive: python/mypy#1362
    @property
    def friends_watched(self) -> list["UserPublic"]:
        return self.viewer.friends_watched if self.viewer else []

    # --- end LEGACY_VIEWER_FIELDS ---
