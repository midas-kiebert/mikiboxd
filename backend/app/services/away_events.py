"""What happened to an account while the app was closed.

The app's notification tips ("you got an invite" / "you missed an invite",
"one of your screenings sold out", "you got a friend request") only ever speak about events since the
app was last in the foreground, so each is offered once per thing missed rather
than every time the app opens.
"""

from datetime import datetime
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlmodel import Session, col, func, or_, select

from app.core.enums import GoingStatus
from app.models.friendship import FriendRequest
from app.models.showtime import Showtime
from app.models.showtime_ping import ShowtimePing
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User
from app.schemas.away_events import AwayEventsPublic, AwayInvite, ScreeningSummary
from app.utils import now_amsterdam_naive

_AMSTERDAM_TZ = ZoneInfo("Europe/Amsterdam")
# Enough to fill the tip's one row, with room to spare.
_ROW_LIMIT = 5


def _to_amsterdam_naive(moment: datetime) -> datetime:
    """The database stores naive Amsterdam time; the app sends an instant."""
    if moment.tzinfo is None:
        return moment
    return moment.astimezone(_AMSTERDAM_TZ).replace(tzinfo=None)


def get_away_events(
    *, session: Session, user_id: UUID, since: datetime
) -> AwayEventsPublic:
    window_start = _to_amsterdam_naive(since)
    now = now_amsterdam_naive()

    received = (
        select(ShowtimePing, Showtime, User)
        .join(Showtime, col(Showtime.id) == col(ShowtimePing.showtime_id))
        .join(User, col(User.id) == col(ShowtimePing.sender_id))
        .where(
            col(ShowtimePing.receiver_id) == user_id,
            col(ShowtimePing.created_at) > window_start,
            col(ShowtimePing.dismissed_at).is_(None),
        )
    )
    upcoming_rows = session.exec(
        received.where(col(Showtime.datetime) > now)
        .order_by(col(Showtime.datetime))
        .limit(_ROW_LIMIT)
    ).all()
    # Missed: the screening started before the user looked at their invites
    # (`seen_at` is set by opening them, on the app or the website).
    missed_rows = session.exec(
        received.where(
            col(Showtime.datetime) <= now,
            or_(
                col(ShowtimePing.seen_at).is_(None),
                col(ShowtimePing.seen_at) > col(Showtime.datetime),
            ),
        )
        .order_by(col(Showtime.datetime))
        .limit(_ROW_LIMIT)
    ).all()

    friend_requests = session.exec(
        select(func.count())
        .select_from(FriendRequest)
        .where(
            col(FriendRequest.receiver_id) == user_id,
            col(FriendRequest.created_at) > window_start,
        )
    ).one()

    sold_out_rows = session.exec(
        select(Showtime)
        .join(ShowtimeSelection, col(ShowtimeSelection.showtime_id) == col(Showtime.id))
        .where(
            col(ShowtimeSelection.user_id) == user_id,
            col(ShowtimeSelection.going_status) == GoingStatus.INTERESTED,
            col(ShowtimeSelection.sold_out_alert_sent_at) > window_start,
            col(Showtime.datetime) > now,
        )
        .order_by(col(Showtime.datetime))
        .limit(_ROW_LIMIT)
    ).all()

    return AwayEventsPublic(
        upcoming_invites=[
            _invite(sender, showtime) for _, showtime, sender in upcoming_rows
        ],
        missed_invites=[
            _invite(sender, showtime) for _, showtime, sender in missed_rows
        ],
        friend_requests=int(friend_requests or 0),
        sold_out=[_screening(showtime) for showtime in sold_out_rows],
    )


def _screening(showtime: Showtime) -> ScreeningSummary:
    assert showtime.id is not None
    return ScreeningSummary(
        showtime_id=showtime.id,
        movie_id=showtime.movie_id,
        movie_title=showtime.movie.title,
        poster_link=showtime.movie.poster_link,
        cinema_name=showtime.cinema.name,
        datetime=showtime.datetime,
    )


def _invite(sender: User, showtime: Showtime) -> AwayInvite:
    return AwayInvite(
        sender_id=sender.id,
        sender_name=sender.display_name,
        screening=_screening(showtime),
    )
