from collections import defaultdict
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import exists, or_
from sqlalchemy.orm import aliased
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, col, delete, select

from app.models.friend_group import FriendGroup, FriendGroupMember
from app.models.friendship import Friendship
from app.models.showtime_selection import ShowtimeSelection
from app.models.showtime_visibility import (
    ShowtimeVisibilityEffective,
    ShowtimeVisibilityFriend,
    ShowtimeVisibilityGroup,
    ShowtimeVisibilitySetting,
)


def is_showtime_visible_to_viewer(
    *,
    owner_id_value: Any,
    showtime_id_value: Any,
    viewer_id_value: Any,
) -> ColumnElement[bool]:
    effective_row = aliased(ShowtimeVisibilityEffective)
    return or_(
        owner_id_value == viewer_id_value,
        exists(
            select(effective_row.owner_id).where(
                col(effective_row.owner_id) == owner_id_value,
                col(effective_row.showtime_id) == showtime_id_value,
                col(effective_row.viewer_id) == viewer_id_value,
            )
        ),
    )


def get_visible_friend_ids_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
) -> set[UUID] | None:
    setting = session.get(ShowtimeVisibilitySetting, (owner_id, showtime_id))
    if setting is None or setting.is_all_friends:
        return None

    stmt = select(ShowtimeVisibilityFriend.viewer_id).where(
        ShowtimeVisibilityFriend.owner_id == owner_id,
        ShowtimeVisibilityFriend.showtime_id == showtime_id,
    )
    return set(session.exec(stmt).all())


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


def get_visible_group_ids_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
) -> set[UUID]:
    setting = session.get(ShowtimeVisibilitySetting, (owner_id, showtime_id))
    if setting is None or setting.is_all_friends:
        return set()

    stmt = select(ShowtimeVisibilityGroup.group_id).where(
        ShowtimeVisibilityGroup.owner_id == owner_id,
        ShowtimeVisibilityGroup.showtime_id == showtime_id,
    )
    return set(session.exec(stmt).all())


def get_visible_friend_ids_for_showtimes(
    *,
    session: Session,
    owner_id: UUID,
    showtime_ids: list[int],
) -> dict[int, set[UUID]]:
    if len(showtime_ids) == 0:
        return {}

    stmt = select(
        ShowtimeVisibilityFriend.showtime_id,
        ShowtimeVisibilityFriend.viewer_id,
    ).where(
        ShowtimeVisibilityFriend.owner_id == owner_id,
        col(ShowtimeVisibilityFriend.showtime_id).in_(showtime_ids),
    )
    rows = list(session.exec(stmt).all())
    friend_ids_by_showtime: dict[int, set[UUID]] = defaultdict(set)
    for showtime_id, viewer_id in rows:
        friend_ids_by_showtime[showtime_id].add(viewer_id)
    return dict(friend_ids_by_showtime)


def get_visible_group_ids_for_showtimes(
    *,
    session: Session,
    owner_id: UUID,
    showtime_ids: list[int],
) -> dict[int, set[UUID]]:
    if len(showtime_ids) == 0:
        return {}

    stmt = select(
        ShowtimeVisibilityGroup.showtime_id,
        ShowtimeVisibilityGroup.group_id,
    ).where(
        ShowtimeVisibilityGroup.owner_id == owner_id,
        col(ShowtimeVisibilityGroup.showtime_id).in_(showtime_ids),
    )
    rows = list(session.exec(stmt).all())
    group_ids_by_showtime: dict[int, set[UUID]] = defaultdict(set)
    for showtime_id, group_id in rows:
        group_ids_by_showtime[showtime_id].add(group_id)
    return dict(group_ids_by_showtime)


def get_favorite_group_ids_for_owner(
    *,
    session: Session,
    owner_id: UUID,
) -> list[UUID]:
    stmt = select(FriendGroup.id).where(
        col(FriendGroup.owner_user_id) == owner_id,
        col(FriendGroup.is_favorite).is_(True),
    )
    return list(session.exec(stmt).all())


def get_friend_ids_for_owner_groups(
    *,
    session: Session,
    owner_id: UUID,
    group_ids: list[UUID],
) -> set[UUID]:
    if len(group_ids) == 0:
        return set()
    stmt = (
        select(FriendGroupMember.friend_id)
        .join(FriendGroup, col(FriendGroup.id) == col(FriendGroupMember.group_id))
        .where(
            col(FriendGroup.owner_user_id) == owner_id,
            col(FriendGroup.id).in_(group_ids),
        )
    )
    return set(session.exec(stmt).all())


def get_friend_ids_for_owner_groups_map(
    *,
    session: Session,
    owner_id: UUID,
    group_ids: list[UUID],
) -> dict[UUID, set[UUID]]:
    if len(group_ids) == 0:
        return {}

    stmt = (
        select(FriendGroupMember.group_id, FriendGroupMember.friend_id)
        .join(FriendGroup, col(FriendGroup.id) == col(FriendGroupMember.group_id))
        .where(
            col(FriendGroup.owner_user_id) == owner_id,
            col(FriendGroup.id).in_(group_ids),
        )
    )
    rows = list(session.exec(stmt).all())
    friend_ids_by_group: dict[UUID, set[UUID]] = defaultdict(set)
    for group_id, friend_id in rows:
        friend_ids_by_group[group_id].add(friend_id)
    return dict(friend_ids_by_group)


def _compute_effective_visible_friend_ids_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
) -> set[UUID]:
    all_friend_ids = set(
        session.exec(
            select(Friendship.friend_id).where(col(Friendship.user_id) == owner_id)
        ).all()
    )
    if len(all_friend_ids) == 0:
        return set()

    setting = session.get(ShowtimeVisibilitySetting, (owner_id, showtime_id))
    if setting is None:
        favorite_group_ids = get_favorite_group_ids_for_owner(
            session=session,
            owner_id=owner_id,
        )
        if len(favorite_group_ids) == 0:
            return all_friend_ids
        return (
            get_friend_ids_for_owner_groups(
                session=session,
                owner_id=owner_id,
                group_ids=favorite_group_ids,
            )
            & all_friend_ids
        )

    if setting.is_all_friends:
        return all_friend_ids

    explicit_visible_friend_ids = set(
        session.exec(
            select(ShowtimeVisibilityFriend.viewer_id).where(
                col(ShowtimeVisibilityFriend.owner_id) == owner_id,
                col(ShowtimeVisibilityFriend.showtime_id) == showtime_id,
            )
        ).all()
    )
    visible_group_ids = list(
        session.exec(
            select(ShowtimeVisibilityGroup.group_id).where(
                col(ShowtimeVisibilityGroup.owner_id) == owner_id,
                col(ShowtimeVisibilityGroup.showtime_id) == showtime_id,
            )
        ).all()
    )
    visible_from_groups = get_friend_ids_for_owner_groups(
        session=session,
        owner_id=owner_id,
        group_ids=visible_group_ids,
    )
    return (explicit_visible_friend_ids | visible_from_groups) & all_friend_ids


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


def rebuild_effective_visibility_for_owner(
    *,
    session: Session,
    owner_id: UUID,
) -> None:
    selected_showtime_ids = list(
        session.exec(
            select(ShowtimeSelection.showtime_id).where(
                col(ShowtimeSelection.user_id) == owner_id
            )
        ).all()
    )
    settings_showtime_ids = list(
        session.exec(
            select(ShowtimeVisibilitySetting.showtime_id).where(
                col(ShowtimeVisibilitySetting.owner_id) == owner_id
            )
        ).all()
    )
    existing_effective_showtime_ids = list(
        session.exec(
            select(ShowtimeVisibilityEffective.showtime_id).where(
                col(ShowtimeVisibilityEffective.owner_id) == owner_id
            )
        ).all()
    )
    all_showtime_ids = sorted(
        {
            *selected_showtime_ids,
            *settings_showtime_ids,
            *existing_effective_showtime_ids,
        }
    )
    for showtime_id in all_showtime_ids:
        rebuild_effective_visibility_for_showtime(
            session=session,
            owner_id=owner_id,
            showtime_id=showtime_id,
        )


def get_effective_visible_friend_ids_for_showtimes(
    *,
    session: Session,
    owner_id: UUID,
    showtime_ids: list[int],
) -> dict[int, set[UUID]]:
    if len(showtime_ids) == 0:
        return {}

    stmt = select(
        ShowtimeVisibilityEffective.showtime_id,
        ShowtimeVisibilityEffective.viewer_id,
    ).where(
        col(ShowtimeVisibilityEffective.owner_id) == owner_id,
        col(ShowtimeVisibilityEffective.showtime_id).in_(showtime_ids),
    )
    rows = list(session.exec(stmt).all())
    viewer_ids_by_showtime: dict[int, set[UUID]] = defaultdict(set)
    for showtime_id, viewer_id in rows:
        viewer_ids_by_showtime[showtime_id].add(viewer_id)
    return dict(viewer_ids_by_showtime)


def set_visibility_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
    visible_friend_ids: list[UUID],
    visible_group_ids: list[UUID],
    all_friend_ids: set[UUID],
    default_visible_friend_ids: set[UUID],
    now: datetime,
) -> None:
    deduped_visible_friend_ids = sorted(set(visible_friend_ids), key=str)
    deduped_visible_group_ids = sorted(set(visible_group_ids), key=str)
    visible_group_member_ids = get_friend_ids_for_owner_groups(
        session=session,
        owner_id=owner_id,
        group_ids=deduped_visible_group_ids,
    )
    effective_visible_friend_ids = (
        set(deduped_visible_friend_ids) | visible_group_member_ids
    )
    all_friends_selected = effective_visible_friend_ids == all_friend_ids
    setting = session.get(ShowtimeVisibilitySetting, (owner_id, showtime_id))

    existing_visibility_rows = list(
        session.exec(
            select(ShowtimeVisibilityFriend).where(
                ShowtimeVisibilityFriend.owner_id == owner_id,
                ShowtimeVisibilityFriend.showtime_id == showtime_id,
            )
        ).all()
    )
    for visibility_row in existing_visibility_rows:
        session.delete(visibility_row)

    existing_group_visibility_rows = list(
        session.exec(
            select(ShowtimeVisibilityGroup).where(
                ShowtimeVisibilityGroup.owner_id == owner_id,
                ShowtimeVisibilityGroup.showtime_id == showtime_id,
            )
        ).all()
    )
    for group_visibility_row in existing_group_visibility_rows:
        session.delete(group_visibility_row)

    if effective_visible_friend_ids == default_visible_friend_ids:
        if setting is not None:
            session.delete(setting)
        session.flush()
        rebuild_effective_visibility_for_showtime(
            session=session,
            owner_id=owner_id,
            showtime_id=showtime_id,
        )
        return

    if setting is None:
        setting = ShowtimeVisibilitySetting(
            owner_id=owner_id,
            showtime_id=showtime_id,
            is_all_friends=all_friends_selected,
            updated_at=now,
        )
    else:
        setting.is_all_friends = all_friends_selected
        setting.updated_at = now
    session.add(setting)

    if all_friends_selected:
        session.flush()
        rebuild_effective_visibility_for_showtime(
            session=session,
            owner_id=owner_id,
            showtime_id=showtime_id,
        )
        return

    for viewer_id in deduped_visible_friend_ids:
        session.add(
            ShowtimeVisibilityFriend(
                owner_id=owner_id,
                showtime_id=showtime_id,
                viewer_id=viewer_id,
                created_at=now,
            )
        )

    for group_id in deduped_visible_group_ids:
        session.add(
            ShowtimeVisibilityGroup(
                owner_id=owner_id,
                showtime_id=showtime_id,
                group_id=group_id,
                created_at=now,
            )
        )

    session.flush()
    rebuild_effective_visibility_for_showtime(
        session=session,
        owner_id=owner_id,
        showtime_id=showtime_id,
    )


def set_visible_friend_ids_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
    visible_friend_ids: list[UUID],
    all_friend_ids: set[UUID],
    now: datetime,
) -> None:
    set_visibility_for_showtime(
        session=session,
        owner_id=owner_id,
        showtime_id=showtime_id,
        visible_friend_ids=visible_friend_ids,
        visible_group_ids=[],
        all_friend_ids=all_friend_ids,
        default_visible_friend_ids=all_friend_ids,
        now=now,
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
