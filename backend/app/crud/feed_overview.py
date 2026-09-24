"""The queries behind the feed overview's sections (see `services.feed_overview`).

Each one answers a single question about the viewer — what they were invited
to, what they are interested in, what their friends picked — and returns
`Showtime` rows in the order the section wants them. How many of each make it
onto the card, and in what company, is the service's business.
"""

from collections.abc import Sequence
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import Select, case, func
from sqlalchemy import select as sa_select
from sqlmodel import Session, col, or_, select

from app.core.enums import GoingStatus, Language
from app.crud.movie import apply_language_filter
from app.crud.showtime import ACTIVE_GOING_STATUSES
from app.inputs.movie import Filters
from app.models.friendship import Friendship
from app.models.movie import Movie
from app.models.showtime import Showtime
from app.models.showtime_ping import ShowtimePing
from app.models.showtime_selection import ShowtimeSelection
from app.models.showtime_visibility import ShowtimeVisibilityEffective

# How much a friend's "going" counts for against an "interested" when ranking
# the screenings friends picked: a firm plan is worth two maybes.
FRIEND_GOING_WEIGHT = 2
FRIEND_INTERESTED_WEIGHT = 1


def _viewer_selection_ids(user_id: UUID):
    """Showtimes the viewer has said going or interested to.

    NOT_GOING is not an answer here: it is also what taking a status back
    leaves behind, and every client shows it as "no status" (the cards' invite
    line reads exactly that way).
    """
    return select(ShowtimeSelection.showtime_id).where(
        col(ShowtimeSelection.user_id) == user_id,
        col(ShowtimeSelection.going_status).in_(ACTIVE_GOING_STATUSES),
    )


def get_unanswered_invited_showtimes(
    *, session: Session, user_id: UUID, now: datetime, limit: int
) -> list[Showtime]:
    """Upcoming showtimes the viewer has an open invite to and no answer for.

    Once they have said going or interested it is a plan, not an invite, and
    it shows up there instead. Soonest first: that is the order they expire in.
    """
    invited_ids = select(ShowtimePing.showtime_id).where(
        col(ShowtimePing.receiver_id) == user_id,
        col(ShowtimePing.dismissed_at).is_(None),
    )
    stmt = (
        select(Showtime)
        .where(
            col(Showtime.datetime) >= now,
            col(Showtime.id).in_(invited_ids),
            col(Showtime.id).not_in(_viewer_selection_ids(user_id)),
        )
        .order_by(col(Showtime.datetime))
        .limit(limit)
    )
    return list(session.exec(stmt).all())


def get_interested_showtimes_with_seat_data(
    *, session: Session, user_id: UUID, now: datetime
) -> list[Showtime]:
    """Upcoming showtimes the viewer is interested in and we have a seat reading for.

    The level itself is worked out in Python by
    `services.seat_availability.effective_seat_level`, which is the one place
    the cutoffs live, so this only narrows to rows that can have one.
    """
    stmt = (
        select(Showtime)
        .join(ShowtimeSelection, col(ShowtimeSelection.showtime_id) == col(Showtime.id))
        .where(
            col(ShowtimeSelection.user_id) == user_id,
            col(ShowtimeSelection.going_status) == GoingStatus.INTERESTED,
            col(Showtime.datetime) >= now,
            or_(
                col(Showtime.seats_left).is_not(None),
                col(Showtime.seats_level_floor).is_not(None),
            ),
        )
        .order_by(col(Showtime.datetime))
    )
    return list(session.exec(stmt).all())


def get_showtimes_friends_picked(
    *,
    session: Session,
    user_id: UUID,
    now: datetime,
    languages: Sequence[Language] | None,
    limit: int,
) -> list[tuple[Showtime, int]]:
    """Upcoming screenings the viewer's friends are going to or interested in,
    each with its friend score.

    Ranked rather than listed by date: going counts for more than interested
    (`FRIEND_GOING_WEIGHT`), more friends for more than fewer, and only then
    does the sooner one win. Visibility is the same rule the feed's badges use
    — a direct friendship *and* a `ShowtimeVisibilityEffective` row — so this
    never surfaces a screening whose friends the viewer could not see on it.

    Every cinema, not just the viewer's usual ones: a friend at a cinema they
    never picked is exactly the kind of thing this section is for. Screenings
    the viewer is going to or interested in are left out; those are plans.
    """
    weight = case(
        (
            col(ShowtimeSelection.going_status) == GoingStatus.GOING,
            FRIEND_GOING_WEIGHT,
        ),
        else_=FRIEND_INTERESTED_WEIGHT,
    )
    score = func.sum(weight).label("score")
    friend_count = func.count(col(ShowtimeSelection.user_id)).label("friend_count")

    # Labelled expressions: past what sqlmodel's `select` overloads cover.
    ranked: Select[Any] = (
        sa_select(col(Showtime.id).label("showtime_id"), score, friend_count)
        .join(ShowtimeSelection, col(ShowtimeSelection.showtime_id) == col(Showtime.id))
        .join(
            ShowtimeVisibilityEffective,
            (
                col(ShowtimeVisibilityEffective.owner_id)
                == col(ShowtimeSelection.user_id)
            )
            & (col(ShowtimeVisibilityEffective.showtime_id) == col(Showtime.id))
            & (col(ShowtimeVisibilityEffective.viewer_id) == user_id),
        )
        .join(
            Friendship,
            (col(Friendship.user_id) == user_id)
            & (col(Friendship.friend_id) == col(ShowtimeSelection.user_id)),
        )
        .where(
            col(Showtime.datetime) >= now,
            col(ShowtimeSelection.going_status).in_(ACTIVE_GOING_STATUSES),
            col(Showtime.id).not_in(_viewer_selection_ids(user_id)),
        )
    )
    if languages:
        ranked = ranked.join(Movie, col(Movie.id) == col(Showtime.movie_id))
        ranked = apply_language_filter(
            ranked,
            filters=Filters(snapshot_time=now, selected_languages=list(languages)),
        )
    ranked_subquery = ranked.group_by(col(Showtime.id)).subquery()

    stmt = (
        select(Showtime, ranked_subquery.c.score)
        .join(ranked_subquery, ranked_subquery.c.showtime_id == col(Showtime.id))
        .order_by(
            ranked_subquery.c.score.desc(),
            ranked_subquery.c.friend_count.desc(),
            col(Showtime.datetime),
        )
        .limit(limit)
    )
    return [(showtime, int(score)) for showtime, score in session.exec(stmt).all()]


def get_viewer_selected_showtime_ids(
    *, session: Session, user_id: UUID, showtime_ids: Sequence[int]
) -> set[int]:
    """Which of `showtime_ids` the viewer is going to or interested in."""
    if not showtime_ids:
        return set()
    stmt = select(ShowtimeSelection.showtime_id).where(
        col(ShowtimeSelection.user_id) == user_id,
        col(ShowtimeSelection.going_status).in_(ACTIVE_GOING_STATUSES),
        col(ShowtimeSelection.showtime_id).in_(showtime_ids),
    )
    return set(session.exec(stmt).all())
