"""Reads and writes for `UserBlock`.

`get_hidden_user_ids` is the one every caller outside moderation wants: it
folds both directions into a single set, which is what "these two must not see
or reach each other" actually means. Reach for the directional helpers only
when the asymmetry matters — listing what *this* user has blocked, or lifting a
block they own.
"""

from datetime import datetime
from uuid import UUID

from sqlmodel import Session, col, or_, select

from app.models.user import User
from app.models.user_block import UserBlock


def create_block(
    *,
    session: Session,
    blocker_id: UUID,
    blocked_id: UUID,
) -> UserBlock:
    """Record that `blocker_id` blocked `blocked_id`.

    Idempotent: re-blocking someone already blocked returns the existing row
    rather than raising, so a double-tap or a stale client cannot turn a block
    into an error the user has to interpret.
    """
    existing = session.get(UserBlock, (blocker_id, blocked_id))
    if existing is not None:
        return existing
    block = UserBlock(blocker_id=blocker_id, blocked_id=blocked_id)
    session.add(block)
    session.flush()
    return block


def delete_block(
    *,
    session: Session,
    blocker_id: UUID,
    blocked_id: UUID,
) -> bool:
    """Lift a block. Returns False if there was nothing to lift."""
    block = session.get(UserBlock, (blocker_id, blocked_id))
    if block is None:
        return False
    session.delete(block)
    session.flush()
    return True


def is_blocked_either_way(
    *,
    session: Session,
    user_id: UUID,
    other_id: UUID,
) -> bool:
    """Whether either user has blocked the other.

    The check every contact attempt makes. Asking it in one direction only
    would let a blocked user keep sending friend requests and invites to the
    person who blocked them.
    """
    stmt = select(UserBlock.blocker_id).where(
        or_(
            (col(UserBlock.blocker_id) == user_id)
            & (col(UserBlock.blocked_id) == other_id),
            (col(UserBlock.blocker_id) == other_id)
            & (col(UserBlock.blocked_id) == user_id),
        )
    )
    return session.exec(stmt).first() is not None


def get_blocked_ids(*, session: Session, blocker_id: UUID) -> set[UUID]:
    """Users this user has blocked."""
    stmt = select(UserBlock.blocked_id).where(col(UserBlock.blocker_id) == blocker_id)
    return set(session.exec(stmt).all())


def get_blocked_by_ids(*, session: Session, blocked_id: UUID) -> set[UUID]:
    """Users who have blocked this user. Never surfaced to them."""
    stmt = select(UserBlock.blocker_id).where(col(UserBlock.blocked_id) == blocked_id)
    return set(session.exec(stmt).all())


def get_hidden_user_ids(*, session: Session, user_id: UUID) -> set[UUID]:
    """Everyone this user must not see, and who must not see them.

    Both directions in one query, because every caller that filters a list of
    people wants both and a caller that remembers only one is a bug that is
    invisible until someone is harassed through it.
    """
    stmt = select(UserBlock.blocker_id, UserBlock.blocked_id).where(
        or_(
            col(UserBlock.blocker_id) == user_id,
            col(UserBlock.blocked_id) == user_id,
        )
    )
    hidden: set[UUID] = set()
    for blocker_id, blocked_id in session.exec(stmt).all():
        hidden.add(blocked_id if blocker_id == user_id else blocker_id)
    return hidden


def list_blocked_users(
    *, session: Session, blocker_id: UUID
) -> list[tuple[User, datetime]]:
    """(blocked user, when they were blocked), newest first.

    Joined rather than two queries because the manage screen shows both, and
    the block timestamp is the only thing it can sort by — a blocked user is no
    longer reachable through search, so there is nothing else to order on.
    """
    stmt = (
        select(User, UserBlock.created_at)  # type: ignore[call-overload]
        .join(UserBlock, col(UserBlock.blocked_id) == col(User.id))
        .where(col(UserBlock.blocker_id) == blocker_id)
        .order_by(col(UserBlock.created_at).desc())
    )
    return list(session.exec(stmt).all())  # type: ignore[return-value]
