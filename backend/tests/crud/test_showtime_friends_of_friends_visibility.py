"""FRIENDS_OF_FRIENDS visibility mode: the two-hop `_friends_of_friends_ids_for_showtime`
bridging behaviour, exercised through the public `rebuild_effective_visibility_for_showtime`
entry point and the resulting `ShowtimeVisibilityEffective` rows (same style as
`test_showtime_chain_visibility.py`).
"""

from collections.abc import Callable
from uuid import UUID

from sqlmodel import Session, select

from app.core.enums import GoingStatus, VisibilityMode
from app.crud import friendship as friendship_crud
from app.crud import showtime as showtime_crud
from app.crud import showtime_visibility as showtime_visibility_crud
from app.crud import user_block as user_block_crud
from app.models.showtime import Showtime
from app.models.showtime_visibility import ShowtimeVisibilityEffective
from app.models.user import User
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


def _set_friends_of_friends(
    session: Session, *, owner_id: UUID, showtime_id: int
) -> None:
    showtime_visibility_crud.set_visibility_mode_for_showtime(
        session=session,
        owner_id=owner_id,
        showtime_id=showtime_id,
        mode=VisibilityMode.FRIENDS_OF_FRIENDS,
        now=now_amsterdam_naive(),
    )


def _attend(
    session: Session, *, showtime_id: int, user_id: UUID, going_status: GoingStatus
) -> None:
    showtime_crud.add_showtime_selection(
        session=session,
        showtime_id=showtime_id,
        user_id=user_id,
        going_status=going_status,
    )


def test_attending_bridge_extends_visibility_to_their_entire_friend_list(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """A friend who is GOING/INTERESTED bridges every one of *their* friends
    in, including one who isn't attending the showtime at all — being one hop
    from an attending friend is what earns visibility, not attending oneself."""
    owner = user_factory()
    bridge = user_factory()
    friend_of_bridge = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=bridge.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=bridge.id, friend_id=friend_of_bridge.id
    )

    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=owner.id,
        going_status=GoingStatus.GOING,
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=bridge.id,
        going_status=GoingStatus.INTERESTED,
    )
    _set_friends_of_friends(db_transaction, owner_id=owner.id, showtime_id=showtime.id)
    db_transaction.commit()

    effective = _effective_viewer_ids(db_transaction, owner.id, showtime.id)
    assert bridge.id in effective
    assert friend_of_bridge.id in effective


def test_bridge_who_opted_out_toward_owner_bridges_nobody_in(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """A bridge who has stopped sharing *their own* status with the owner
    can't be used as a bridge at all, even while attending — the owner has no
    way of knowing they're attending in the first place."""
    owner = user_factory()
    bridge = user_factory()
    friend_of_bridge = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=bridge.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=bridge.id, friend_id=friend_of_bridge.id
    )
    friendship_crud.set_friendship_status_sharing(
        session=db_transaction,
        owner_id=bridge.id,
        friend_id=owner.id,
        shares_status=False,
    )

    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=owner.id,
        going_status=GoingStatus.GOING,
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=bridge.id,
        going_status=GoingStatus.GOING,
    )
    _set_friends_of_friends(db_transaction, owner_id=owner.id, showtime_id=showtime.id)
    db_transaction.commit()

    effective = _effective_viewer_ids(db_transaction, owner.id, showtime.id)
    assert friend_of_bridge.id not in effective


def test_bridge_still_works_despite_the_owners_own_opt_out_in_the_other_direction(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """Asymmetric case: the owner has opted out of sharing *their own* status
    with the bridge (so the bridge loses direct visibility of the owner), but
    the bridge hasn't opted out toward the owner in the other direction — the
    bridge still successfully bridges friend-of-friends in, because bridging
    only cares about the bridge's own share setting, not the owner's."""
    owner = user_factory()
    bridge = user_factory()
    friend_of_bridge = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=bridge.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=bridge.id, friend_id=friend_of_bridge.id
    )
    friendship_crud.set_friendship_status_sharing(
        session=db_transaction,
        owner_id=owner.id,
        friend_id=bridge.id,
        shares_status=False,
    )

    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=owner.id,
        going_status=GoingStatus.GOING,
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=bridge.id,
        going_status=GoingStatus.GOING,
    )
    _set_friends_of_friends(db_transaction, owner_id=owner.id, showtime_id=showtime.id)
    db_transaction.commit()

    effective = _effective_viewer_ids(db_transaction, owner.id, showtime.id)
    # The owner opted out toward the bridge directly, so the bridge itself
    # doesn't gain direct visibility of the owner's status...
    assert bridge.id not in effective
    # ...but still successfully bridges their own friend in.
    assert friend_of_bridge.id in effective


def test_owners_own_opted_out_friend_never_regains_visibility_via_another_bridge(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """Someone the owner personally opted out of sharing with must stay
    invisible even when they'd otherwise qualify as a friend-of-friend
    through a completely different, unrelated bridge."""
    owner = user_factory()
    bridge = user_factory()
    opted_out_friend = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=bridge.id
    )
    # The opted-out friend is a direct friend of the owner *and* a friend of
    # the bridge, so the only thing that can exclude them is the owner's own
    # opt-out, not a lack of a path in.
    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=opted_out_friend.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=bridge.id, friend_id=opted_out_friend.id
    )
    friendship_crud.set_friendship_status_sharing(
        session=db_transaction,
        owner_id=owner.id,
        friend_id=opted_out_friend.id,
        shares_status=False,
    )

    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=owner.id,
        going_status=GoingStatus.GOING,
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=bridge.id,
        going_status=GoingStatus.GOING,
    )
    _set_friends_of_friends(db_transaction, owner_id=owner.id, showtime_id=showtime.id)
    db_transaction.commit()

    effective = _effective_viewer_ids(db_transaction, owner.id, showtime.id)
    assert opted_out_friend.id not in effective


def test_blocked_friend_of_friend_excluded_when_owner_is_the_blocker(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """Blocking is absolute even through a purely two-hop path: if the owner
    blocked the friend-of-friend, that person must never appear, even with no
    direct friendship or ping between the two of them."""
    owner = user_factory()
    bridge = user_factory()
    blocked_fof = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=bridge.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=bridge.id, friend_id=blocked_fof.id
    )
    user_block_crud.create_block(
        session=db_transaction, blocker_id=owner.id, blocked_id=blocked_fof.id
    )

    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=owner.id,
        going_status=GoingStatus.GOING,
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=bridge.id,
        going_status=GoingStatus.GOING,
    )
    _set_friends_of_friends(db_transaction, owner_id=owner.id, showtime_id=showtime.id)
    db_transaction.commit()

    effective = _effective_viewer_ids(db_transaction, owner.id, showtime.id)
    assert blocked_fof.id not in effective


def test_blocked_friend_of_friend_excluded_when_owner_is_the_blocked_party(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """Same as above with the block direction reversed: the friend-of-friend
    blocked the owner, not the other way around — still must not appear."""
    owner = user_factory()
    bridge = user_factory()
    blocking_fof = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=bridge.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=bridge.id, friend_id=blocking_fof.id
    )
    user_block_crud.create_block(
        session=db_transaction, blocker_id=blocking_fof.id, blocked_id=owner.id
    )

    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=owner.id,
        going_status=GoingStatus.GOING,
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=bridge.id,
        going_status=GoingStatus.GOING,
    )
    _set_friends_of_friends(db_transaction, owner_id=owner.id, showtime_id=showtime.id)
    db_transaction.commit()

    effective = _effective_viewer_ids(db_transaction, owner.id, showtime.id)
    assert blocking_fof.id not in effective


def test_bridge_who_unselects_stops_bridging_their_friends_in(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """A bridge who drops their own selection is no longer a bridge: their
    friends must lose the visibility they only had through them, without
    anything happening to the owner's own selection."""
    owner = user_factory()
    bridge = user_factory()
    friend_of_bridge = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=bridge.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=bridge.id, friend_id=friend_of_bridge.id
    )

    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=owner.id,
        going_status=GoingStatus.INTERESTED,
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=bridge.id,
        going_status=GoingStatus.INTERESTED,
    )
    _set_friends_of_friends(db_transaction, owner_id=owner.id, showtime_id=showtime.id)
    db_transaction.commit()

    assert friend_of_bridge.id in _effective_viewer_ids(
        db_transaction, owner.id, showtime.id
    )

    showtime_crud.remove_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=bridge.id,
    )
    db_transaction.commit()

    effective = _effective_viewer_ids(db_transaction, owner.id, showtime.id)
    assert friend_of_bridge.id not in effective
    assert bridge.id in effective  # still a direct friend of the owner
