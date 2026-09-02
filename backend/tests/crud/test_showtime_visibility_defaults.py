"""Default visibility mode resolution, single and batched.

The batched lookup is what the clients prefetch a whole showtime list with, so
it has to agree with the single-showtime lookup in every case.
"""

from collections.abc import Callable

from sqlmodel import Session

from app.core.enums import VisibilityMode
from app.crud import showtime_ping as showtime_ping_crud
from app.crud import showtime_visibility as showtime_visibility_crud
from app.models.showtime import Showtime
from app.models.showtime_ping import ShowtimePing
from app.models.user import User
from app.utils import now_amsterdam_naive


def _invite(
    session: Session, *, showtime_id: int, sender: User, receiver: User
) -> ShowtimePing:
    return showtime_ping_crud.create_showtime_ping(
        session=session,
        showtime_id=showtime_id,
        sender_id=sender.id,
        receiver_id=receiver.id,
        created_at=now_amsterdam_naive(),
    )


def _default_modes(
    session: Session, *, owner: User, showtimes: list[Showtime]
) -> dict[int, VisibilityMode]:
    return showtime_visibility_crud.get_owner_default_modes_for_showtimes(
        session=session,
        owner_id=owner.id,
        showtime_ids=[showtime.id for showtime in showtimes],
    )


def _assert_matches_single_lookup(
    session: Session, *, owner: User, modes: dict[int, VisibilityMode]
) -> None:
    for showtime_id, mode in modes.items():
        assert (
            showtime_visibility_crud.get_owner_default_mode_for_showtime(
                session=session, owner_id=owner.id, showtime_id=showtime_id
            )
            == mode
        )


def test_batch_defaults_are_per_showtime_and_match_single_lookup(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
) -> None:
    """Only the showtime a private inviter invited to inherits INVITED_ONLY."""
    owner = user_factory()
    inviter = user_factory()
    private_showtime = showtime_factory()
    open_showtime = showtime_factory()
    uninvited_showtime = showtime_factory()

    _invite(
        db_transaction,
        showtime_id=private_showtime.id,
        sender=inviter,
        receiver=owner,
    )
    _invite(
        db_transaction, showtime_id=open_showtime.id, sender=inviter, receiver=owner
    )
    showtime_visibility_crud.set_visibility_mode_for_showtime(
        session=db_transaction,
        owner_id=inviter.id,
        showtime_id=private_showtime.id,
        mode=VisibilityMode.INVITED_ONLY,
        now=now_amsterdam_naive(),
    )

    modes = _default_modes(
        db_transaction,
        owner=owner,
        showtimes=[private_showtime, open_showtime, uninvited_showtime],
    )

    assert modes == {
        private_showtime.id: VisibilityMode.INVITED_ONLY,
        open_showtime.id: VisibilityMode.ALL_FRIENDS,
        uninvited_showtime.id: VisibilityMode.ALL_FRIENDS,
    }
    _assert_matches_single_lookup(db_transaction, owner=owner, modes=modes)


def test_batch_defaults_follow_an_incognito_inviter(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
) -> None:
    owner = user_factory()
    incognito_inviter = user_factory(incognito_mode=True)
    invited_showtime = showtime_factory()
    other_showtime = showtime_factory()

    _invite(
        db_transaction,
        showtime_id=invited_showtime.id,
        sender=incognito_inviter,
        receiver=owner,
    )

    modes = _default_modes(
        db_transaction, owner=owner, showtimes=[invited_showtime, other_showtime]
    )

    assert modes == {
        invited_showtime.id: VisibilityMode.INVITED_ONLY,
        other_showtime.id: VisibilityMode.ALL_FRIENDS,
    }
    _assert_matches_single_lookup(db_transaction, owner=owner, modes=modes)


def test_batch_defaults_are_invited_only_for_an_incognito_owner(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
) -> None:
    owner = user_factory(incognito_mode=True)
    showtimes = [showtime_factory(), showtime_factory()]

    modes = _default_modes(db_transaction, owner=owner, showtimes=showtimes)

    assert modes == {
        showtime.id: VisibilityMode.INVITED_ONLY for showtime in showtimes
    }
    _assert_matches_single_lookup(db_transaction, owner=owner, modes=modes)


def test_batch_defaults_ignore_a_dismissed_invite(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
) -> None:
    """A dismissed invite no longer ties the owner to the inviter's privacy."""
    owner = user_factory()
    inviter = user_factory()
    showtime = showtime_factory()

    ping = _invite(
        db_transaction, showtime_id=showtime.id, sender=inviter, receiver=owner
    )
    showtime_visibility_crud.set_visibility_mode_for_showtime(
        session=db_transaction,
        owner_id=inviter.id,
        showtime_id=showtime.id,
        mode=VisibilityMode.INVITED_ONLY,
        now=now_amsterdam_naive(),
    )
    assert ping.id is not None
    showtime_ping_crud.dismiss_received_showtime_ping(
        session=db_transaction,
        ping_id=ping.id,
        receiver_id=owner.id,
        dismissed_at=now_amsterdam_naive(),
    )

    modes = _default_modes(db_transaction, owner=owner, showtimes=[showtime])

    assert modes == {showtime.id: VisibilityMode.ALL_FRIENDS}
    _assert_matches_single_lookup(db_transaction, owner=owner, modes=modes)


def test_batch_defaults_use_the_owners_configured_default_visibility_mode(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
) -> None:
    """The baseline default is the owner's own `default_visibility_mode`, not
    a hardcoded mode — an owner who has switched theirs to ALL_FRIENDS (or
    left it at the FRIENDS_OF_FRIENDS default) sees that reflected for a
    showtime with no invites and no override at all."""
    all_friends_owner = user_factory(default_visibility_mode=VisibilityMode.ALL_FRIENDS)
    fof_owner = user_factory(default_visibility_mode=VisibilityMode.FRIENDS_OF_FRIENDS)
    showtime = showtime_factory()

    all_friends_modes = _default_modes(
        db_transaction, owner=all_friends_owner, showtimes=[showtime]
    )
    fof_modes = _default_modes(db_transaction, owner=fof_owner, showtimes=[showtime])

    assert all_friends_modes == {showtime.id: VisibilityMode.ALL_FRIENDS}
    assert fof_modes == {showtime.id: VisibilityMode.FRIENDS_OF_FRIENDS}
    _assert_matches_single_lookup(
        db_transaction, owner=all_friends_owner, modes=all_friends_modes
    )
    _assert_matches_single_lookup(db_transaction, owner=fof_owner, modes=fof_modes)


def test_batch_defaults_still_follow_a_private_inviter_over_a_custom_default(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
    showtime_factory: Callable[..., Showtime],
) -> None:
    """An owner who has personally set their default to ALL_FRIENDS is still
    escalated to INVITED_ONLY by an incognito inviter — the inviter-privacy
    override applies on top of whatever the owner's own default is, not just
    on top of the old hardcoded ALL_FRIENDS."""
    owner = user_factory(default_visibility_mode=VisibilityMode.ALL_FRIENDS)
    incognito_inviter = user_factory(incognito_mode=True)
    invited_showtime = showtime_factory()
    other_showtime = showtime_factory()

    _invite(
        db_transaction,
        showtime_id=invited_showtime.id,
        sender=incognito_inviter,
        receiver=owner,
    )

    modes = _default_modes(
        db_transaction, owner=owner, showtimes=[invited_showtime, other_showtime]
    )

    assert modes == {
        invited_showtime.id: VisibilityMode.INVITED_ONLY,
        other_showtime.id: VisibilityMode.ALL_FRIENDS,
    }
    _assert_matches_single_lookup(db_transaction, owner=owner, modes=modes)


def test_batch_defaults_for_no_showtimes(
    *,
    db_transaction: Session,
    user_factory: Callable[..., User],
) -> None:
    owner = user_factory()

    assert (
        showtime_visibility_crud.get_owner_default_modes_for_showtimes(
            session=db_transaction, owner_id=owner.id, showtime_ids=[]
        )
        == {}
    )
