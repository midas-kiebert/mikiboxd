from datetime import datetime
from uuid import UUID

from sqlmodel import Session, col, delete, select
from sqlmodel.sql.expression import SelectOfScalar

from app.core.enums import GoingStatus, VisibilityMode
from app.crud import showtime_ping as showtime_ping_crud
from app.crud import user_block as user_block_crud
from app.models.friendship import Friendship
from app.models.showtime_selection import ShowtimeSelection
from app.models.showtime_visibility import (
    ShowtimeVisibilityEffective,
    ShowtimeVisibilitySetting,
)
from app.models.user import User


def get_showtime_visibility_setting(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
) -> ShowtimeVisibilitySetting | None:
    return session.get(ShowtimeVisibilitySetting, (owner_id, showtime_id))


def get_showtime_visibility_settings_for_showtimes(
    *,
    session: Session,
    owner_id: UUID,
    showtime_ids: list[int],
) -> dict[int, ShowtimeVisibilitySetting]:
    if len(showtime_ids) == 0:
        return {}

    stmt = select(ShowtimeVisibilitySetting).where(
        ShowtimeVisibilitySetting.owner_id == owner_id,
        col(ShowtimeVisibilitySetting.showtime_id).in_(showtime_ids),
    )
    settings = list(session.exec(stmt).all())
    return {setting.showtime_id: setting for setting in settings}


def _all_friend_ids(*, session: Session, owner_id: UUID) -> set[UUID]:
    return set(
        session.exec(
            select(Friendship.friend_id).where(col(Friendship.user_id) == owner_id)
        ).all()
    )


def get_uninvited_selected_friend_ids_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
) -> list[UUID]:
    """Friends already GOING/INTERESTED on this showtime with no ping (in
    either direction, eligible or not) connecting them to the owner yet.

    Used to warn the owner, before they switch to INVITED_ONLY, which
    currently-visible friends would otherwise silently lose visibility.
    Deliberately ignores the current visibility mode, `shares_status`, and
    the `ShowtimeVisibilityEffective` cache — this must surface friends
    regardless of whether they're visible right now.
    """
    friend_ids = _all_friend_ids(session=session, owner_id=owner_id)
    if len(friend_ids) == 0:
        return []

    selected_friend_ids = set(
        session.exec(
            select(ShowtimeSelection.user_id).where(
                ShowtimeSelection.showtime_id == showtime_id,
                col(ShowtimeSelection.user_id).in_(friend_ids),
                col(ShowtimeSelection.going_status).in_(
                    [GoingStatus.GOING, GoingStatus.INTERESTED]
                ),
            )
        ).all()
    )
    if len(selected_friend_ids) == 0:
        return []

    already_pinged_ids = showtime_ping_crud.get_ping_counterpart_ids_for_showtime(
        session=session,
        owner_id=owner_id,
        showtime_id=showtime_id,
        eligible_only=False,
    )
    return sorted(selected_friend_ids - already_pinged_ids, key=str)


def get_hidden_attending_friend_ids_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
) -> list[UUID]:
    """Friends already GOING/INTERESTED on this showtime who would *not* be
    able to see the owner's status if the owner selects GOING/INTERESTED now,
    given the owner's current visibility mode and per-friend `shares_status`
    opt-outs.

    Used to warn the owner, before they mark going/interested, that some
    friends who are visibly already attending won't see the owner's status
    unless invited. The mirror of
    `get_uninvited_selected_friend_ids_for_showtime`: that one ignores the
    current mode because it warns about a mode the owner is about to switch
    *to*, this one applies the mode because it warns about the mode already
    in force.
    """
    attending_friend_ids = _attending_friend_ids(
        session=session, owner_id=owner_id, showtime_id=showtime_id
    )
    if len(attending_friend_ids) == 0:
        return []

    would_be_visible_ids = _compute_visible_friend_ids_for_attending_owner(
        session=session, owner_id=owner_id, showtime_id=showtime_id
    )
    return sorted(attending_friend_ids - would_be_visible_ids, key=str)


def _status_sharing_friend_ids(*, session: Session, owner_id: UUID) -> set[UUID]:
    """Friends the owner hasn't opted out of sharing their status with."""
    return set(
        session.exec(
            select(Friendship.friend_id).where(
                col(Friendship.user_id) == owner_id,
                col(Friendship.shares_status).is_(True),
            )
        ).all()
    )


def _friends_sharing_status_with(
    *, session: Session, friend_ids: set[UUID], target_id: UUID
) -> set[UUID]:
    """Of `friend_ids`, which have *not* opted out of sharing their own status
    with `target_id` — the mirror of `_status_sharing_friend_ids` with the
    direction flipped: that asks who *the owner* shares with, this asks which
    of the owner's friends share back *with the owner*.
    """
    if len(friend_ids) == 0:
        return set()
    return set(
        session.exec(
            select(Friendship.user_id).where(
                col(Friendship.user_id).in_(friend_ids),
                Friendship.friend_id == target_id,
                col(Friendship.shares_status).is_(True),
            )
        ).all()
    )


def _attending_friend_ids(
    *, session: Session, owner_id: UUID, showtime_id: int
) -> set[UUID]:
    """The owner's friends who are GOING/INTERESTED on this showtime."""
    all_friend_ids = _all_friend_ids(session=session, owner_id=owner_id)
    if len(all_friend_ids) == 0:
        return set()
    return set(
        session.exec(
            select(ShowtimeSelection.user_id).where(
                ShowtimeSelection.showtime_id == showtime_id,
                col(ShowtimeSelection.user_id).in_(all_friend_ids),
                col(ShowtimeSelection.going_status).in_(
                    [GoingStatus.GOING, GoingStatus.INTERESTED]
                ),
            )
        ).all()
    )


def _friends_of_friends_ids_for_showtime(
    *, session: Session, owner_id: UUID, showtime_id: int
) -> set[UUID]:
    """Friends of the owner's attending, status-sharing friends.

    Used by FRIENDS_OF_FRIENDS mode: a bridge is a friend of the owner who is
    GOING/INTERESTED on this showtime *and* who has not opted out of sharing
    their own status with the owner — the owner's opt-out toward the bridge
    does not disqualify the bridge from bridging (that only ever blocks the
    owner's status flowing back to the bridge itself, handled elsewhere by
    `_status_sharing_friend_ids`). A bridge's friends gain visibility whether
    or not they are themselves attending — being one hop from someone who is
    is what earns it, not attending too.

    A bridge only carries the owner's status to the friends of theirs who can
    already see the bridge's *own* status on this showtime. Without that,
    seeing a stranger here announces the existence of a mutual friend who is
    interested but hiding it: if B keeps their status invite-only from A,
    then A learning about B's friend C — reachable only through B — tells A
    exactly what B chose not to say. Only visible friends bridge.

    Two exclusions apply after bridging: someone the owner has personally
    opted out of sharing with must never regain visibility through a
    different bridge, and a blocked pair must never see each other through
    any path (see `services.moderation` — blocking tears down direct
    friendship/pings, but can't touch a purely two-hop connection like this
    one, so this function has to enforce it directly).
    """
    all_friend_ids = _all_friend_ids(session=session, owner_id=owner_id)
    if len(all_friend_ids) == 0:
        return set()

    attending_friend_ids = _attending_friend_ids(
        session=session, owner_id=owner_id, showtime_id=showtime_id
    )
    if len(attending_friend_ids) == 0:
        return set()

    bridge_ids = _friends_sharing_status_with(
        session=session, friend_ids=attending_friend_ids, target_id=owner_id
    )
    if len(bridge_ids) == 0:
        return set()

    # Each bridge's friends, narrowed to the ones the bridge is itself visible
    # to on this showtime — a friend who cannot see the bridge must not be
    # told about anyone standing behind it.
    fof_ids = set(
        session.exec(
            select(Friendship.friend_id)
            .join(
                ShowtimeVisibilityEffective,
                (col(ShowtimeVisibilityEffective.owner_id) == col(Friendship.user_id))
                & (
                    col(ShowtimeVisibilityEffective.viewer_id)
                    == col(Friendship.friend_id)
                )
                & (col(ShowtimeVisibilityEffective.showtime_id) == showtime_id),
            )
            .where(col(Friendship.user_id).in_(bridge_ids))
        ).all()
    )

    owner_opted_out_ids = all_friend_ids - _status_sharing_friend_ids(
        session=session, owner_id=owner_id
    )
    hidden_ids = user_block_crud.get_hidden_user_ids(session=session, user_id=owner_id)
    return fof_ids - owner_opted_out_ids - hidden_ids - {owner_id}


def _incognito_user_ids(*, session: Session, user_ids: set[UUID]) -> set[UUID]:
    if len(user_ids) == 0:
        return set()
    return set(
        session.exec(
            select(User.id).where(
                col(User.id).in_(user_ids),
                col(User.incognito_mode).is_(True),
            )
        ).all()
    )


def _invited_only_owner_showtime_pairs(
    *,
    session: Session,
    owner_ids: set[UUID],
    showtime_ids: list[int],
) -> set[tuple[UUID, int]]:
    """(owner, showtime) pairs explicitly set to INVITED_ONLY by those owners."""
    if len(owner_ids) == 0 or len(showtime_ids) == 0:
        return set()
    stmt = select(
        ShowtimeVisibilitySetting.owner_id, ShowtimeVisibilitySetting.showtime_id
    ).where(
        col(ShowtimeVisibilitySetting.owner_id).in_(owner_ids),
        col(ShowtimeVisibilitySetting.showtime_id).in_(showtime_ids),
        ShowtimeVisibilitySetting.mode == VisibilityMode.INVITED_ONLY,
    )
    return set(session.exec(stmt).all())


def get_owner_default_modes_for_showtimes(
    *,
    session: Session,
    owner_id: UUID,
    showtime_ids: list[int],
) -> dict[int, VisibilityMode]:
    """The mode applied to showtimes the owner hasn't explicitly configured.

    Defaults to the owner's `default_visibility_mode`, but mirrors a private
    inviter: if anyone with an active invite out to the owner is keeping a
    showtime invite-only (or is incognito), the owner defaults to
    INVITED_ONLY for it too — regardless of their own chosen default.
    Incognito owners are always INVITED_ONLY. An inviter's privacy is
    resolved one level only (their own inviters are not followed) to avoid
    cycles.

    Runs a constant number of queries regardless of how many showtimes are
    asked for, so the client can prefetch a whole list in one request.
    """
    if len(showtime_ids) == 0:
        return {}

    owner = session.get(User, owner_id)
    if owner is not None and owner.incognito_mode:
        return {
            showtime_id: VisibilityMode.INVITED_ONLY for showtime_id in showtime_ids
        }

    owner_default_mode = (
        owner.default_visibility_mode
        if owner is not None
        else VisibilityMode.FRIENDS_OF_FRIENDS
    )
    modes = {showtime_id: owner_default_mode for showtime_id in showtime_ids}
    inviter_ids_by_showtime_id = (
        showtime_ping_crud.get_active_received_inviter_ids_for_showtimes(
            session=session,
            receiver_id=owner_id,
            showtime_ids=showtime_ids,
            eligible_only=True,
        )
    )
    all_inviter_ids = {
        inviter_id
        for inviter_ids in inviter_ids_by_showtime_id.values()
        for inviter_id in inviter_ids
    }
    if len(all_inviter_ids) == 0:
        return modes

    incognito_inviter_ids = _incognito_user_ids(
        session=session, user_ids=all_inviter_ids
    )
    private_inviter_showtime_pairs = _invited_only_owner_showtime_pairs(
        session=session, owner_ids=all_inviter_ids, showtime_ids=showtime_ids
    )
    for showtime_id, inviter_ids in inviter_ids_by_showtime_id.items():
        has_private_inviter = any(
            inviter_id in incognito_inviter_ids
            or (inviter_id, showtime_id) in private_inviter_showtime_pairs
            for inviter_id in inviter_ids
        )
        if has_private_inviter:
            modes[showtime_id] = VisibilityMode.INVITED_ONLY
    return modes


def get_effective_modes_for_showtimes(
    *,
    session: Session,
    owner_id: UUID,
    showtime_ids: list[int],
) -> dict[int, VisibilityMode]:
    """The mode actually in force for each showtime: what the owner set for it,
    or the default they fall back to.

    Batched — a constant number of queries however many showtimes are asked
    for — because it is resolved for whole pages of showtimes at a time: both
    the visibility batch endpoint and the modes carried inline on listed
    showtimes come through here.
    """
    if len(showtime_ids) == 0:
        return {}

    deduped = list(dict.fromkeys(showtime_ids))
    settings = get_showtime_visibility_settings_for_showtimes(
        session=session, owner_id=owner_id, showtime_ids=deduped
    )
    defaults = get_owner_default_modes_for_showtimes(
        session=session, owner_id=owner_id, showtime_ids=deduped
    )
    return {
        showtime_id: (
            settings[showtime_id].mode
            if showtime_id in settings
            else defaults[showtime_id]
        )
        for showtime_id in deduped
    }


def get_owner_default_mode_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
) -> VisibilityMode:
    """Single-showtime `get_owner_default_modes_for_showtimes`."""
    modes = get_owner_default_modes_for_showtimes(
        session=session,
        owner_id=owner_id,
        showtime_ids=[showtime_id],
    )
    return modes[showtime_id]


def _compute_effective_visible_friend_ids_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
) -> set[UUID]:
    owner_selection = session.get(ShowtimeSelection, (owner_id, showtime_id))
    if owner_selection is None:
        return set()
    return _compute_visible_friend_ids_for_attending_owner(
        session=session, owner_id=owner_id, showtime_id=showtime_id
    )


def _compute_visible_friend_ids_for_attending_owner(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
) -> set[UUID]:
    """The friends who can see the owner's status on this showtime, given the
    owner's current visibility mode and per-friend opt-outs.

    Split out from `_compute_effective_visible_friend_ids_for_showtime` so it
    can also be used to answer "who *would* see me" before the owner has
    actually selected GOING/INTERESTED yet (see
    `get_hidden_attending_friend_ids_for_showtime`).
    """
    all_friend_ids = _all_friend_ids(session=session, owner_id=owner_id)
    if len(all_friend_ids) == 0:
        return set()

    setting = session.get(ShowtimeVisibilitySetting, (owner_id, showtime_id))
    mode = (
        setting.mode
        if setting is not None
        else get_owner_default_mode_for_showtime(
            session=session, owner_id=owner_id, showtime_id=showtime_id
        )
    )

    if mode == VisibilityMode.FRIENDS_OF_FRIENDS:
        base_visible_ids = (
            _status_sharing_friend_ids(session=session, owner_id=owner_id)
            & all_friend_ids
        ) | _friends_of_friends_ids_for_showtime(
            session=session, owner_id=owner_id, showtime_id=showtime_id
        )
    elif mode == VisibilityMode.ALL_FRIENDS:
        base_visible_ids = (
            _status_sharing_friend_ids(session=session, owner_id=owner_id)
            & all_friend_ids
        )
    else:  # INVITED_ONLY
        base_visible_ids = set()

    # Always-visible regardless of mode or opt-out:
    #  - friends you invited, and friends who invited you (direct), and
    #  - friends co-invited to this showtime by someone who invited you, and
    #  - friends one hop further along an accepted chain (see
    #    get_chain_invited_user_ids).
    direct_invited_ids = showtime_ping_crud.get_ping_counterpart_ids_for_showtime(
        session=session,
        owner_id=owner_id,
        showtime_id=showtime_id,
        eligible_only=True,
    )
    co_invited_ids = showtime_ping_crud.get_co_invited_user_ids(
        session=session,
        viewer_id=owner_id,
        showtime_id=showtime_id,
        eligible_only=True,
    )
    chain_invited_ids = showtime_ping_crud.get_chain_invited_user_ids(
        session=session,
        viewer_id=owner_id,
        showtime_id=showtime_id,
        eligible_only=True,
    )
    # Not intersected with `all_friend_ids` — FRIENDS_OF_FRIENDS deliberately
    # reaches non-friends via `base_visible_ids`, and the other three sources
    # are already friend-scoped on their own, so this is a no-op for them.
    return base_visible_ids | direct_invited_ids | co_invited_ids | chain_invited_ids


def rebuild_effective_visibility_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
    cascade_to_bridged_friends: bool = True,
) -> None:
    """Re-materialize who can see `owner_id`'s status for one showtime.

    `cascade_to_bridged_friends` also rebuilds the owner's attending friends,
    whose own FRIENDS_OF_FRIENDS grants read the rows written here: they may
    bridge *through* this owner, and only to people who can see this owner
    (see `_friends_of_friends_ids_for_showtime`). Without it, hiding your
    status would leave the friends you were bridging for still handing your
    other friends out. Pass False from a loop that is already rebuilding
    everyone involved — it is also what stops the cascade recursing.

    One level is enough: what a bridge's grant reads back is whether a
    *friend* of that bridge can see it, and a friend's visibility is never
    itself granted by the friends-of-friends path (an opted-out friend is
    subtracted from it), so the answer can't shift again further out.
    """
    visible_friend_ids = _compute_effective_visible_friend_ids_for_showtime(
        session=session,
        owner_id=owner_id,
        showtime_id=showtime_id,
    )

    session.execute(
        delete(ShowtimeVisibilityEffective).where(
            col(ShowtimeVisibilityEffective.owner_id) == owner_id,
            col(ShowtimeVisibilityEffective.showtime_id) == showtime_id,
        )
    )

    for viewer_id in sorted(visible_friend_ids, key=str):
        session.add(
            ShowtimeVisibilityEffective(
                owner_id=owner_id,
                showtime_id=showtime_id,
                viewer_id=viewer_id,
            )
        )
    session.flush()

    if not cascade_to_bridged_friends:
        return
    for friend_id in sorted(
        _attending_friend_ids(
            session=session, owner_id=owner_id, showtime_id=showtime_id
        ),
        key=str,
    ):
        rebuild_effective_visibility_for_showtime(
            session=session,
            owner_id=friend_id,
            showtime_id=showtime_id,
            cascade_to_bridged_friends=False,
        )


def clear_effective_visibility_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
    cascade_to_bridged_friends: bool = True,
) -> None:
    """Drop the materialized viewer rows for a showtime.

    The owner's chosen visibility *setting* is intentionally left in place so it
    persists across status changes — you can configure who can see your status
    before (and after) you mark going/interested.

    `cascade_to_bridged_friends` rebuilds the friends who were bridging
    *through* this owner, for the same reason
    `rebuild_effective_visibility_for_showtime` cascades: an owner who drops
    their selection stops being a friends-of-friends bridge, and without the
    rebuild their friends keep handing out visibility through a bridge that
    is no longer there. Note the friends are read *after* the delete, so the
    owner (no longer attending) can no longer bridge for them.
    """
    session.execute(
        delete(ShowtimeVisibilityEffective).where(
            col(ShowtimeVisibilityEffective.owner_id) == owner_id,
            col(ShowtimeVisibilityEffective.showtime_id) == showtime_id,
        )
    )
    session.flush()

    if not cascade_to_bridged_friends:
        return
    for friend_id in sorted(
        _attending_friend_ids(
            session=session, owner_id=owner_id, showtime_id=showtime_id
        ),
        key=str,
    ):
        rebuild_effective_visibility_for_showtime(
            session=session,
            owner_id=friend_id,
            showtime_id=showtime_id,
            cascade_to_bridged_friends=False,
        )


def rebuild_effective_visibility_for_owner(
    *,
    session: Session,
    owner_id: UUID,
) -> None:
    selected_showtime_ids = set(
        session.exec(
            select(ShowtimeSelection.showtime_id).where(
                col(ShowtimeSelection.user_id) == owner_id
            )
        ).all()
    )

    # Drop materialized rows for showtimes the owner no longer attends (their
    # visibility settings stay, so a pre-set mode survives a status change).
    existing_effective_showtime_ids = set(
        session.exec(
            select(ShowtimeVisibilityEffective.showtime_id).where(
                col(ShowtimeVisibilityEffective.owner_id) == owner_id
            )
        ).all()
    )
    stale_effective_showtime_ids = sorted(
        existing_effective_showtime_ids - selected_showtime_ids
    )
    for showtime_id in stale_effective_showtime_ids:
        clear_effective_visibility_for_showtime(
            session=session,
            owner_id=owner_id,
            showtime_id=showtime_id,
        )

    for showtime_id in sorted(selected_showtime_ids):
        rebuild_effective_visibility_for_showtime(
            session=session,
            owner_id=owner_id,
            showtime_id=showtime_id,
        )


def rebuild_effective_visibility_for_showtime_participants(
    *,
    session: Session,
    showtime_id: int,
) -> None:
    """Rebuild the cache for everyone bound to a showtime by a ping.

    A ping (or a participant's mode change) can shift the whole invite group's
    visibility — co-invitees gain/lose each other and invitees inherit the
    inviter's privacy — so the rebuild must cover every participant, not just
    the two ping endpoints.

    Each participant's attending friends come too, for the same reason
    `rebuild_effective_visibility_for_showtime` cascades to them: they bridge
    through the participant, so a participant's change moves their grants.
    Collected into one set first, and rebuilt with the per-owner cascade off,
    so overlapping friend circles don't rebuild the same people repeatedly.
    Sorted, like every other rebuild loop here, to keep concurrent writers in
    a consistent lock order.
    """
    participant_ids = showtime_ping_crud.get_showtime_participant_ids(
        session=session,
        showtime_id=showtime_id,
    )
    owner_ids = set(participant_ids)
    for participant_id in participant_ids:
        owner_ids |= _attending_friend_ids(
            session=session, owner_id=participant_id, showtime_id=showtime_id
        )
    for owner_id in sorted(owner_ids, key=str):
        rebuild_effective_visibility_for_showtime(
            session=session,
            owner_id=owner_id,
            showtime_id=showtime_id,
            cascade_to_bridged_friends=False,
        )


def set_visibility_mode_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
    mode: VisibilityMode,
    now: datetime,
) -> None:
    """Set the per-showtime visibility mode and re-materialize the cache.

    No row is stored when the mode matches the owner's computed default — the
    showtime then tracks that default going forward. The owner's privacy choice
    also affects the people they invited, so the whole participant group is
    rebuilt.

    The owner can always change their own mode either way — the "tightening
    only" rule lives in `get_owner_default_mode_for_showtime` instead: it only
    ever inherits a *stricter* default from a private inviter, never a looser
    one, but an explicit choice here always wins.
    """
    default_mode = get_owner_default_mode_for_showtime(
        session=session, owner_id=owner_id, showtime_id=showtime_id
    )
    setting = session.get(ShowtimeVisibilitySetting, (owner_id, showtime_id))

    if mode == default_mode:
        if setting is not None:
            session.delete(setting)
    elif setting is None:
        session.add(
            ShowtimeVisibilitySetting(
                owner_id=owner_id,
                showtime_id=showtime_id,
                mode=mode,
                updated_at=now,
            )
        )
    else:
        setting.mode = mode
        setting.updated_at = now
        session.add(setting)

    session.flush()
    rebuild_effective_visibility_for_showtime(
        session=session,
        owner_id=owner_id,
        showtime_id=showtime_id,
    )
    rebuild_effective_visibility_for_showtime_participants(
        session=session,
        showtime_id=showtime_id,
    )


def is_showtime_visible_to_viewer_for_ids(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
    viewer_id: UUID,
) -> bool:
    if owner_id == viewer_id:
        return True

    stmt = select(ShowtimeVisibilityEffective.owner_id).where(
        col(ShowtimeVisibilityEffective.owner_id) == owner_id,
        col(ShowtimeVisibilityEffective.showtime_id) == showtime_id,
        col(ShowtimeVisibilityEffective.viewer_id) == viewer_id,
    )
    return session.exec(stmt).one_or_none() is not None


def _selected_showtime_ids_stmt(*, owner_id: UUID) -> SelectOfScalar[int]:
    """The showtimes an owner is GOING/INTERESTED on — the ones whose
    visibility a change to the account default would move."""
    return select(ShowtimeSelection.showtime_id).where(
        col(ShowtimeSelection.user_id) == owner_id,
        col(ShowtimeSelection.going_status).in_(
            [GoingStatus.GOING, GoingStatus.INTERESTED]
        ),
    )


def has_selected_showtimes(*, session: Session, owner_id: UUID) -> bool:
    """Whether changing the account default would move anything at all.

    Surfaced on `UserMe` so the settings screen can skip the "…and your
    existing showtimes?" prompt for an account that has picked nothing yet:
    the question has no answer worth asking for.
    """
    stmt = _selected_showtime_ids_stmt(owner_id=owner_id).limit(1)
    return session.exec(stmt).first() is not None


def pin_current_modes_for_selected_showtimes(
    *,
    session: Session,
    owner_id: UUID,
    now: datetime,
) -> None:
    """Freeze the mode currently in force on every showtime the owner is
    GOING/INTERESTED on, by writing it out as an explicit per-showtime setting.

    Called just *before* `default_visibility_mode` changes, when the owner has
    said the new default should apply to new showtimes only: a showtime with no
    setting of its own tracks the default live, so without this the change would
    silently re-open (or close off) everything they already picked.

    Only showtimes that actually follow the owner's own default are pinned —
    ones already carrying an explicit setting are left alone (nothing about
    them is about to change), and so are ones defaulted to INVITED_ONLY by a
    private inviter, which the default change doesn't move either and which
    must keep tracking that inviter rather than being frozen here.
    """
    selected_showtime_ids = sorted(
        set(session.exec(_selected_showtime_ids_stmt(owner_id=owner_id)).all())
    )
    if len(selected_showtime_ids) == 0:
        return

    owner = session.get(User, owner_id)
    if owner is None:
        return
    owner_default_mode = owner.default_visibility_mode

    existing_settings = get_showtime_visibility_settings_for_showtimes(
        session=session, owner_id=owner_id, showtime_ids=selected_showtime_ids
    )
    defaults = get_owner_default_modes_for_showtimes(
        session=session, owner_id=owner_id, showtime_ids=selected_showtime_ids
    )
    for showtime_id in selected_showtime_ids:
        if showtime_id in existing_settings:
            continue
        if defaults[showtime_id] != owner_default_mode:
            continue
        session.add(
            ShowtimeVisibilitySetting(
                owner_id=owner_id,
                showtime_id=showtime_id,
                mode=owner_default_mode,
                updated_at=now,
            )
        )
    session.flush()
