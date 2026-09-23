from typing import TYPE_CHECKING

from pydantic import BaseModel

from app.core.enums import FeedOverviewSectionKind

if TYPE_CHECKING:
    from .showtime import ShowtimePublic

__all__ = [
    "FeedOverviewPublic",
    "FeedOverviewSection",
]


class FeedOverviewSection(BaseModel):
    kind: FeedOverviewSectionKind
    showtimes: list["ShowtimePublic"]


class FeedOverviewPublic(BaseModel):
    """The website's feed overview: a few short lists, most urgent first.

    Only sections with something in them are sent, already trimmed to what
    fits — see `services.feed_overview` for the budget.
    """

    sections: list[FeedOverviewSection]
