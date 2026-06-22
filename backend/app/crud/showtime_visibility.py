from datetime import datetime
from uuid import UUID

from sqlmodel import Session, col, delete, select

from app.core.enums import VisibilityMode
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


def _is_user_private_for_showtime(
    *,
    session: Session,
    user_id: UUID,
    showtime_id: int,
) -> bool:
    """Whether a user is keeping their own status private for a showtime.

    Private means incognito, or an explicit INVITED_ONLY setting on the
    showtime. Resolved one level only (does not recurse into that user's own
    inviters) to avoid cycles.
    """
    user = session.get(User, user_id)
    if user is not None and user.incognito_mode:
        return True
    setting = session.get(ShowtimeVisibilitySetting, (user_id, showtime_id))
    return setting is not None and setting.mode == VisibilityMode.INVITED_ONLY


def get_owner_default_mode_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
) -> VisibilityMode:
    """The mode applied to a showtime the owner hasn't explicitly configured.

    Defaults to ALL_FRIENDS, but mirrors a private inviter: if anyone with an
    active invite out to the owner is keeping this showtime invite-only (or is
    incognito), the owner defaults to INVITED_ONLY too. Incognito owners are
    always INVITED_ONLY.
    """
    owner = session.get(User, owner_id)
    if owner is not None and owner.incognito_mode:
        return VisibilityMode.INVITED_ONLY

    inviter_ids = showtime_ping_crud.get_active_received_inviter_ids(
        session=session,
        receiver_id=owner_id,
        showtime_id=showtime_id,
    )
    for inviter_id in inviter_ids:
        if _is_user_private_for_showtime(
            session=session,
            user_id=inviter_id,
            showtime_id=showtime_id,
        ):
            return VisibilityMode.INVITED_ONLY
    return VisibilityMode.ALL_FRIENDS


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
        base_visible_ids = _status_sharing_friend_ids(
            session=session, owner_id=owner_id
        ) & all_friend_ids
    else:  # INVITED_ONLY
        base_visible_ids = set()

    # Always-visible regardless of mode or opt-out:
    #  - friends you invited, and friends who invited you (direct), and
    #  - friends co-invited to this showtime by someone who invited you.
    direct_invited_ids = showtime_ping_crud.get_ping_counterpart_ids_for_showtime(
        session=session,
        owner_id=owner_id,
        showtime_id=showtime_id,
    )
    co_invited_ids = showtime_ping_crud.get_co_invited_user_ids(
        session=session,
        viewer_id=owner_id,
        showtime_id=showtime_id,
    )
    return (base_visible_ids | direct_invited_ids | co_invited_ids) & all_friend_ids


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


def clear_visibility_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
) -> None:
    setting = session.get(ShowtimeVisibilitySetting, (owner_id, showtime_id))
    if setting is not None:
        session.delete(setting)

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
    settings_showtime_ids = set(
        session.exec(
            select(ShowtimeVisibilitySetting.showtime_id).where(
                col(ShowtimeVisibilitySetting.owner_id) == owner_id
            )
        ).all()
    )

    stale_settings_showtime_ids = sorted(settings_showtime_ids - selected_showtime_ids)
    for showtime_id in stale_settings_showtime_ids:
        clear_visibility_for_showtime(
            session=session,
            owner_id=owner_id,
            showtime_id=showtime_id,
        )

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
        clear_visibility_for_showtime(
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
