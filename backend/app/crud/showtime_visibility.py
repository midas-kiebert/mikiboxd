from datetime import datetime
from uuid import UUID

from sqlmodel import Session, col, delete, select

from app.core.enums import GoingStatus, VisibilityMode
from app.crud import showtime_ping as showtime_ping_crud
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

    Defaults to ALL_FRIENDS, but mirrors a private inviter: if anyone with an
    active invite out to the owner is keeping a showtime invite-only (or is
    incognito), the owner defaults to INVITED_ONLY for it too. Incognito owners
    are always INVITED_ONLY. An inviter's privacy is resolved one level only
    (their own inviters are not followed) to avoid cycles.

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

    modes = {showtime_id: VisibilityMode.ALL_FRIENDS for showtime_id in showtime_ids}
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

    if mode == VisibilityMode.ALL_FRIENDS:
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
    return (
        base_visible_ids | direct_invited_ids | co_invited_ids | chain_invited_ids
    ) & all_friend_ids


def rebuild_effective_visibility_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
) -> None:
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


def clear_effective_visibility_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
) -> None:
    """Drop the materialized viewer rows for a showtime.

    The owner's chosen visibility *setting* is intentionally left in place so it
    persists across status changes — you can configure who can see your status
    before (and after) you mark going/interested.
    """
    session.execute(
        delete(ShowtimeVisibilityEffective).where(
            col(ShowtimeVisibilityEffective.owner_id) == owner_id,
            col(ShowtimeVisibilityEffective.showtime_id) == showtime_id,
        )
    )
    session.flush()


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
    """
    participant_ids = showtime_ping_crud.get_showtime_participant_ids(
        session=session,
        showtime_id=showtime_id,
    )
    for owner_id in sorted(participant_ids, key=str):
        rebuild_effective_visibility_for_showtime(
            session=session,
            owner_id=owner_id,
            showtime_id=showtime_id,
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
