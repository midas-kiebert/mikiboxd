"""The Activity screen's summary: the numbers beside the list, over the whole list.

The list itself is paged — the main-page showtimes for All and Friends, the
agenda for You — so a client counting its loaded rows shows numbers that grow
as it scrolls. This answers them once, from the same query builders the list
uses (`crud.showtime`), with the same arguments the clients send for each mode
(see `mobile/app/(tabs)/activity.tsx`):

  - **days** — how many showtimes on the list fall on each day;
  - **your next plan** and how many plans you have (All, You);
  - **invites** you have not answered (All, You);
  - **friends** ranked by how many upcoming showtimes they have marked
    (All, Friends).
"""

from collections.abc import Sequence
from datetime import datetime
from uuid import UUID

from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.converters import showtime_page as showtime_page_converters
from app.converters import user as user_converters
from app.core.enums import ActivityMode, GoingStatus
from app.crud import activity as activity_crud
from app.crud import feed_overview as feed_overview_crud
from app.crud import friendship as friendship_crud
from app.crud import showtime as showtimes_crud
from app.inputs.movie import Filters
from app.models.showtime import Showtime
from app.schemas.activity import (
    ActivityDayCount,
    ActivityFriendTally,
    ActivitySummaryPublic,
)
from app.schemas.showtime import ShowtimePublic
from app.services import viewer_context

# Unanswered invites shown by name; the rest are only counted.
MAX_INVITES = 3
# Friends ranked; past this the list is the place to look.
MAX_FRIENDS = 6


def _list_filters(*, mode: ActivityMode, snapshot_time: datetime) -> Filters:
    """The filters the clients send for All and Friends."""
    return Filters(
        snapshot_time=snapshot_time,
        selected_statuses=[GoingStatus.GOING, GoingStatus.INTERESTED],
        friends_only=mode == ActivityMode.FRIENDS,
        all_cinemas=True,
    )


def _day_counts(
    *, session: Session, user_id: UUID, mode: ActivityMode, snapshot_time: datetime
) -> list[ActivityDayCount]:
    if mode == ActivityMode.YOU:
        rows = showtimes_crud.count_agenda_showtimes_by_day(
            session=session,
            user_id=user_id,
            snapshot_time=snapshot_time,
            include_interested=True,
            include_invited=True,
        )
    else:
        filters = _list_filters(mode=mode, snapshot_time=snapshot_time)
        viewer_context.apply_viewer_defaults(
            session=session, viewer_id=user_id, filters=filters
        )
        rows = showtimes_crud.count_main_page_showtimes_by_day(
            session=session, user_id=user_id, filters=filters
        )
    return [ActivityDayCount(day=day, count=count) for day, count in rows]


def _to_public(
    *, session: Session, user_id: UUID, showtimes: Sequence[Showtime]
) -> list[ShowtimePublic]:
    """Convert a handful of showtimes in one go, as the feed pages do."""
    visibility_modes = showtime_converters.viewer_visibility_modes(
        session=session, showtimes=showtimes, user_id=user_id
    )
    viewer_states = showtime_page_converters.viewer_states_for_showtimes(
        session=session,
        showtimes=showtimes,
        user_id=user_id,
        visibility_modes=visibility_modes,
    )
    return [
        showtime_converters.to_public(
            showtime=showtime,
            session=session,
            user_id=user_id,
            visibility_modes=visibility_modes,
            viewer_states=viewer_states,
        )
        for showtime in showtimes
    ]


def _friends(
    *, session: Session, user_id: UUID, snapshot_time: datetime
) -> list[ActivityFriendTally]:
    tallies = activity_crud.get_friend_tallies(
        session=session,
        user_id=user_id,
        friend_ids=friendship_crud.get_friend_ids(session=session, user_id=user_id),
        now=snapshot_time,
        limit=MAX_FRIENDS,
    )
    users = activity_crud.get_users_by_ids(
        session=session, user_ids=[tally.user_id for tally in tallies]
    )
    return [
        ActivityFriendTally(
            user=user_converters.to_public(users[tally.user_id]),
            going=tally.going,
            interested=tally.interested,
        )
        for tally in tallies
        if tally.user_id in users
    ]


def get_activity_summary(
    *,
    session: Session,
    user_id: UUID,
    mode: ActivityMode,
    snapshot_time: datetime,
) -> ActivitySummaryPublic:
    days = _day_counts(
        session=session, user_id=user_id, mode=mode, snapshot_time=snapshot_time
    )

    has_own = mode != ActivityMode.FRIENDS
    next_plan = (
        activity_crud.get_next_plan(session=session, user_id=user_id, now=snapshot_time)
        if has_own
        else None
    )
    invites = (
        feed_overview_crud.get_unanswered_invited_showtimes(
            session=session, user_id=user_id, now=snapshot_time, limit=MAX_INVITES
        )
        if has_own
        else []
    )
    public = _to_public(
        session=session,
        user_id=user_id,
        showtimes=[*([next_plan] if next_plan else []), *invites],
    )
    public_by_id = {showtime.id: showtime for showtime in public}

    return ActivitySummaryPublic(
        days=days,
        total=sum(day.count for day in days),
        next_plan=public_by_id.get(next_plan.id) if next_plan else None,
        plan_count=(
            activity_crud.count_plans(
                session=session, user_id=user_id, now=snapshot_time
            )
            if has_own
            else 0
        ),
        invites=[public_by_id[invite.id] for invite in invites],
        invite_count=(
            activity_crud.count_unanswered_invites(
                session=session, user_id=user_id, now=snapshot_time
            )
            if has_own
            else 0
        ),
        friends=(
            _friends(session=session, user_id=user_id, snapshot_time=snapshot_time)
            if mode != ActivityMode.YOU
            else []
        ),
    )
