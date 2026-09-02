"""`showtime_crud.get_visible_non_friends_for_showtime` — the display query used
for "friends of friends interested" badges (distinct from the visibility-
granting `_friends_of_friends_ids_for_showtime` in `showtime_visibility.py`,
covered in `test_showtime_friends_of_friends_visibility.py`). Blocking must
close this off too, even when the blocked pair is connected only through a
mutual friend with no direct friendship or ping between them.
"""

from collections.abc import Callable
from uuid import UUID

from sqlmodel import Session

from app.core.enums import GoingStatus
from app.crud import friendship as friendship_crud
from app.crud import showtime as showtime_crud
from app.crud import user_block as user_block_crud
from app.models.showtime import Showtime
from app.models.user import User


def _attend(
    session: Session, *, showtime_id: int, user_id: UUID, going_status: GoingStatus
) -> None:
    showtime_crud.add_showtime_selection(
        session=session,
        showtime_id=showtime_id,
        user_id=user_id,
        going_status=going_status,
    )


def _set_up_bridge_and_friend_of_friend(
    session: Session,
    *,
    viewer: User,
    bridge: User,
    friend_of_friend: User,
    showtime: Showtime,
) -> None:
    """viewer <-> bridge <-> friend_of_friend, no direct link between viewer
    and friend_of_friend, both bridge and the friend-of-friend attending."""
    friendship_crud.create_friendship(
        session=session, user_id=viewer.id, friend_id=bridge.id
    )
    friendship_crud.create_friendship(
        session=session, user_id=bridge.id, friend_id=friend_of_friend.id
    )
    _attend(
        session,
        showtime_id=showtime.id,
        user_id=bridge.id,
        going_status=GoingStatus.GOING,
    )
    # The friend-of-friend must have their own effective visibility rebuilt
    # (triggered by adding a selection) so that the bridge is a valid viewer
    # of it — that's what `get_visible_non_friends_for_showtime` joins against.
    _attend(
        session,
        showtime_id=showtime.id,
        user_id=friend_of_friend.id,
        going_status=GoingStatus.GOING,
    )


def test_get_visible_non_friends_for_showtime_finds_the_mutual_bridge_path(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """Sanity check that the reachable-through-a-mutual-friend setup used by
    the blocking tests below actually surfaces the friend-of-friend absent
    any block, so those tests are proven to be exercising the block path."""
    viewer = user_factory()
    bridge = user_factory()
    friend_of_friend = user_factory()
    showtime = showtime_factory()

    _set_up_bridge_and_friend_of_friend(
        db_transaction,
        viewer=viewer,
        bridge=bridge,
        friend_of_friend=friend_of_friend,
        showtime=showtime,
    )
    db_transaction.commit()

    results = showtime_crud.get_visible_non_friends_for_showtime(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=viewer.id,
        going_status=GoingStatus.GOING,
        exclude_user_ids=set(),
    )

    assert friend_of_friend.id in {user.id for user in results}


def test_get_visible_non_friends_for_showtime_excludes_a_user_the_viewer_blocked(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    viewer = user_factory()
    bridge = user_factory()
    blocked_fof = user_factory()
    showtime = showtime_factory()

    _set_up_bridge_and_friend_of_friend(
        db_transaction,
        viewer=viewer,
        bridge=bridge,
        friend_of_friend=blocked_fof,
        showtime=showtime,
    )
    user_block_crud.create_block(
        session=db_transaction, blocker_id=viewer.id, blocked_id=blocked_fof.id
    )
    db_transaction.commit()

    results = showtime_crud.get_visible_non_friends_for_showtime(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=viewer.id,
        going_status=GoingStatus.GOING,
        exclude_user_ids=set(),
    )

    assert blocked_fof.id not in {user.id for user in results}


def test_get_visible_non_friends_for_showtime_excludes_a_user_who_blocked_the_viewer(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """Same as above with the block direction reversed."""
    viewer = user_factory()
    bridge = user_factory()
    blocking_fof = user_factory()
    showtime = showtime_factory()

    _set_up_bridge_and_friend_of_friend(
        db_transaction,
        viewer=viewer,
        bridge=bridge,
        friend_of_friend=blocking_fof,
        showtime=showtime,
    )
    user_block_crud.create_block(
        session=db_transaction, blocker_id=blocking_fof.id, blocked_id=viewer.id
    )
    db_transaction.commit()

    results = showtime_crud.get_visible_non_friends_for_showtime(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=viewer.id,
        going_status=GoingStatus.GOING,
        exclude_user_ids=set(),
    )

    assert blocking_fof.id not in {user.id for user in results}
