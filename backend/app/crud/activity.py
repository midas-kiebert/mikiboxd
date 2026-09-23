"""Queries behind the Activity screen's summary: counts over the whole list,
not over whichever rows a client happens to have loaded.

The list's own rows come from `crud.showtime` (the main-page query for All and
Friends, the agenda for You); the per-day counts live beside those builders so
they share them. What is here is the rest of the summary: your plans, the
invites you have not answered, and which friends are behind the most of it.
"""

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import distinct, func
from sqlalchemy.orm import aliased
from sqlmodel import Session, col, select

from app.core.enums import GoingStatus
from app.crud.showtime import ACTIVE_GOING_STATUSES
from app.models.showtime import Showtime
from app.models.showtime_ping import ShowtimePing
from app.models.showtime_selection import ShowtimeSelection
from app.models.showtime_visibility import ShowtimeVisibilityEffective
from app.models.user import User


@dataclass(frozen=True)
class FriendTally:
    user_id: UUID
    going: int
    interested: int


def _viewer_plans_query(*, user_id: UUID, now: datetime):
    return (
        select(Showtime)
        .join(ShowtimeSelection, col(ShowtimeSelection.showtime_id) == col(Showtime.id))
        .where(
            col(ShowtimeSelection.user_id) == user_id,
            col(ShowtimeSelection.going_status).in_(ACTIVE_GOING_STATUSES),
            col(Showtime.datetime) >= now,
        )
    )


def get_next_plan(*, session: Session, user_id: UUID, now: datetime) -> Showtime | None:
    """The viewer's soonest upcoming going/interested showtime."""
    stmt = (
        _viewer_plans_query(user_id=user_id, now=now)
        .order_by(col(Showtime.datetime))
        .limit(1)
    )
    return session.exec(stmt).first()


def count_plans(*, session: Session, user_id: UUID, now: datetime) -> int:
    """How many upcoming showtimes the viewer is going to or interested in."""
    stmt = select(func.count()).select_from(
        _viewer_plans_query(user_id=user_id, now=now).subquery()
    )
    return session.execute(stmt).scalar_one()


def count_unanswered_invites(*, session: Session, user_id: UUID, now: datetime) -> int:
    """Upcoming showtimes with an open invite and no going/interested answer.

    The same set `crud.feed_overview.get_unanswered_invited_showtimes` lists.
    """
    invited_ids = select(ShowtimePing.showtime_id).where(
        col(ShowtimePing.receiver_id) == user_id,
        col(ShowtimePing.dismissed_at).is_(None),
    )
    answered_ids = select(ShowtimeSelection.showtime_id).where(
        col(ShowtimeSelection.user_id) == user_id,
        col(ShowtimeSelection.going_status).in_(ACTIVE_GOING_STATUSES),
    )
    stmt = select(func.count()).where(
        col(Showtime.datetime) >= now,
        col(Showtime.id).in_(invited_ids),
        col(Showtime.id).not_in(answered_ids),
    )
    return session.execute(stmt).scalar_one()


def get_friend_tallies(
    *,
    session: Session,
    user_id: UUID,
    friend_ids: set[UUID],
    now: datetime,
    limit: int,
) -> list[FriendTally]:
    """Friends by how many upcoming showtimes they are going to / interested in.

    Only selections the viewer is allowed to see (an effective-visibility row
    for them), which is exactly what puts a friend's selection on the list —
    see `status_owner_clause` with `friends_only`. Most selections first, then
    most "going", so firm plans outrank maybes.
    """
    if not friend_ids:
        return []
    visible_row = aliased(ShowtimeVisibilityEffective)
    going = func.count(distinct(col(ShowtimeSelection.showtime_id))).filter(
        col(ShowtimeSelection.going_status) == GoingStatus.GOING
    )
    interested = func.count(distinct(col(ShowtimeSelection.showtime_id))).filter(
        col(ShowtimeSelection.going_status) == GoingStatus.INTERESTED
    )
    stmt = (
        select(col(ShowtimeSelection.user_id), going, interested)
        .join(Showtime, col(Showtime.id) == col(ShowtimeSelection.showtime_id))
        .join(
            visible_row,
            (col(visible_row.owner_id) == col(ShowtimeSelection.user_id))
            & (col(visible_row.showtime_id) == col(Showtime.id))
            & (col(visible_row.viewer_id) == user_id),
        )
        .where(
            col(ShowtimeSelection.user_id).in_(friend_ids),
            col(ShowtimeSelection.going_status).in_(ACTIVE_GOING_STATUSES),
            col(Showtime.datetime) >= now,
        )
        .group_by(col(ShowtimeSelection.user_id))
        .order_by((going + interested).desc(), going.desc())
        .limit(limit)
    )
    return [
        FriendTally(user_id=row[0], going=row[1], interested=row[2])
        for row in session.execute(stmt).all()
    ]


def get_users_by_ids(*, session: Session, user_ids: list[UUID]) -> dict[UUID, User]:
    if not user_ids:
        return {}
    users = session.exec(select(User).where(col(User.id).in_(user_ids))).all()
    return {user.id: user for user in users}
