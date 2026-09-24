"""The website's feed overview: what sits in the detail column while nothing is picked.

A handful of short lists, each a way into a screening, chosen by how much each
one matters right now. In priority order (`FeedOverviewSectionKind`):

  1. **Invited** — open invites the viewer has not answered yet.
  2. **Selling fast** — a weighted random draw from screenings that are very
     busy or down to the last few seats (never sold out), among those the
     viewer is interested in and those friends picked.
  3. **Custom** — whatever filters the viewer chose for this slot, if any.
  4. **Plans** — the start of their agenda.
  5. **Friends going** — a random draw from screenings friends picked,
     weighted toward more (and firmer) friends and toward sooner dates, so
     the card shows something different each time.
  6. **Watchlist** — screenings of watchlisted films at their cinemas.

Sections with nothing in them are skipped, and the card has a budget: at most
`MAX_SECTIONS` lists, `MAX_PER_SECTION` rows each, `MAX_TOTAL` rows in all.
Lists are filled in priority order until the budget runs out, so the later
ones are the ones that shrink or drop. A screening already shown higher up is
never repeated further down — except in the custom list, which is the viewer's
own and always shows what its filters match (and claims nothing either).

Asked of the server rather than read off the feed's loaded rows, so the card
stays put while the feed scrolls underneath it.
"""

import random
from collections.abc import Callable, Sequence
from datetime import datetime
from uuid import UUID

from sqlmodel import Session

from app.converters import showtime as showtime_converters
from app.converters import showtime_page as showtime_page_converters
from app.core.enums import (
    FeedOverviewSectionKind,
    Language,
    SeatAvailabilityLevel,
)
from app.crud import feed_overview as feed_overview_crud
from app.crud import showtime as showtimes_crud
from app.inputs.movie import Filters
from app.models.showtime import Showtime
from app.schemas.feed_overview import FeedOverviewPublic, FeedOverviewSection
from app.schemas.showtime import ShowtimePublic
from app.services import seat_availability as seat_availability_service
from app.services import viewer_context

MAX_SECTIONS = 4
MAX_PER_SECTION = 3
MAX_TOTAL = 10

# Enough candidates per section that it still fills after every screening an
# earlier section already showed is taken out of it.
CANDIDATES_PER_SECTION = MAX_TOTAL + MAX_PER_SECTION

# The watchlist keeps one screening per film, and a film can have dozens, so it
# reads further ahead before giving up on finding three different ones.
WATCHLIST_CANDIDATE_ROWS = 80

# Friends going draws from this many of the top-scored screenings.
FRIENDS_GOING_POOL = 60
# Days ahead at which a screening's draw weight has halved.
FRIENDS_GOING_HALF_WEIGHT_DAYS = 3.0

# Selling fast's draw weights, multiplied together. Fewer seats weigh more:
# 1 + SCALE / seats left, so 10 seats left is ×2 and 2 left is ×6.
SELLING_FAST_SEATS_SCALE = 10.0
# Also which levels qualify (busy is half a room, no reason to hurry), and
# the weight for a screening with only a level and no seat count.
SELLING_FAST_LEVEL_WEIGHT: dict[SeatAvailabilityLevel, float] = {
    SeatAvailabilityLevel.VERY_BUSY: 1.5,
    SeatAvailabilityLevel.LAST_FEW: 3.0,
}
# The viewer's own interest outweighs any number of friends.
SELLING_FAST_INTERESTED_WEIGHT = 4.0
# Per point of friend score (going 2, interested 1; see
# `crud.feed_overview.FRIEND_GOING_WEIGHT`), on top of 1.
SELLING_FAST_FRIEND_SCORE_WEIGHT = 0.5
# A friends' screening of a film on the viewer's watchlist.
SELLING_FAST_WATCHLIST_WEIGHT = 1.5


def _invited(*, session: Session, user_id: UUID, filters: Filters) -> list[Showtime]:
    return feed_overview_crud.get_unanswered_invited_showtimes(
        session=session,
        user_id=user_id,
        now=filters.snapshot_time,
        limit=CANDIDATES_PER_SECTION,
    )


def _selling_fast_level(showtime: Showtime) -> SeatAvailabilityLevel | None:
    """The screening's level if it belongs in selling fast, else None."""
    level = seat_availability_service.effective_seat_level(showtime)
    if level not in SELLING_FAST_LEVEL_WEIGHT or showtime.seats_left == 0:
        return None
    return level


def _seats_weight(showtime: Showtime, level: SeatAvailabilityLevel) -> float:
    """How much fewer seats left raise the draw weight."""
    if showtime.seats_left is None:
        return SELLING_FAST_LEVEL_WEIGHT[level]
    return 1 + SELLING_FAST_SEATS_SCALE / showtime.seats_left


def _selling_fast(
    *, session: Session, user_id: UUID, filters: Filters
) -> list[Showtime]:
    """A weighted random draw from screenings very busy or fuller, not sold out.

    Two sources: screenings the viewer is interested in and screenings friends
    picked. Weight is multiplied from the seats left, the viewer's interest,
    and — for friends' screenings only — the friend score and whether the film
    is on the viewer's watchlist. Drawn like `_friends_going`.
    """
    weighted: list[tuple[Showtime, float]] = []
    for showtime in feed_overview_crud.get_interested_showtimes_with_seat_data(
        session=session, user_id=user_id, now=filters.snapshot_time
    ):
        level = _selling_fast_level(showtime)
        if level is not None:
            weighted.append(
                (
                    showtime,
                    _seats_weight(showtime, level) * SELLING_FAST_INTERESTED_WEIGHT,
                )
            )

    friends_picked: list[tuple[Showtime, int, SeatAvailabilityLevel]] = []
    for showtime, score in feed_overview_crud.get_showtimes_friends_picked(
        session=session,
        user_id=user_id,
        now=filters.snapshot_time,
        languages=None,
        limit=FRIENDS_GOING_POOL,
        with_seat_data=True,
    ):
        level = _selling_fast_level(showtime)
        if level is not None:
            friends_picked.append((showtime, score, level))

    watchlisted: set[int] = set()
    if friends_picked:
        letterboxd_username = viewer_context.letterboxd_username_for(
            session=session, viewer_id=user_id
        )
        if letterboxd_username is not None:
            watchlisted = feed_overview_crud.get_watchlisted_movie_ids(
                session=session,
                letterboxd_username=letterboxd_username,
                movie_ids=[showtime.movie_id for showtime, _, _ in friends_picked],
            )
    for showtime, score, level in friends_picked:
        weight = _seats_weight(showtime, level) * (
            1 + SELLING_FAST_FRIEND_SCORE_WEIGHT * score
        )
        if showtime.movie_id in watchlisted:
            weight *= SELLING_FAST_WATCHLIST_WEIGHT
        weighted.append((showtime, weight))

    drawn = sorted(
        weighted, key=lambda entry: random.random() ** (1 / entry[1]), reverse=True
    )
    return [showtime for showtime, _ in drawn]


def _custom(*, session: Session, user_id: UUID, filters: Filters) -> list[Showtime]:
    viewer_context.apply_viewer_defaults(
        session=session, viewer_id=user_id, filters=filters
    )
    letterboxd_username = None
    if filters.watchlist_only or filters.hide_watched:
        letterboxd_username = viewer_context.letterboxd_username_for(
            session=session, viewer_id=user_id
        )
    return showtimes_crud.get_main_page_showtimes(
        session=session,
        user_id=user_id,
        limit=CANDIDATES_PER_SECTION,
        offset=0,
        filters=filters,
        letterboxd_username=letterboxd_username,
    )


def _plans(*, session: Session, user_id: UUID, filters: Filters) -> list[Showtime]:
    # Going and interested only: an invite not yet answered is its own section.
    return showtimes_crud.get_agenda_showtimes(
        session=session,
        user_id=user_id,
        snapshot_time=filters.snapshot_time,
        include_interested=True,
        include_invited=False,
        limit=CANDIDATES_PER_SECTION,
        offset=0,
    )


def _friends_going(
    *, session: Session, user_id: UUID, filters: Filters
) -> list[Showtime]:
    """A weighted random draw, so the section changes between visits.

    Weight is the friend score, divided down the further ahead the screening
    is. Drawn without replacement (Efraimidis–Spirakis keys) over the whole
    candidate order, so later sections' dedup still has spares to fall back on.
    """
    candidates = feed_overview_crud.get_showtimes_friends_picked(
        session=session,
        user_id=user_id,
        now=filters.snapshot_time,
        languages=filters.selected_languages,
        limit=FRIENDS_GOING_POOL,
    )

    def draw_key(entry: tuple[Showtime, int]) -> float:
        showtime, score = entry
        days_ahead = max(
            (showtime.datetime - filters.snapshot_time).total_seconds() / 86400, 0.0
        )
        weight = max(score, 1) / (1 + days_ahead / FRIENDS_GOING_HALF_WEIGHT_DAYS)
        return random.random() ** (1 / weight)

    drawn = sorted(candidates, key=draw_key, reverse=True)
    return [showtime for showtime, _ in drawn[:CANDIDATES_PER_SECTION]]


def _watchlist(*, session: Session, user_id: UUID, filters: Filters) -> list[Showtime]:
    """The soonest screening of each watchlisted film, at the viewer's cinemas.

    One per film: three showings of the same film is one suggestion, not three.
    Screenings the viewer is already going to or interested in are plans.
    """
    letterboxd_username = viewer_context.letterboxd_username_for(
        session=session, viewer_id=user_id
    )
    if letterboxd_username is None:
        return []
    viewer_context.apply_viewer_defaults(
        session=session, viewer_id=user_id, filters=filters
    )
    rows = showtimes_crud.get_main_page_showtimes(
        session=session,
        user_id=user_id,
        limit=WATCHLIST_CANDIDATE_ROWS,
        offset=0,
        filters=filters,
        letterboxd_username=letterboxd_username,
    )
    answered = feed_overview_crud.get_viewer_selected_showtime_ids(
        session=session,
        user_id=user_id,
        showtime_ids=[showtime.id for showtime in rows if showtime.id is not None],
    )
    seen_movies: set[int] = set()
    picked: list[Showtime] = []
    for showtime in rows:
        if showtime.id in answered or showtime.movie_id in seen_movies:
            continue
        seen_movies.add(showtime.movie_id)
        picked.append(showtime)
    return picked


SectionQuery = Callable[..., list[Showtime]]


def _to_public(
    *, session: Session, user_id: UUID, showtimes: Sequence[Showtime]
) -> dict[int | None, ShowtimePublic]:
    """Convert every picked showtime in one go, as the feed pages do."""
    visibility_modes = showtime_converters.viewer_visibility_modes(
        session=session, showtimes=showtimes, user_id=user_id
    )
    viewer_states = showtime_page_converters.viewer_states_for_showtimes(
        session=session,
        showtimes=showtimes,
        user_id=user_id,
        visibility_modes=visibility_modes,
    )
    return {
        showtime.id: showtime_converters.to_public(
            showtime=showtime,
            session=session,
            user_id=user_id,
            visibility_modes=visibility_modes,
            viewer_states=viewer_states,
        )
        for showtime in showtimes
    }


def get_feed_overview(
    *,
    session: Session,
    user_id: UUID,
    now: datetime,
    languages: list[Language] | None,
    cinema_ids: list[int] | None,
    all_cinemas: bool,
    include_plans: bool,
    custom_filters: Filters | None,
) -> FeedOverviewPublic:
    """Fill the overview card, most urgent list first, within its budget.

    `languages` and `cinema_ids` are the feed's own current choices: the
    friends and watchlist lists follow the language, and the watchlist also
    the cinemas (none meaning the account's usual ones). `custom_filters` is
    the viewer's own list, or None when they have not set one up.
    `include_plans` is off on the agenda page, which is the plans already.

    Later sections are only queried while there is still room for them.
    """
    languages = languages or None
    queries: list[tuple[FeedOverviewSectionKind, SectionQuery, Filters]] = [
        (FeedOverviewSectionKind.INVITED, _invited, Filters(snapshot_time=now)),
        (
            FeedOverviewSectionKind.SELLING_FAST,
            _selling_fast,
            Filters(snapshot_time=now),
        ),
    ]
    if custom_filters is not None:
        queries.append(
            (
                FeedOverviewSectionKind.CUSTOM,
                _custom,
                custom_filters.model_copy(update={"snapshot_time": now}),
            )
        )
    if include_plans:
        queries.append(
            (FeedOverviewSectionKind.PLANS, _plans, Filters(snapshot_time=now))
        )
    queries += [
        (
            FeedOverviewSectionKind.FRIENDS_GOING,
            _friends_going,
            Filters(snapshot_time=now, selected_languages=languages),
        ),
        (
            FeedOverviewSectionKind.WATCHLIST,
            _watchlist,
            Filters(
                snapshot_time=now,
                watchlist_only=True,
                selected_cinema_ids=cinema_ids or None,
                all_cinemas=all_cinemas,
                selected_languages=languages,
            ),
        ),
    ]

    picked: list[tuple[FeedOverviewSectionKind, list[Showtime]]] = []
    shown_ids: set[int] = set()
    shown_count = 0
    for kind, query, filters in queries:
        room = min(MAX_PER_SECTION, MAX_TOTAL - shown_count)
        if len(picked) >= MAX_SECTIONS or room <= 0:
            break
        is_custom = kind == FeedOverviewSectionKind.CUSTOM
        rows = [
            showtime
            for showtime in query(session=session, user_id=user_id, filters=filters)
            if is_custom or showtime.id not in shown_ids
        ][:room]
        if not rows:
            continue
        picked.append((kind, rows))
        shown_count += len(rows)
        if not is_custom:
            shown_ids.update(
                showtime.id for showtime in rows if showtime.id is not None
            )

    public = _to_public(
        session=session,
        user_id=user_id,
        showtimes=list(
            {showtime.id: showtime for _, rows in picked for showtime in rows}.values()
        ),
    )
    return FeedOverviewPublic(
        sections=[
            FeedOverviewSection(
                kind=kind, showtimes=[public[showtime.id] for showtime in rows]
            )
            for kind, rows in picked
        ]
    )
