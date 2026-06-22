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


def get_favorite_friend_ids_for_owner(
    *,
    session: Session,
    owner_id: UUID,
) -> set[UUID]:
    """Friends the owner has flagged as favorites (always-visible)."""
    stmt = select(Friendship.friend_id).where(
        col(Friendship.user_id) == owner_id,
        col(Friendship.is_favorite).is_(True),
    )
    return set(session.exec(stmt).all())


def get_owner_default_visibility_mode(
    *,
    session: Session,
    owner_id: UUID,
) -> VisibilityMode:
    """The mode applied to showtimes without an explicit setting.

    Incognito mode forces INVITED_ONLY (status hidden from everyone but the
    people you've exchanged invites with). Otherwise the user's chosen default,
    falling back to FAVORITE_FRIENDS until they pick one.
    """
    owner = session.get(User, owner_id)
    if owner is None:
        return VisibilityMode.FAVORITE_FRIENDS
    if owner.incognito_mode:
        return VisibilityMode.INVITED_ONLY
    return owner.default_visibility_mode or VisibilityMode.FAVORITE_FRIENDS


def _all_friend_ids(*, session: Session, owner_id: UUID) -> set[UUID]:
    return set(
        session.exec(
            select(Friendship.friend_id).where(col(Friendship.user_id) == owner_id)
        ).all()
    )


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
        else get_owner_default_visibility_mode(session=session, owner_id=owner_id)
    )

    if mode == VisibilityMode.ALL_FRIENDS:
        base_visible_ids = set(all_friend_ids)
    elif mode == VisibilityMode.FAVORITE_FRIENDS:
        base_visible_ids = (
            get_favorite_friend_ids_for_owner(session=session, owner_id=owner_id)
            & all_friend_ids
        )
    else:  # INVITED_ONLY
        base_visible_ids = set()

    # Invariant: friends you invited — and friends who invited you — always see
    # your status, regardless of the mode.
    invited_ids = showtime_ping_crud.get_ping_counterpart_ids_for_showtime(
        session=session,
        owner_id=owner_id,
        showtime_id=showtime_id,
    )
    return (base_visible_ids | invited_ids) & all_friend_ids


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


def rebuild_effective_visibility_for_ping(
    *,
    session: Session,
    sender_id: UUID,
    receiver_id: UUID,
    showtime_id: int,
) -> None:
    """A ping makes sender and receiver mutually visible for the showtime."""
    rebuild_effective_visibility_for_showtime(
        session=session,
        owner_id=sender_id,
        showtime_id=showtime_id,
    )
    rebuild_effective_visibility_for_showtime(
        session=session,
        owner_id=receiver_id,
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

    No row is stored when the mode matches the owner's default — the showtime
    then tracks the default going forward.
    """
    default_mode = get_owner_default_visibility_mode(session=session, owner_id=owner_id)
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
