"""`get_hidden_attending_friend_ids_for_showtime`: the mirror of
`get_uninvited_selected_friend_ids_for_showtime` that warns *before* marking
going/interested, rather than before switching to INVITED_ONLY. Unlike that
one, this one takes the owner's current visibility mode and per-friend
`shares_status` opt-outs into account, since it has to answer "would they
actually see me" rather than "are they connected to me at all".
"""

from collections.abc import Callable

from sqlmodel import Session

from app.core.enums import GoingStatus, VisibilityMode
from app.crud import friendship as friendship_crud
from app.crud import showtime as showtime_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.crud import showtime_visibility as showtime_visibility_crud
from app.models.showtime import Showtime
from app.models.user import User
from app.utils import now_amsterdam_naive


def _attend(
    session: Session, *, showtime_id: int, user_id, going_status: GoingStatus
) -> None:
    showtime_crud.add_showtime_selection(
        session=session,
        showtime_id=showtime_id,
        user_id=user_id,
        going_status=going_status,
    )


def _set_mode(
    session: Session, *, owner_id, showtime_id: int, mode: VisibilityMode
) -> None:
    showtime_visibility_crud.set_visibility_mode_for_showtime(
        session=session,
        owner_id=owner_id,
        showtime_id=showtime_id,
        mode=mode,
        now=now_amsterdam_naive(),
    )


def _hidden_ids(session: Session, *, owner_id, showtime_id: int) -> list:
    return showtime_visibility_crud.get_hidden_attending_friend_ids_for_showtime(
        session=session,
        owner_id=owner_id,
        showtime_id=showtime_id,
    )


def test_invited_only_owner_hides_an_unpinged_attending_friend(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """The owner defaults/explicitly sits at INVITED_ONLY, and a friend who is
    already GOING is not invited or inviting them — that friend would not see
    the owner's status, so they must be surfaced as hidden."""
    owner = user_factory()
    friend = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=friend.id
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=friend.id,
        going_status=GoingStatus.GOING,
    )
    _set_mode(
        db_transaction,
        owner_id=owner.id,
        showtime_id=showtime.id,
        mode=VisibilityMode.INVITED_ONLY,
    )
    db_transaction.commit()

    assert _hidden_ids(db_transaction, owner_id=owner.id, showtime_id=showtime.id) == [
        friend.id
    ]


def test_all_friends_mode_never_hides_a_normal_attending_friend(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """Under ALL_FRIENDS, with no opt-out in play, an attending friend would
    be visible — so they must not be reported as hidden."""
    owner = user_factory()
    friend = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=friend.id
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=friend.id,
        going_status=GoingStatus.INTERESTED,
    )
    _set_mode(
        db_transaction,
        owner_id=owner.id,
        showtime_id=showtime.id,
        mode=VisibilityMode.ALL_FRIENDS,
    )
    db_transaction.commit()

    assert _hidden_ids(db_transaction, owner_id=owner.id, showtime_id=showtime.id) == []


def test_friends_of_friends_mode_never_hides_a_normal_attending_friend(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """Same as ALL_FRIENDS, but for the FRIENDS_OF_FRIENDS mode: a normal,
    non-opted-out attending friend would also be directly visible here, so
    they must not be reported as hidden either."""
    owner = user_factory()
    friend = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=friend.id
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=friend.id,
        going_status=GoingStatus.GOING,
    )
    _set_mode(
        db_transaction,
        owner_id=owner.id,
        showtime_id=showtime.id,
        mode=VisibilityMode.FRIENDS_OF_FRIENDS,
    )
    db_transaction.commit()

    assert _hidden_ids(db_transaction, owner_id=owner.id, showtime_id=showtime.id) == []


def test_shares_status_opt_out_hides_a_friend_even_under_all_friends(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """The owner has personally opted out of sharing their status with this
    specific friend — that must hide the friend even though the mode itself
    (ALL_FRIENDS) would otherwise expose the owner to every friend."""
    owner = user_factory()
    friend = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=friend.id
    )
    friendship_crud.set_friendship_status_sharing(
        session=db_transaction,
        owner_id=owner.id,
        friend_id=friend.id,
        shares_status=False,
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=friend.id,
        going_status=GoingStatus.GOING,
    )
    _set_mode(
        db_transaction,
        owner_id=owner.id,
        showtime_id=showtime.id,
        mode=VisibilityMode.ALL_FRIENDS,
    )
    db_transaction.commit()

    assert _hidden_ids(db_transaction, owner_id=owner.id, showtime_id=showtime.id) == [
        friend.id
    ]


def test_direct_invite_grants_visibility_despite_invited_only(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """INVITED_ONLY mode, but the owner has already pinged the attending
    friend — a direct invite always grants visibility regardless of mode, so
    the friend must not be reported as hidden."""
    owner = user_factory()
    friend = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=friend.id
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=friend.id,
        going_status=GoingStatus.GOING,
    )
    showtime_ping_crud.create_showtime_ping(
        session=db_transaction,
        showtime_id=showtime.id,
        sender_id=owner.id,
        receiver_id=friend.id,
        created_at=now_amsterdam_naive(),
    )
    _set_mode(
        db_transaction,
        owner_id=owner.id,
        showtime_id=showtime.id,
        mode=VisibilityMode.INVITED_ONLY,
    )
    db_transaction.commit()

    assert _hidden_ids(db_transaction, owner_id=owner.id, showtime_id=showtime.id) == []


def test_being_invited_by_the_attending_friend_also_grants_visibility(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """Same as above but with the ping direction reversed: the attending
    friend invited the owner, rather than the other way around — still
    always visible under INVITED_ONLY."""
    owner = user_factory()
    friend = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=friend.id
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=friend.id,
        going_status=GoingStatus.GOING,
    )
    showtime_ping_crud.create_showtime_ping(
        session=db_transaction,
        showtime_id=showtime.id,
        sender_id=friend.id,
        receiver_id=owner.id,
        created_at=now_amsterdam_naive(),
    )
    _set_mode(
        db_transaction,
        owner_id=owner.id,
        showtime_id=showtime.id,
        mode=VisibilityMode.INVITED_ONLY,
    )
    db_transaction.commit()

    assert _hidden_ids(db_transaction, owner_id=owner.id, showtime_id=showtime.id) == []


def test_non_attending_friend_is_never_reported_hidden(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """A friend with no selection at all, and a friend who is explicitly
    NOT_GOING, are both irrelevant here regardless of mode — only friends who
    are actually GOING/INTERESTED can be "hidden"."""
    owner = user_factory()
    uninvolved_friend = user_factory()
    not_going_friend = user_factory()
    showtime = showtime_factory()

    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=uninvolved_friend.id
    )
    friendship_crud.create_friendship(
        session=db_transaction, user_id=owner.id, friend_id=not_going_friend.id
    )
    _attend(
        db_transaction,
        showtime_id=showtime.id,
        user_id=not_going_friend.id,
        going_status=GoingStatus.NOT_GOING,
    )
    _set_mode(
        db_transaction,
        owner_id=owner.id,
        showtime_id=showtime.id,
        mode=VisibilityMode.INVITED_ONLY,
    )
    db_transaction.commit()

    assert _hidden_ids(db_transaction, owner_id=owner.id, showtime_id=showtime.id) == []


def test_no_friends_attending_returns_empty(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
):
    """An owner with no friends attending the showtime at all gets an empty
    result, not an error — including when they have no friends whatsoever."""
    owner = user_factory()
    showtime = showtime_factory()

    _set_mode(
        db_transaction,
        owner_id=owner.id,
        showtime_id=showtime.id,
        mode=VisibilityMode.INVITED_ONLY,
    )
    db_transaction.commit()

    assert _hidden_ids(db_transaction, owner_id=owner.id, showtime_id=showtime.id) == []
