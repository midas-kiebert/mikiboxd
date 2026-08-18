from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import func
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


def _sent_receiver_ids(
    *,
    session: Session,
    sender_id: UUID,
    showtime_id: int,
    eligible_only: bool = False,
) -> set[UUID]:
    stmt = select(ShowtimePing.receiver_id).where(
        ShowtimePing.showtime_id == showtime_id,
        ShowtimePing.sender_id == sender_id,
    )
    if eligible_only:
        stmt = stmt.where(
            col(ShowtimePing.receiver_had_selection_at_creation).is_(False)
        )
    return set(session.exec(stmt).all())


def _received_sender_ids(
    *,
    session: Session,
    receiver_id: UUID,
    showtime_id: int,
    eligible_only: bool = False,
) -> set[UUID]:
    stmt = select(ShowtimePing.sender_id).where(
        ShowtimePing.showtime_id == showtime_id,
        ShowtimePing.receiver_id == receiver_id,
    )
    if eligible_only:
        stmt = stmt.where(
            col(ShowtimePing.receiver_had_selection_at_creation).is_(False)
        )
    return set(session.exec(stmt).all())


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
    result: dict[UUID, UUID] = {}

    forward_connectors = _sent_receiver_ids(
        session=session,
        sender_id=viewer_id,
        showtime_id=showtime_id,
        eligible_only=eligible_only,
    )
    backward_connectors = _received_sender_ids(
        session=session,
        receiver_id=viewer_id,
        showtime_id=showtime_id,
        eligible_only=eligible_only,
    )

    for connector_id in sorted(forward_connectors | backward_connectors, key=str):
        if session.get(ShowtimeSelection, (connector_id, showtime_id)) is None:
            continue
        reached: set[UUID] = set()
        if connector_id in forward_connectors:
            reached |= _sent_receiver_ids(
                session=session,
                sender_id=connector_id,
                showtime_id=showtime_id,
                eligible_only=eligible_only,
            )
        if connector_id in backward_connectors:
            reached |= _received_sender_ids(
                session=session,
                receiver_id=connector_id,
                showtime_id=showtime_id,
                eligible_only=eligible_only,
            )
        reached.discard(viewer_id)
        for user_id in reached:
            result.setdefault(user_id, connector_id)

    return result


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
    inviter_ids = get_active_received_inviter_ids(
        session=session,
        receiver_id=viewer_id,
        showtime_id=showtime_id,
        eligible_only=eligible_only,
    )
    if len(inviter_ids) == 0:
        return {}
    stmt = (
        select(ShowtimePing.receiver_id, ShowtimePing.sender_id)
        .where(
            ShowtimePing.showtime_id == showtime_id,
            col(ShowtimePing.sender_id).in_(inviter_ids),
            ShowtimePing.receiver_id != viewer_id,
        )
        .order_by(col(ShowtimePing.sender_id))
    )
    inviter_by_receiver: dict[UUID, UUID] = {}
    for receiver_id, sender_id in session.exec(stmt).all():
        inviter_by_receiver.setdefault(receiver_id, sender_id)
    return inviter_by_receiver


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
    direct_sent_ids = _sent_receiver_ids(
        session=session, sender_id=viewer_id, showtime_id=showtime_id
    )
    direct_received_ids = _received_sender_ids(
        session=session, receiver_id=viewer_id, showtime_id=showtime_id
    )
    co_invited_by_inviter = get_co_invited_user_ids_with_inviter(
        session=session, viewer_id=viewer_id, showtime_id=showtime_id
    )
    chain_invited_by_connector = get_chain_invited_user_ids_with_connector(
        session=session, viewer_id=viewer_id, showtime_id=showtime_id
    )

    result: dict[UUID, ParticipantAttribution] = {}
    for user_id in direct_sent_ids:
        result[user_id] = ParticipantAttribution(invited_by_you=True)
    for user_id in direct_received_ids:
        result.setdefault(user_id, ParticipantAttribution(invited_you=True))
    for user_id, inviter_id in co_invited_by_inviter.items():
        result.setdefault(user_id, ParticipantAttribution(inviter_id=inviter_id))
    for user_id, connector_id in chain_invited_by_connector.items():
        result.setdefault(user_id, ParticipantAttribution(inviter_id=connector_id))

    result.pop(viewer_id, None)
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
    stmt = (
        select(ShowtimePing, User.display_name)
        .join(User, col(User.id) == col(ShowtimePing.receiver_id))
        .where(
            ShowtimePing.showtime_id == showtime_id,
            ShowtimePing.sender_id == sender_id,
        )
        .order_by(col(ShowtimePing.created_at).desc())
    )
    return list(session.exec(stmt).all())  # type: ignore[return-value]


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
    stmt = (
        select(ShowtimePing, User)
        .join(User, col(User.id) == col(ShowtimePing.sender_id))
        .where(
            ShowtimePing.showtime_id == showtime_id,
            ShowtimePing.receiver_id == receiver_id,
            col(ShowtimePing.dismissed_at).is_(None),
        )
        .order_by(col(ShowtimePing.created_at).desc())
    )
    return list(session.exec(stmt).all())  # type: ignore[return-value]


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
