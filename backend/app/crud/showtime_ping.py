from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func
from sqlalchemy import select as sa_select
from sqlmodel import Session, col, or_, select

from app.core.enums import ShowtimePingSort
from app.models.showtime import Showtime
from app.models.showtime_ping import ShowtimePing
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User


def get_showtime_ping(
    *,
    session: Session,
    showtime_id: int,
    sender_id: UUID,
    receiver_id: UUID,
) -> ShowtimePing | None:
    stmt = select(ShowtimePing).where(
        ShowtimePing.showtime_id == showtime_id,
        ShowtimePing.sender_id == sender_id,
        ShowtimePing.receiver_id == receiver_id,
    )
    return session.exec(stmt).one_or_none()


def get_showtime_ping_by_id(*, session: Session, ping_id: int) -> ShowtimePing | None:
    return session.get(ShowtimePing, ping_id)


def create_showtime_ping(
    *,
    session: Session,
    showtime_id: int,
    sender_id: UUID,
    receiver_id: UUID,
    created_at: datetime,
    receiver_had_selection_at_creation: bool = False,
) -> ShowtimePing:
    ping = ShowtimePing(
        showtime_id=showtime_id,
        sender_id=sender_id,
        receiver_id=receiver_id,
        created_at=created_at,
        receiver_had_selection_at_creation=receiver_had_selection_at_creation,
    )
    session.add(ping)
    session.flush()
    return ping


@dataclass(frozen=True)
class PageInviteGraph:
    """The viewer's invite graph across a page of showtimes.

    Every relation the identity graph is built from, resolved for all the
    showtimes at once: asking per showtime costs four to seven queries a row,
    which is what a feed page used to pay. The maps are keyed by showtime id
    and only carry showtimes that have something in them.
    """

    showtime_ids: tuple[int, ...]
    #: People the viewer invited to this showtime.
    direct_sent_ids: dict[int, set[UUID]]
    #: People who invited the viewer to this showtime.
    direct_received_ids: dict[int, set[UUID]]
    #: Senders of the viewer's still-active (non-dismissed) invites.
    active_inviter_ids: dict[int, set[UUID]]
    #: Co-invitee -> the shared inviter who invited them.
    co_invited_by_inviter: dict[int, dict[UUID, UUID]]
    #: Chain-invitee -> the accepted connector who reaches them.
    chain_by_connector: dict[int, dict[UUID, UUID]]


def load_page_invite_graph(
    *,
    session: Session,
    viewer_id: UUID,
    showtime_ids: Sequence[int],
    eligible_only: bool = False,
) -> PageInviteGraph:
    """Build `PageInviteGraph` for these showtimes.

    Two hops, and each hop is one query for the whole page: the viewer's own
    pings, then the pings of the inviters and connectors those turned up. A
    page whose viewer has no invites at all costs the first query and nothing
    else, which is the common case and why the single-showtime helpers above
    delegate here rather than keeping a second implementation of these rules.

    `eligible_only` is the flag the per-showtime helpers document: it drops
    pings whose receiver already had a selection when the ping was made. It
    applies to the viewer's own edges in both hops of the chain, and — as
    `get_co_invited_user_ids_with_inviter` explains — to the inviter->viewer
    edge but never to the inviter->co-invitee edge.
    """
    ids = tuple(dict.fromkeys(showtime_ids))
    empty = PageInviteGraph(
        showtime_ids=ids,
        direct_sent_ids={},
        direct_received_ids={},
        active_inviter_ids={},
        co_invited_by_inviter={},
        chain_by_connector={},
    )
    if len(ids) == 0:
        return empty

    # Five columns: past what sqlmodel's `select` overloads cover.
    own_pings = session.execute(
        sa_select(
            col(ShowtimePing.showtime_id),
            col(ShowtimePing.sender_id),
            col(ShowtimePing.receiver_id),
            col(ShowtimePing.dismissed_at),
            col(ShowtimePing.receiver_had_selection_at_creation),
        ).where(
            col(ShowtimePing.showtime_id).in_(ids),
            or_(
                col(ShowtimePing.sender_id) == viewer_id,
                col(ShowtimePing.receiver_id) == viewer_id,
            ),
        )
    ).all()
    if len(own_pings) == 0:
        return empty

    direct_sent_ids: dict[int, set[UUID]] = {}
    direct_received_ids: dict[int, set[UUID]] = {}
    active_inviter_ids: dict[int, set[UUID]] = {}
    for showtime_id, sender_id, receiver_id, dismissed_at, had_selection in own_pings:
        if eligible_only and had_selection:
            continue
        if sender_id == viewer_id:
            direct_sent_ids.setdefault(showtime_id, set()).add(receiver_id)
        if receiver_id == viewer_id:
            direct_received_ids.setdefault(showtime_id, set()).add(sender_id)
            if dismissed_at is None:
                active_inviter_ids.setdefault(showtime_id, set()).add(sender_id)

    return PageInviteGraph(
        showtime_ids=ids,
        direct_sent_ids=direct_sent_ids,
        direct_received_ids=direct_received_ids,
        active_inviter_ids=active_inviter_ids,
        co_invited_by_inviter=_co_invited_for_page(
            session=session,
            viewer_id=viewer_id,
            active_inviter_ids=active_inviter_ids,
        ),
        chain_by_connector=_chain_for_page(
            session=session,
            viewer_id=viewer_id,
            direct_sent_ids=direct_sent_ids,
            direct_received_ids=direct_received_ids,
            eligible_only=eligible_only,
        ),
    )


def _co_invited_for_page(
    *,
    session: Session,
    viewer_id: UUID,
    active_inviter_ids: dict[int, set[UUID]],
) -> dict[int, dict[UUID, UUID]]:
    """Everyone else the viewer's active inviters invited, per showtime.

    Ordered by sender so that a person invited by two of them is attributed to
    the same one every time, which is what the per-showtime query guaranteed.
    """
    if len(active_inviter_ids) == 0:
        return {}

    every_inviter_id = set().union(*active_inviter_ids.values())
    rows = session.exec(
        select(
            col(ShowtimePing.showtime_id),
            col(ShowtimePing.sender_id),
            col(ShowtimePing.receiver_id),
        )
        .where(
            col(ShowtimePing.showtime_id).in_(active_inviter_ids.keys()),
            col(ShowtimePing.sender_id).in_(every_inviter_id),
            col(ShowtimePing.receiver_id) != viewer_id,
        )
        .order_by(col(ShowtimePing.sender_id))
    ).all()

    co_invited_by_inviter: dict[int, dict[UUID, UUID]] = {}
    for showtime_id, sender_id, receiver_id in rows:
        if sender_id not in active_inviter_ids.get(showtime_id, set()):
            continue
        co_invited_by_inviter.setdefault(showtime_id, {}).setdefault(
            receiver_id, sender_id
        )
    return co_invited_by_inviter


def _chain_for_page(
    *,
    session: Session,
    viewer_id: UUID,
    direct_sent_ids: dict[int, set[UUID]],
    direct_received_ids: dict[int, set[UUID]],
    eligible_only: bool,
) -> dict[int, dict[UUID, UUID]]:
    """One hop past the viewer's own invites, for every showtime at once.

    A connector only counts once they have a selection on that showtime, so
    the selections are looked up for the page in one query too. Connectors are
    walked in a fixed order per showtime, matching the per-showtime version, so
    a person reachable through two connectors is attributed to the same one.
    """
    connector_ids_by_showtime_id = {
        showtime_id: direct_sent_ids.get(showtime_id, set())
        | direct_received_ids.get(showtime_id, set())
        for showtime_id in direct_sent_ids.keys() | direct_received_ids.keys()
    }
    connector_ids_by_showtime_id = {
        showtime_id: connector_ids
        for showtime_id, connector_ids in connector_ids_by_showtime_id.items()
        if len(connector_ids) > 0
    }
    if len(connector_ids_by_showtime_id) == 0:
        return {}

    every_connector_id = set().union(*connector_ids_by_showtime_id.values())
    accepted = set(
        session.exec(
            select(
                col(ShowtimeSelection.user_id), col(ShowtimeSelection.showtime_id)
            ).where(
                col(ShowtimeSelection.showtime_id).in_(
                    connector_ids_by_showtime_id.keys()
                ),
                col(ShowtimeSelection.user_id).in_(every_connector_id),
            )
        ).all()
    )
    if len(accepted) == 0:
        return {}

    reached_rows = session.exec(
        select(
            col(ShowtimePing.showtime_id),
            col(ShowtimePing.sender_id),
            col(ShowtimePing.receiver_id),
            col(ShowtimePing.receiver_had_selection_at_creation),
        ).where(
            col(ShowtimePing.showtime_id).in_(connector_ids_by_showtime_id.keys()),
            or_(
                col(ShowtimePing.sender_id).in_(every_connector_id),
                col(ShowtimePing.receiver_id).in_(every_connector_id),
            ),
        )
    ).all()

    sent_by_connector: dict[tuple[int, UUID], set[UUID]] = {}
    received_by_connector: dict[tuple[int, UUID], set[UUID]] = {}
    for showtime_id, sender_id, receiver_id, had_selection in reached_rows:
        if eligible_only and had_selection:
            continue
        if sender_id in every_connector_id:
            sent_by_connector.setdefault((showtime_id, sender_id), set()).add(
                receiver_id
            )
        if receiver_id in every_connector_id:
            received_by_connector.setdefault((showtime_id, receiver_id), set()).add(
                sender_id
            )

    chain_by_connector: dict[int, dict[UUID, UUID]] = {}
    for showtime_id, connector_ids in connector_ids_by_showtime_id.items():
        for connector_id in sorted(connector_ids, key=str):
            if (connector_id, showtime_id) not in accepted:
                continue
            reached: set[UUID] = set()
            if connector_id in direct_sent_ids.get(showtime_id, set()):
                reached |= sent_by_connector.get((showtime_id, connector_id), set())
            if connector_id in direct_received_ids.get(showtime_id, set()):
                reached |= received_by_connector.get((showtime_id, connector_id), set())
            reached.discard(viewer_id)
            for user_id in reached:
                chain_by_connector.setdefault(showtime_id, {}).setdefault(
                    user_id, connector_id
                )
    return chain_by_connector


def get_pinged_friend_ids_for_showtime(
    *,
    session: Session,
    showtime_id: int,
    sender_id: UUID,
) -> list[UUID]:
    stmt = (
        select(ShowtimePing.receiver_id)
        .where(
            ShowtimePing.showtime_id == showtime_id,
            ShowtimePing.sender_id == sender_id,
        )
        .order_by(col(ShowtimePing.created_at).desc())
    )
    return list(session.exec(stmt).all())


def get_ping_counterpart_ids_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
    eligible_only: bool = False,
) -> set[UUID]:
    """Friends bound to the owner by a ping for this showtime, either direction.

    A ping (S→R) means S invited R, so both invariants apply: S's status is
    visible to R (S invited them) and R's status is visible to S (they invited
    R back, i.e. R was invited by S). This returns, for the owner, the set of
    the *other* party in every ping the owner sent or received for the showtime.

    `eligible_only` excludes pings whose receiver already had a selection
    before the ping existed — nobody "accepted" those, so they must not
    grant visibility. Callers building the identity/UI graph (e.g. "who did
    I invite") should leave this False; visibility computation must pass True.
    """
    sent_stmt = select(ShowtimePing.receiver_id).where(
        ShowtimePing.showtime_id == showtime_id,
        ShowtimePing.sender_id == owner_id,
    )
    received_stmt = select(ShowtimePing.sender_id).where(
        ShowtimePing.showtime_id == showtime_id,
        ShowtimePing.receiver_id == owner_id,
    )
    if eligible_only:
        eligible = col(ShowtimePing.receiver_had_selection_at_creation).is_(False)
        sent_stmt = sent_stmt.where(eligible)
        received_stmt = received_stmt.where(eligible)
    sent_receiver_ids = session.exec(sent_stmt).all()
    received_sender_ids = session.exec(received_stmt).all()
    return set(sent_receiver_ids) | set(received_sender_ids)


def get_chain_invited_user_ids_with_connector(
    *,
    session: Session,
    viewer_id: UUID,
    showtime_id: int,
    eligible_only: bool = False,
) -> dict[UUID, UUID]:
    """One-hop chain: people connected to the viewer through an accepted connector,
    mapped to the connector responsible for reaching each of them (deterministic
    when more than one connector reaches the same person).

    Forward: the viewer invited X, and X has accepted (going/interested) -> X's
    own invitees become visible to the viewer, attributed to X.
    Backward: X invited the viewer, and X has accepted -> whoever invited X
    becomes visible to the viewer, attributed to X.

    Unconditional once the connector has accepted (no mode/opt-out check on the
    connector), matching how direct and co-invited visibility already ignore
    mode and opt-out. Limited to one hop: a chain-invitee's own invitees are
    not pulled in.

    `eligible_only` excludes pings whose receiver already had a selection
    before the ping existed (see `get_ping_counterpart_ids_for_showtime`) from
    every edge in the chain — such an edge may neither act as a connector nor
    be reached through one. Leave False for the identity/UI graph, True for
    visibility computation.
    """
    graph = load_page_invite_graph(
        session=session,
        viewer_id=viewer_id,
        showtime_ids=[showtime_id],
        eligible_only=eligible_only,
    )
    return graph.chain_by_connector.get(showtime_id, {})


def get_chain_invited_user_ids(
    *,
    session: Session,
    viewer_id: UUID,
    showtime_id: int,
    eligible_only: bool = False,
) -> set[UUID]:
    """See `get_chain_invited_user_ids_with_connector` for the underlying relation."""
    return set(
        get_chain_invited_user_ids_with_connector(
            session=session,
            viewer_id=viewer_id,
            showtime_id=showtime_id,
            eligible_only=eligible_only,
        )
    )


def get_active_received_inviter_ids(
    *,
    session: Session,
    receiver_id: UUID,
    showtime_id: int,
    eligible_only: bool = False,
) -> set[UUID]:
    """Senders of the viewer's still-active (non-dismissed) invites for a showtime."""
    inviter_ids_by_showtime_id = get_active_received_inviter_ids_for_showtimes(
        session=session,
        receiver_id=receiver_id,
        showtime_ids=[showtime_id],
        eligible_only=eligible_only,
    )
    return inviter_ids_by_showtime_id.get(showtime_id, set())


def get_active_received_inviter_ids_for_showtimes(
    *,
    session: Session,
    receiver_id: UUID,
    showtime_ids: list[int],
    eligible_only: bool = False,
) -> dict[int, set[UUID]]:
    """`get_active_received_inviter_ids` for many showtimes in one query.

    Showtimes without an active received invite are absent from the result.

    `eligible_only` excludes pings whose receiver already had a selection
    before the ping existed — see `get_ping_counterpart_ids_for_showtime`.
    """
    if len(showtime_ids) == 0:
        return {}

    stmt = select(ShowtimePing.showtime_id, ShowtimePing.sender_id).where(
        col(ShowtimePing.showtime_id).in_(showtime_ids),
        ShowtimePing.receiver_id == receiver_id,
        col(ShowtimePing.dismissed_at).is_(None),
    )
    if eligible_only:
        stmt = stmt.where(
            col(ShowtimePing.receiver_had_selection_at_creation).is_(False)
        )
    inviter_ids_by_showtime_id: dict[int, set[UUID]] = {}
    for showtime_id, sender_id in session.exec(stmt).all():
        inviter_ids_by_showtime_id.setdefault(showtime_id, set()).add(sender_id)
    return inviter_ids_by_showtime_id


def get_co_invited_user_ids(
    *,
    session: Session,
    viewer_id: UUID,
    showtime_id: int,
    eligible_only: bool = False,
) -> set[UUID]:
    """Other people invited by anyone who has an active invite out to the viewer.

    These are the viewer's "co-invitees" for the showtime: a shared invite group
    formed by a common inviter. The viewer itself is excluded.
    """
    return set(
        get_co_invited_user_ids_with_inviter(
            session=session,
            viewer_id=viewer_id,
            showtime_id=showtime_id,
            eligible_only=eligible_only,
        )
    )


def get_co_invited_user_ids_with_inviter(
    *,
    session: Session,
    viewer_id: UUID,
    showtime_id: int,
    eligible_only: bool = False,
) -> dict[UUID, UUID]:
    """Co-invitees mapped to the shared inviter who invited each of them.

    Same invite group as `get_co_invited_user_ids`, but attributes each
    co-invitee to one of the viewer's active inviters — whichever invited them
    (deterministic when more than one inviter sent that person an invite).

    `eligible_only` requires the inviter→viewer edge to be an eligible ping
    (see `get_ping_counterpart_ids_for_showtime`) — an inviter the viewer only
    reaches through a flagged ping cannot be used to derive co-invitees.
    Deliberately does NOT also filter the inviter→co-invitee edge below: that
    edge belongs to the co-invitee's own graph, not the viewer's, so it stays
    unfiltered even under `eligible_only`.
    """
    graph = load_page_invite_graph(
        session=session,
        viewer_id=viewer_id,
        showtime_ids=[showtime_id],
        eligible_only=eligible_only,
    )
    return graph.co_invited_by_inviter.get(showtime_id, {})


@dataclass(frozen=True)
class ParticipantAttribution:
    """Why a person shows up in the viewer's invite graph for a showtime.

    Priority order when more than one relation applies: the viewer invited
    them directly, they invited the viewer directly, a shared inviter invited
    both of them (co-invited), or an accepted connector reaches them (chain).
    `inviter_id` carries the attributed inviter for the latter two cases only
    — the direct cases are already fully described by the two booleans.
    """

    invited_by_you: bool = False
    invited_you: bool = False
    inviter_id: UUID | None = None


def get_related_participant_attribution_for_showtime(
    *,
    session: Session,
    viewer_id: UUID,
    showtime_id: int,
) -> dict[UUID, ParticipantAttribution]:
    """Everyone in the viewer's invite graph for a showtime, with attribution:
    direct, co-invited, and one-hop chain connections, unfiltered by friendship.

    This is the identity graph (who's part of the viewer's invite group and
    why), as opposed to the friend-scoped status-visibility graph in
    `showtime_visibility.py`.
    """
    return get_related_participant_attribution_for_showtimes(
        session=session,
        viewer_id=viewer_id,
        showtime_ids=[showtime_id],
    ).get(showtime_id, {})


def get_related_participant_attribution_for_showtimes(
    *,
    session: Session,
    viewer_id: UUID,
    showtime_ids: Sequence[int],
) -> dict[int, dict[UUID, ParticipantAttribution]]:
    """`get_related_participant_attribution_for_showtime` for a page of
    showtimes, off one shared invite graph.

    Showtimes where the viewer's invite graph is empty are absent from the
    result.
    """
    graph = load_page_invite_graph(
        session=session,
        viewer_id=viewer_id,
        showtime_ids=showtime_ids,
    )
    attribution_by_showtime_id: dict[int, dict[UUID, ParticipantAttribution]] = {}
    for showtime_id in graph.showtime_ids:
        attribution = attribution_for_showtime(graph=graph, showtime_id=showtime_id)
        attribution.pop(viewer_id, None)
        if len(attribution) > 0:
            attribution_by_showtime_id[showtime_id] = attribution
    return attribution_by_showtime_id


def attribution_for_showtime(
    *,
    graph: PageInviteGraph,
    showtime_id: int,
) -> dict[UUID, ParticipantAttribution]:
    """Merge one showtime's relations into an attribution per person.

    Priority is the order of the assignments below — see
    `ParticipantAttribution`.
    """
    result: dict[UUID, ParticipantAttribution] = {}
    for user_id in graph.direct_sent_ids.get(showtime_id, set()):
        result[user_id] = ParticipantAttribution(invited_by_you=True)
    for user_id in graph.direct_received_ids.get(showtime_id, set()):
        result.setdefault(user_id, ParticipantAttribution(invited_you=True))
    for user_id, inviter_id in graph.co_invited_by_inviter.get(showtime_id, {}).items():
        result.setdefault(user_id, ParticipantAttribution(inviter_id=inviter_id))
    for user_id, connector_id in graph.chain_by_connector.get(showtime_id, {}).items():
        result.setdefault(user_id, ParticipantAttribution(inviter_id=connector_id))
    return result


def get_related_participant_ids_for_showtime(
    *,
    session: Session,
    viewer_id: UUID,
    showtime_id: int,
) -> set[UUID]:
    """Everyone in the viewer's invite graph for a showtime: direct, co-invited,
    and one-hop chain connections, unfiltered by friendship.

    This is the identity graph (who's part of the viewer's invite group),
    as opposed to the friend-scoped status-visibility graph in
    `showtime_visibility.py`.
    """
    return set(
        get_related_participant_attribution_for_showtime(
            session=session, viewer_id=viewer_id, showtime_id=showtime_id
        )
    )


def get_showtime_participant_ids(
    *,
    session: Session,
    showtime_id: int,
) -> set[UUID]:
    """Everyone bound to a showtime by a ping (either direction) for the showtime.

    Used to scope effective-visibility rebuilds: a ping change can shift the
    visibility of the whole invite group, not just the two endpoints.
    """
    sender_ids = session.exec(
        select(ShowtimePing.sender_id).where(ShowtimePing.showtime_id == showtime_id)
    ).all()
    receiver_ids = session.exec(
        select(ShowtimePing.receiver_id).where(ShowtimePing.showtime_id == showtime_id)
    ).all()
    return set(sender_ids) | set(receiver_ids)


def get_sent_showtime_pings(
    *,
    session: Session,
    showtime_id: int,
    sender_id: UUID,
) -> list[tuple[ShowtimePing, str | None]]:
    """Return sent pings with receiver display names, newest first."""
    return get_sent_showtime_pings_for_showtimes(
        session=session,
        showtime_ids=[showtime_id],
        sender_id=sender_id,
    ).get(showtime_id, [])


def get_sent_showtime_pings_for_showtimes(
    *,
    session: Session,
    showtime_ids: Sequence[int],
    sender_id: UUID,
) -> dict[int, list[tuple[ShowtimePing, str | None]]]:
    """`get_sent_showtime_pings` for a page, in one query.

    Each showtime's pings keep the newest-first order. Showtimes the sender has
    invited nobody to are absent from the result.
    """
    if len(showtime_ids) == 0:
        return {}

    stmt = (
        select(ShowtimePing, User.display_name)
        .join(User, col(User.id) == col(ShowtimePing.receiver_id))
        .where(
            col(ShowtimePing.showtime_id).in_(showtime_ids),
            ShowtimePing.sender_id == sender_id,
        )
        .order_by(col(ShowtimePing.created_at).desc())
    )
    pings_by_showtime_id: dict[int, list[tuple[ShowtimePing, str | None]]] = {}
    for ping, display_name in session.exec(stmt).all():  # type: ignore[misc]
        pings_by_showtime_id.setdefault(ping.showtime_id, []).append(
            (ping, display_name)
        )
    return pings_by_showtime_id


def delete_sent_showtime_ping(
    *,
    session: Session,
    showtime_id: int,
    sender_id: UUID,
    receiver_id: UUID,
) -> bool:
    ping = get_showtime_ping(
        session=session,
        showtime_id=showtime_id,
        sender_id=sender_id,
        receiver_id=receiver_id,
    )
    if ping is None:
        return False
    session.delete(ping)
    session.flush()
    return True


def get_received_showtime_pings(
    *,
    session: Session,
    receiver_id: UUID,
    sort_by: ShowtimePingSort,
    limit: int,
    offset: int,
) -> list[ShowtimePing]:
    # Dismissed pings are hidden from the receiver's list — they stay in the DB
    # so the sender can see "dismissed" status, but the receiver never sees them again.
    dismissed_filter = col(ShowtimePing.dismissed_at).is_(None)
    if sort_by == ShowtimePingSort.SHOWTIME_DATETIME:
        stmt = (
            select(ShowtimePing)
            .join(Showtime, col(Showtime.id) == col(ShowtimePing.showtime_id))
            .where(ShowtimePing.receiver_id == receiver_id, dismissed_filter)
            .order_by(
                col(Showtime.datetime).desc(),
                col(ShowtimePing.created_at).desc(),
                col(ShowtimePing.id).desc(),
            )
            .limit(limit)
            .offset(offset)
        )
    else:
        stmt = (
            select(ShowtimePing)
            .where(ShowtimePing.receiver_id == receiver_id, dismissed_filter)
            .order_by(col(ShowtimePing.created_at).desc(), col(ShowtimePing.id).desc())
            .limit(limit)
            .offset(offset)
        )
    return list(session.exec(stmt).all())


def get_received_pings_for_showtime(
    *,
    session: Session,
    showtime_id: int,
    receiver_id: UUID,
) -> list[tuple[ShowtimePing, User]]:
    """Active (non-dismissed) received pings for a showtime, with sender, newest first."""
    return get_received_pings_for_showtimes(
        session=session,
        showtime_ids=[showtime_id],
        receiver_id=receiver_id,
    ).get(showtime_id, [])


def get_received_pings_for_showtimes(
    *,
    session: Session,
    showtime_ids: Sequence[int],
    receiver_id: UUID,
) -> dict[int, list[tuple[ShowtimePing, User]]]:
    """`get_received_pings_for_showtime` for a page, in one query.

    Each showtime's pings keep the newest-first order. Showtimes with no
    active received ping are absent from the result.
    """
    if len(showtime_ids) == 0:
        return {}

    stmt = (
        select(ShowtimePing, User)
        .join(User, col(User.id) == col(ShowtimePing.sender_id))
        .where(
            col(ShowtimePing.showtime_id).in_(showtime_ids),
            ShowtimePing.receiver_id == receiver_id,
            col(ShowtimePing.dismissed_at).is_(None),
        )
        .order_by(col(ShowtimePing.created_at).desc())
    )
    pings_by_showtime_id: dict[int, list[tuple[ShowtimePing, User]]] = {}
    for ping, sender in session.exec(stmt).all():  # type: ignore[misc]
        pings_by_showtime_id.setdefault(ping.showtime_id, []).append((ping, sender))
    return pings_by_showtime_id


def get_unseen_showtime_ping_count(
    *,
    session: Session,
    receiver_id: UUID,
) -> int:
    stmt = (
        select(func.count())
        .select_from(ShowtimePing)
        .where(
            ShowtimePing.receiver_id == receiver_id,
            col(ShowtimePing.seen_at).is_(None),
            col(ShowtimePing.dismissed_at).is_(None),
        )
    )
    count = session.exec(stmt).one()
    return int(count or 0)


def mark_received_showtime_pings_seen(
    *,
    session: Session,
    receiver_id: UUID,
    seen_at: datetime,
) -> int:
    stmt = select(ShowtimePing).where(
        ShowtimePing.receiver_id == receiver_id,
        col(ShowtimePing.seen_at).is_(None),
        col(ShowtimePing.dismissed_at).is_(None),
    )
    unseen_pings = list(session.exec(stmt).all())
    for ping in unseen_pings:
        ping.seen_at = seen_at
        session.add(ping)
    session.flush()
    return len(unseen_pings)


def dismiss_received_showtime_ping(
    *,
    session: Session,
    ping_id: int,
    receiver_id: UUID,
    dismissed_at: datetime,
) -> bool:
    stmt = select(ShowtimePing).where(
        ShowtimePing.id == ping_id,
        ShowtimePing.receiver_id == receiver_id,
    )
    ping = session.exec(stmt).one_or_none()
    if ping is None:
        return False
    ping.dismissed_at = dismissed_at
    session.add(ping)
    session.flush()
    return True


def delete_received_showtime_ping(
    *,
    session: Session,
    ping_id: int,
    receiver_id: UUID,
) -> bool:
    stmt = select(ShowtimePing).where(
        ShowtimePing.id == ping_id,
        ShowtimePing.receiver_id == receiver_id,
    )
    ping = session.exec(stmt).one_or_none()
    if ping is None:
        return False

    session.delete(ping)
    session.flush()
    return True


def delete_received_past_showtime_pings(
    *,
    session: Session,
    receiver_id: UUID,
    now: datetime,
) -> int:
    stmt = (
        select(ShowtimePing)
        .join(Showtime, col(Showtime.id) == col(ShowtimePing.showtime_id))
        .where(
            ShowtimePing.receiver_id == receiver_id,
            col(Showtime.datetime) < now,
        )
    )
    past_pings = list(session.exec(stmt).all())
    for ping in past_pings:
        session.delete(ping)
    session.flush()
    return len(past_pings)


def delete_pings_between_users(
    *,
    session: Session,
    user_id: UUID,
    other_id: UUID,
) -> int:
    """Delete every invite between two users, in both directions.

    Called when one blocks the other: an invite is a standing piece of contact
    (it sits in the receiver's notification centre and grants mutual visibility
    on that showtime), so leaving it in place would leave the block half-applied.

    Visibility is rebuilt by the caller — deleting the rows here changes what
    both users may see of each other's status.
    """
    stmt = select(ShowtimePing).where(
        or_(
            (col(ShowtimePing.sender_id) == user_id)
            & (col(ShowtimePing.receiver_id) == other_id),
            (col(ShowtimePing.sender_id) == other_id)
            & (col(ShowtimePing.receiver_id) == user_id),
        )
    )
    pings = list(session.exec(stmt).all())
    for ping in pings:
        session.delete(ping)
    session.flush()
    return len(pings)
