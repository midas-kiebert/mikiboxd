"""`moderation.block_user`'s unconditional `ShowtimeVisibilityEffective`
rebuild (via `_tear_down_contact`).

Before FRIENDS_OF_FRIENDS existed, that rebuild only ran when a direct
friendship or ping was actually torn down. Under FRIENDS_OF_FRIENDS two
people can be cross-visible purely through a mutual friend, with no direct
Friendship or ShowtimePing row between them at all — so the rebuild now
always runs for both users, and this is what proves blocking still clears
that stale cross-visibility in that no-direct-relation case.

Uses a real session (like the crud visibility tests), not a mocked one — the
thing under test is the actual database state after the call, not which crud
functions got invoked.
"""

from collections.abc import Callable
from uuid import UUID

from sqlmodel import Session, select

from app.core.enums import GoingStatus, VisibilityMode
from app.crud import friendship as friendship_crud
from app.crud import showtime as showtime_crud
from app.crud import showtime_visibility as showtime_visibility_crud
from app.models.showtime import Showtime
from app.models.showtime_visibility import ShowtimeVisibilityEffective
from app.models.user import User
from app.services import moderation as moderation_service
from app.utils import now_amsterdam_naive


def _effective_viewer_ids(
    session: Session, owner_id: UUID, showtime_id: int
) -> set[UUID]:
    return set(
        session.exec(
            select(ShowtimeVisibilityEffective.viewer_id).where(
                ShowtimeVisibilityEffective.owner_id == owner_id,
                ShowtimeVisibilityEffective.showtime_id == showtime_id,
            )
        ).all()
    )


def test_blocking_a_friend_of_friend_clears_stale_cross_visibility_with_no_direct_relation(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """owner and friend_of_friend are connected only through bridge (no
    Friendship or ShowtimePing row between owner and friend_of_friend
    directly), so before this fix `_tear_down_contact`'s conditional rebuild
    would never have run for either of them and the stale visibility would
    have survived the block."""
    owner = user_factory()
    bridge = user_factory()
    friend_of_friend = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=bridge.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=bridge.id, friend_id=friend_of_friend.id
    )
    showtime_visibility_crud.set_visibility_mode_for_showtime(
        session=db_transaction,
        owner_id=owner.id,
        showtime_id=showtime.id,
        mode=VisibilityMode.FRIENDS_OF_FRIENDS,
        now=now_amsterdam_naive(),
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=owner.id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=bridge.id,
        going_status=GoingStatus.GOING,
    )
    db_transaction.commit()

    # Sanity: the friend-of-friend is cross-visible before any block exists,
    # and there is genuinely no direct Friendship/ShowtimePing between them.
    assert friend_of_friend.id in _effective_viewer_ids(
        db_transaction, owner.id, showtime.id
    )
    assert not friendship_crud.are_users_friends(
        session=db_transaction, user_id=owner.id, friend_id=friend_of_friend.id
    )

    moderation_service.block_user(
        session=db_transaction,
        blocker_id=owner.id,
        blocked_id=friend_of_friend.id,
    )

    assert friend_of_friend.id not in _effective_viewer_ids(
        db_transaction, owner.id, showtime.id
    )
