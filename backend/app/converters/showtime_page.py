"""Viewer state for a whole page of showtimes, in a fixed number of queries.

`converters.showtime` can build the `viewer` block of one showtime on its own,
and for a single-showtime response that is the right thing. For a feed page it
is not: every part of that block is a question about one showtime — who of my
friends is going, who invited me, who else did they invite — and asking them a
row at a time cost nineteen queries per row, so a page of forty screenings
spent about eight hundred milliseconds in the database before a byte of it was
serialised.

This module asks each of those questions once for the whole page. The number of
queries is the same for a page of forty rows as for a page of four, and the
per-showtime rules live where they always did: everything here reads from the
batched `crud` functions whose single-showtime versions the converter used to
call one at a time.
"""

from collections.abc import Mapping, Sequence
from uuid import UUID

from sqlmodel import Session, col, select

from app.converters import user as user_converters
from app.converters.user import FriendStatusIndex
from app.core.enums import GoingStatus, VisibilityMode
from app.crud import movie as movies_crud
from app.crud import showtime as showtime_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.crud.showtime import FriendSelection
from app.crud.showtime_ping import PageInviteGraph, ParticipantAttribution
from app.models.showtime import Showtime
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User
from app.schemas.showtime import (
    CoInvitedFriendPublic,
    NonFriendParticipantPublic,
    ShowtimeInMovieViewerState,
    ShowtimeViewerState,
)
from app.schemas.user import UserPublic, UserWithFriendStatus


class ShowtimePageViewerData:
    """Everything the viewer block of a page of showtimes is built from.

    Read once in `load`, then sliced per showtime by the builders below. Held
    as an object rather than passed around as a dozen mappings because they are
    only ever used together, and a new dimension of viewer state should be one
    more field here rather than one more argument everywhere.
    """

    def __init__(
        self,
        *,
        session: Session,
        showtimes: Sequence[Showtime],
        user_id: UUID,
    ) -> None:
        showtime_ids = [showtime.id for showtime in showtimes]
        movie_ids = list({showtime.movie_id for showtime in showtimes})

        self.user_id = user_id
        self.index: FriendStatusIndex = user_converters.load_friend_status_index(
            session=session, user_id=user_id
        )
        self.own_selections = _own_selections(
            session=session, showtime_ids=showtime_ids, user_id=user_id
        )
        self.friend_selections = showtime_crud.get_friend_selections_for_showtimes(
            session=session, showtime_ids=showtime_ids, user_id=user_id
        )
        self.visible_non_friends = showtime_crud.get_visible_non_friends_for_showtimes(
            session=session,
            showtime_ids=showtime_ids,
            user_id=user_id,
            exclude_user_ids=self.index.friend_ids | {user_id},
        )
        self.received_pings = showtime_ping_crud.get_received_pings_for_showtimes(
            session=session, showtime_ids=showtime_ids, receiver_id=user_id
        )
        self.sent_pings = showtime_ping_crud.get_sent_showtime_pings_for_showtimes(
            session=session, showtime_ids=showtime_ids, sender_id=user_id
        )
        self.invite_graph: PageInviteGraph = showtime_ping_crud.load_page_invite_graph(
            session=session, viewer_id=user_id, showtime_ids=showtime_ids
        )
        self.friends_watchlisted = movies_crud.get_friends_who_watchlisted_movies(
            session=session, movie_ids=movie_ids, current_user=user_id
        )
        self.friends_watched = movies_crud.get_friends_who_watched_movies(
            session=session, movie_ids=movie_ids, current_user=user_id
        )
        # Everyone the invite graph names but no other query has already
        # loaded: co-invitees, chain-invitees, and whoever is attributed for
        # each of them.
        self.users_by_id = _users_by_id(
            session=session, user_ids=_named_by_invite_graph(self.invite_graph)
        )


def _own_selections(
    *,
    session: Session,
    showtime_ids: Sequence[int],
    user_id: UUID,
) -> dict[int, ShowtimeSelection]:
    """The viewer's own selection on each of these showtimes."""
    if len(showtime_ids) == 0:
        return {}
    selections = session.exec(
        select(ShowtimeSelection).where(
            col(ShowtimeSelection.user_id) == user_id,
            col(ShowtimeSelection.showtime_id).in_(showtime_ids),
        )
    ).all()
    return {selection.showtime_id: selection for selection in selections}


def _named_by_invite_graph(graph: PageInviteGraph) -> set[UUID]:
    """Every user id the invite graph mentions, in either role."""
    named: set[UUID] = set()
    for co_invited in graph.co_invited_by_inviter.values():
        named |= set(co_invited) | set(co_invited.values())
    for chain in graph.chain_by_connector.values():
        named |= set(chain) | set(chain.values())
    for direct in (graph.direct_sent_ids, graph.direct_received_ids):
        for user_ids in direct.values():
            named |= user_ids
    return named


def _users_by_id(*, session: Session, user_ids: set[UUID]) -> dict[UUID, User]:
    if len(user_ids) == 0:
        return {}
    users = session.exec(select(User).where(col(User.id).in_(user_ids))).all()
    return {user.id: user for user in users}


def _status_and_seat(
    selection: ShowtimeSelection | None,
) -> tuple[GoingStatus, str | None, str | None]:
    """Mirrors `converters.showtime._selection_status_and_seat`: a seat only
    means anything when the viewer is actually going."""
    if selection is None:
        return GoingStatus.NOT_GOING, None, None
    if selection.going_status != GoingStatus.GOING:
        return selection.going_status, None, None
    return selection.going_status, selection.seat_row, selection.seat_number


def _friends(
    selections: Sequence[FriendSelection],
) -> tuple[list[UserPublic], list[UserPublic]]:
    """Friends going (with their seats) and friends interested, in that order
    of precedence — someone going is not also listed as interested."""
    going = [
        user_converters.to_public(
            selection.friend,
            seat_row=selection.seat_row,
            seat_number=selection.seat_number,
        )
        for selection in selections
        if selection.going_status == GoingStatus.GOING
    ]
    going_ids = {friend.id for friend in going}
    interested = [
        user_converters.to_public(selection.friend)
        for selection in selections
        if selection.going_status == GoingStatus.INTERESTED
        and selection.friend.id not in going_ids
    ]
    return going, interested


def _non_friends(
    *,
    session: Session,
    visible: Sequence[tuple[GoingStatus, User]],
    index: FriendStatusIndex,
    user_id: UUID,
) -> tuple[list[UserWithFriendStatus], list[UserWithFriendStatus]]:
    """The same two lists for everyone visible who isn't a friend."""

    def with_status(user: User) -> UserWithFriendStatus:
        return user_converters.to_with_friend_status(
            user, session=session, current_user=user_id, index=index
        )

    going = [
        with_status(user) for status, user in visible if status == GoingStatus.GOING
    ]
    going_ids = {user.id for user in going}
    interested = [
        with_status(user)
        for status, user in visible
        if status == GoingStatus.INTERESTED and user.id not in going_ids
    ]
    return going, interested


def _invite_info(
    data: ShowtimePageViewerData,
    showtime_id: int,
) -> tuple[list[UserPublic], list[int], bool]:
    """Unique senders + ping ids of the viewer's active received pings, and
    whether any of them is still unseen."""
    invited_by: list[UserPublic] = []
    invite_ping_ids: list[int] = []
    seen_sender_ids: set[UUID] = set()
    pings = data.received_pings.get(showtime_id, [])
    for ping, sender in pings:
        if ping.id is not None:
            invite_ping_ids.append(ping.id)
        if sender.id not in seen_sender_ids:
            seen_sender_ids.add(sender.id)
            invited_by.append(user_converters.to_public(sender))
    has_unseen_invite = any(ping.seen_at is None for ping, _ in pings)
    return invited_by, invite_ping_ids, has_unseen_invite


def _co_invited_friends(
    data: ShowtimePageViewerData,
    showtime_id: int,
) -> list[CoInvitedFriendPublic]:
    """Your friends who were also invited by someone who invited you, excluding
    anyone you invited yourself — those are attributed to you."""
    inviter_by_co_invited_id = data.invite_graph.co_invited_by_inviter.get(
        showtime_id, {}
    )
    if len(inviter_by_co_invited_id) == 0:
        return []
    already_invited_ids = data.invite_graph.direct_sent_ids.get(showtime_id, set())
    visible_ids = (
        set(inviter_by_co_invited_id) & data.index.friend_ids - already_invited_ids
    )
    return [
        CoInvitedFriendPublic(
            friend=user_converters.to_public(data.users_by_id[friend_id]),
            inviter=user_converters.to_public(
                data.users_by_id[inviter_by_co_invited_id[friend_id]]
            ),
        )
        for friend_id in visible_ids
        if friend_id in data.users_by_id
        and inviter_by_co_invited_id[friend_id] in data.users_by_id
    ]


def _pending_invited_friends(
    data: ShowtimePageViewerData,
    showtime_id: int,
    responded_ids: set[UUID],
) -> list[UserPublic]:
    """Friends you invited who haven't responded going/interested yet."""
    return [
        UserPublic(
            id=ping.receiver_id,
            is_active=True,
            display_name=display_name,
        )
        for ping, display_name in data.sent_pings.get(showtime_id, [])
        if ping.receiver_id not in responded_ids
    ]


def _non_friend_participants(
    *,
    session: Session,
    data: ShowtimePageViewerData,
    showtime_id: int,
) -> list[NonFriendParticipantPublic]:
    """Non-friends in the viewer's invite graph (direct/co-invited/chain)."""
    attribution_by_id = _attribution(data=data, showtime_id=showtime_id)
    if len(attribution_by_id) == 0:
        return []
    non_friend_ids = set(attribution_by_id) - data.index.friend_ids
    if len(non_friend_ids) == 0:
        return []

    return [
        NonFriendParticipantPublic(
            user=user_converters.to_with_friend_status(
                data.users_by_id[participant_id],
                session=session,
                current_user=data.user_id,
                index=data.index,
            ),
            invited_by_you=attribution.invited_by_you,
            invited_you=attribution.invited_you,
            inviter=(
                user_converters.to_public(data.users_by_id[attribution.inviter_id])
                if attribution.inviter_id is not None
                and attribution.inviter_id in data.users_by_id
                else None
            ),
        )
        for participant_id, attribution in attribution_by_id.items()
        if participant_id in non_friend_ids and participant_id in data.users_by_id
    ]


def _attribution(
    *,
    data: ShowtimePageViewerData,
    showtime_id: int,
) -> dict[UUID, ParticipantAttribution]:
    """One showtime's slice of the invite graph, as attributions.

    The merge order is `crud.showtime_ping`'s, since that is where the priority
    between the four relations is documented.
    """
    attribution = showtime_ping_crud.attribution_for_showtime(
        graph=data.invite_graph, showtime_id=showtime_id
    )
    attribution.pop(data.user_id, None)
    return attribution


def _base_viewer_state_fields(
    *,
    session: Session,
    data: ShowtimePageViewerData,
    showtime_id: int,
    user_id: UUID,
    visibility_modes: Mapping[int, VisibilityMode],
) -> dict:
    """The fields `ShowtimeInMovieViewerState` and `ShowtimeViewerState` share,
    for one showtime — everything `ShowtimePageViewerData` batched for the
    whole page, sliced to a single row."""
    friends_going, friends_interested = _friends(
        data.friend_selections.get(showtime_id, [])
    )
    going, seat_row, seat_number = _status_and_seat(
        data.own_selections.get(showtime_id)
    )
    invited_by, invite_ping_ids, has_unseen_invite = _invite_info(data, showtime_id)
    responded_ids = {friend.id for friend in friends_going} | {
        friend.id for friend in friends_interested
    }
    friends_of_friends_going, friends_of_friends_interested = _non_friends(
        session=session,
        visible=data.visible_non_friends.get(showtime_id, []),
        index=data.index,
        user_id=user_id,
    )
    return {
        "going": going,
        "seat_row": seat_row,
        "seat_number": seat_number,
        "friends_going": friends_going,
        "friends_interested": friends_interested,
        "invited_by": invited_by,
        "invite_ping_ids": invite_ping_ids,
        "has_unseen_invite": has_unseen_invite,
        "co_invited_friends": _co_invited_friends(data, showtime_id),
        "pending_invited_friends": _pending_invited_friends(
            data, showtime_id, responded_ids
        ),
        "friends_of_friends_going": friends_of_friends_going,
        "friends_of_friends_interested": friends_of_friends_interested,
        "visibility_mode": visibility_modes.get(showtime_id),
    }


def in_movie_viewer_states_for_showtimes(
    *,
    session: Session,
    showtimes: Sequence[Showtime],
    user_id: UUID,
    visibility_modes: Mapping[int, VisibilityMode],
) -> dict[int, ShowtimeInMovieViewerState]:
    """The narrower `viewer` block (a movie card's showtime row, or a movie
    page's own showtime list) for every showtime on a page, in the same fixed
    number of queries as `viewer_states_for_showtimes`.

    Hand the result to `converters.showtime.to_in_movie_public` as
    `viewer_states`.
    """
    if len(showtimes) == 0:
        return {}

    data = ShowtimePageViewerData(session=session, showtimes=showtimes, user_id=user_id)

    return {
        showtime.id: ShowtimeInMovieViewerState(
            **_base_viewer_state_fields(
                session=session,
                data=data,
                showtime_id=showtime.id,
                user_id=user_id,
                visibility_modes=visibility_modes,
            )
        )
        for showtime in showtimes
    }


def viewer_states_for_showtimes(
    *,
    session: Session,
    showtimes: Sequence[Showtime],
    user_id: UUID,
    visibility_modes: Mapping[int, VisibilityMode],
) -> dict[int, ShowtimeViewerState]:
    """The `viewer` block of every showtime on a page.

    Hand the result to `converters.showtime.to_public` as `viewer_states`. The
    modes come in from the caller because `viewer_visibility_modes` is already
    resolved for a page wherever this is used.
    """
    if len(showtimes) == 0:
        return {}

    data = ShowtimePageViewerData(session=session, showtimes=showtimes, user_id=user_id)

    states: dict[int, ShowtimeViewerState] = {}
    for showtime in showtimes:
        showtime_id = showtime.id
        states[showtime_id] = ShowtimeViewerState(
            **_base_viewer_state_fields(
                session=session,
                data=data,
                showtime_id=showtime_id,
                user_id=user_id,
                visibility_modes=visibility_modes,
            ),
            friends_watchlisted=[
                user_converters.to_public(friend)
                for friend in data.friends_watchlisted.get(showtime.movie_id, [])
            ],
            friends_watched=[
                user_converters.to_public(friend)
                for friend in data.friends_watched.get(showtime.movie_id, [])
            ],
            non_friend_participants=_non_friend_participants(
                session=session, data=data, showtime_id=showtime_id
            ),
        )
    return states
