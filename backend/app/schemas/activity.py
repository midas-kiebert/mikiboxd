from datetime import date
from typing import TYPE_CHECKING

from pydantic import BaseModel

if TYPE_CHECKING:
    from .showtime import ShowtimePublic
    from .user import UserPublic

__all__ = [
    "ActivityDayCount",
    "ActivityFriendTally",
    "ActivitySummaryPublic",
]


class ActivityDayCount(BaseModel):
    """How many showtimes on the list fall on one day.

    `day` is the evening the showtimes belong to: a screening before 04:00
    counts towards the day before, as both clients group it.
    """

    day: date
    count: int


class ActivityFriendTally(BaseModel):
    user: "UserPublic"
    going: int
    interested: int


class ActivitySummaryPublic(BaseModel):
    """The numbers beside the Activity list, counted over the whole list.

    Asked of the server rather than read off the loaded rows, so nothing grows
    as the list is scrolled. Sections that do not apply to a mode are empty:
    your plans and invites for Friends, the friend ranking for You.
    """

    days: list[ActivityDayCount]
    total: int
    next_plan: "ShowtimePublic | None"
    plan_count: int
    invites: list["ShowtimePublic"]
    invite_count: int
    friends: list[ActivityFriendTally]
