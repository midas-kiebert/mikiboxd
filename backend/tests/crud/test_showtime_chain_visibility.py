from collections.abc import Callable
from uuid import UUID

from sqlmodel import Session, select

from app.core.enums import GoingStatus, VisibilityMode
from app.crud import friendship as friendship_crud
from app.crud import showtime as showtime_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.crud import showtime_visibility as showtime_visibility_crud
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


def _set_invited_only(
    session: Session, *, owner_id: UUID, showtime_id: int
) -> None:
    """Opt the owner out of blanket ALL_FRIENDS status sharing so that plain
    friendship alone doesn't grant visibility, isolating the chain-visibility
    behaviour under test."""
    showtime_visibility_crud.set_visibility_mode_for_showtime(
        session=session,
        owner_id=owner_id,
        showtime_id=showtime_id,
        mode=VisibilityMode.INVITED_ONLY,
        now=now_amsterdam_naive(),
    )


def _ping(
    session: Session, *, showtime_id: int, sender_id: UUID, receiver_id: UUID
) -> None:
    showtime_ping_crud.create_showtime_ping(
        session=session,
        showtime_id=showtime_id,
        sender_id=sender_id,
        receiver_id=receiver_id,
        created_at=now_amsterdam_naive(),
    )


def test_chain_visibility_inactive_before_connector_accepts(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """Y invited X, X invited Z. Until X accepts, Y and Z can't see each other."""
    y = user_factory()
    x = user_factory()
    z = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=y.id, friend_id=z.id
    )
    _ping(db_transaction, showtime_id=showtime.id, sender_id=y.id, receiver_id=x.id)
    _ping(db_transaction, showtime_id=showtime.id, sender_id=x.id, receiver_id=z.id)

    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=y.id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=z.id,
        going_status=GoingStatus.GOING,
    )
    _set_invited_only(db_transaction, owner_id=y.id, showtime_id=showtime.id)
    _set_invited_only(db_transaction, owner_id=z.id, showtime_id=showtime.id)
    db_transaction.commit()

    assert z.id not in _effective_viewer_ids(db_transaction, y.id, showtime.id)
    assert y.id not in _effective_viewer_ids(db_transaction, z.id, showtime.id)


def test_chain_visibility_active_both_directions_once_connector_accepts(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """Once X (GOING or INTERESTED) accepts, Y and Z become mutually visible."""
    y = user_factory()
    x = user_factory()
    z = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=y.id, friend_id=z.id
    )
    _ping(db_transaction, showtime_id=showtime.id, sender_id=y.id, receiver_id=x.id)
    _ping(db_transaction, showtime_id=showtime.id, sender_id=x.id, receiver_id=z.id)

    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=y.id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=z.id,
        going_status=GoingStatus.GOING,
    )
    _set_invited_only(db_transaction, owner_id=y.id, showtime_id=showtime.id)
    _set_invited_only(db_transaction, owner_id=z.id, showtime_id=showtime.id)
    db_transaction.commit()

    # X accepts (INTERESTED is enough, doesn't need to be GOING).
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=x.id,
        going_status=GoingStatus.INTERESTED,
    )
    db_transaction.commit()

    assert z.id in _effective_viewer_ids(db_transaction, y.id, showtime.id)
    assert y.id in _effective_viewer_ids(db_transaction, z.id, showtime.id)


def test_chain_visibility_cleared_when_connector_removes_selection(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """X going NOT_GOING (i.e. removing their selection) drops chain visibility
    for the people they were connecting."""
    y = user_factory()
    x = user_factory()
    z = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=y.id, friend_id=z.id
    )
    _ping(db_transaction, showtime_id=showtime.id, sender_id=y.id, receiver_id=x.id)
    _ping(db_transaction, showtime_id=showtime.id, sender_id=x.id, receiver_id=z.id)

    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=y.id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=z.id,
        going_status=GoingStatus.GOING,
    )
    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=x.id,
        going_status=GoingStatus.GOING,
    )
    _set_invited_only(db_transaction, owner_id=y.id, showtime_id=showtime.id)
    _set_invited_only(db_transaction, owner_id=z.id, showtime_id=showtime.id)
    db_transaction.commit()

    # Sanity: chain visibility is active before X backs out.
    assert z.id in _effective_viewer_ids(db_transaction, y.id, showtime.id)
    assert y.id in _effective_viewer_ids(db_transaction, z.id, showtime.id)

    showtime_crud.remove_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=x.id,
    )
    db_transaction.commit()

    assert z.id not in _effective_viewer_ids(db_transaction, y.id, showtime.id)
    assert y.id not in _effective_viewer_ids(db_transaction, z.id, showtime.id)


def test_chain_visibility_is_capped_at_one_hop(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """Y -> X -> Z -> W. Even with everyone accepted, W (Z's own invitee) must
    not become visible to Y — only Z, X's immediate connection, does."""
    y = user_factory()
    x = user_factory()
    z = user_factory()
    w = user_factory()
    showtime = showtime_factory()

    # Both Z and W are friends of Y, so the only thing that can exclude W from
    # Y's effective visibility is the one-hop cap, not the friendship filter.
    friendship_crud.create_friendship(
        session=db_transaction, user_id=y.id, friend_id=z.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=y.id, friend_id=w.id
    )
    _ping(db_transaction, showtime_id=showtime.id, sender_id=y.id, receiver_id=x.id)
    _ping(db_transaction, showtime_id=showtime.id, sender_id=x.id, receiver_id=z.id)
    _ping(db_transaction, showtime_id=showtime.id, sender_id=z.id, receiver_id=w.id)

    for user_id in (y.id, x.id, z.id, w.id):
        showtime_crud.add_showtime_selection(
            session=db_transaction,
            showtime_id=showtime.id,
            user_id=user_id,
            going_status=GoingStatus.GOING,
        )
    _set_invited_only(db_transaction, owner_id=y.id, showtime_id=showtime.id)
    db_transaction.commit()

    effective_for_y = _effective_viewer_ids(db_transaction, y.id, showtime.id)
    assert z.id in effective_for_y
    assert w.id not in effective_for_y


def test_chain_visibility_only_surfaces_friends_of_the_viewer(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """Z is in Y's ping chain via X, but Y and Z are not friends, so Z must not
    appear in Y's effective visibility even once X has accepted."""
    y = user_factory()
    x = user_factory()
    z = user_factory()
    showtime = showtime_factory()

    _ping(db_transaction, showtime_id=showtime.id, sender_id=y.id, receiver_id=x.id)
    _ping(db_transaction, showtime_id=showtime.id, sender_id=x.id, receiver_id=z.id)

    for user_id in (y.id, x.id, z.id):
        showtime_crud.add_showtime_selection(
            session=db_transaction,
            showtime_id=showtime.id,
            user_id=user_id,
            going_status=GoingStatus.GOING,
        )
    db_transaction.commit()

    assert z.id not in _effective_viewer_ids(db_transaction, y.id, showtime.id)
    assert y.id not in _effective_viewer_ids(db_transaction, z.id, showtime.id)

    # The pair is still visible in the raw (friendship-unfiltered) invite graph
    # used for non-friend participant surfacing — the gap is only in the
    # friend-scoped effective-visibility cache.
    assert z.id in showtime_ping_crud.get_related_participant_ids_for_showtime(
        session=db_transaction, viewer_id=y.id, showtime_id=showtime.id
    )
    assert y.id in showtime_ping_crud.get_related_participant_ids_for_showtime(
        session=db_transaction, viewer_id=z.id, showtime_id=showtime.id
    )


def test_get_related_participant_ids_includes_full_chain_unfiltered_by_friendship(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """get_related_participant_ids_for_showtime returns the direct, co-invited,
    and one-hop chain identity graph regardless of friendship."""
    y = user_factory()
    x = user_factory()
    z = user_factory()
    bystander = user_factory()
    showtime = showtime_factory()

    _ping(db_transaction, showtime_id=showtime.id, sender_id=y.id, receiver_id=x.id)
    _ping(db_transaction, showtime_id=showtime.id, sender_id=x.id, receiver_id=z.id)

    showtime_crud.add_showtime_selection(
        session=db_transaction,
        showtime_id=showtime.id,
        user_id=x.id,
        going_status=GoingStatus.INTERESTED,
    )
    db_transaction.commit()

    related_ids = showtime_ping_crud.get_related_participant_ids_for_showtime(
        session=db_transaction, viewer_id=y.id, showtime_id=showtime.id
    )
    assert related_ids == {x.id, z.id}
    assert bystander.id not in related_ids
