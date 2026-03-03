from collections import defaultdict
from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import and_, exists, or_
from sqlalchemy.orm import aliased
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, col, select

from app.models.friend_group import FriendGroup, FriendGroupMember
from app.models.friendship import Friendship
from app.models.showtime_visibility import (
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
    setting_row = aliased(ShowtimeVisibilitySetting)
    all_friends_setting_row = aliased(ShowtimeVisibilitySetting)
    visible_friend_row = aliased(ShowtimeVisibilityFriend)
    visible_group_row = aliased(ShowtimeVisibilityGroup)
    visible_group_member_row = aliased(FriendGroupMember)
    favorite_group_row = aliased(FriendGroup)
    favorite_group_for_viewer_row = aliased(FriendGroup)
    favorite_group_member_row = aliased(FriendGroupMember)
    friendship_row = aliased(Friendship)

    setting_exists = exists(
        select(setting_row.owner_id).where(
            col(setting_row.owner_id) == owner_id_value,
            col(setting_row.showtime_id) == showtime_id_value,
        )
    )
    all_friends_setting_exists = exists(
        select(all_friends_setting_row.owner_id).where(
            col(all_friends_setting_row.owner_id) == owner_id_value,
            col(all_friends_setting_row.showtime_id) == showtime_id_value,
            col(all_friends_setting_row.is_all_friends).is_(True),
        )
    )
    explicit_viewer_visibility_exists = exists(
        select(visible_friend_row.owner_id).where(
            col(visible_friend_row.owner_id) == owner_id_value,
            col(visible_friend_row.showtime_id) == showtime_id_value,
            col(visible_friend_row.viewer_id) == viewer_id_value,
        )
    )
    explicit_group_visibility_exists = exists(
        select(visible_group_row.owner_id)
        .join(
            visible_group_member_row,
            col(visible_group_member_row.group_id) == col(visible_group_row.group_id),
        )
        .where(
            col(visible_group_row.owner_id) == owner_id_value,
            col(visible_group_row.showtime_id) == showtime_id_value,
            col(visible_group_member_row.friend_id) == viewer_id_value,
        )
    )
    favorite_group_exists = exists(
        select(favorite_group_row.id).where(
            col(favorite_group_row.owner_user_id) == owner_id_value,
            col(favorite_group_row.is_favorite).is_(True),
        )
    )
    favorite_group_viewer_visibility_exists = exists(
        select(favorite_group_for_viewer_row.id)
        .join(
            favorite_group_member_row,
            col(favorite_group_member_row.group_id)
            == col(favorite_group_for_viewer_row.id),
        )
        .where(
            col(favorite_group_for_viewer_row.owner_user_id) == owner_id_value,
            col(favorite_group_for_viewer_row.is_favorite).is_(True),
            col(favorite_group_member_row.friend_id) == viewer_id_value,
        )
    )
    viewer_is_owner_or_friend = or_(
        owner_id_value == viewer_id_value,
        exists(
            select(friendship_row.user_id).where(
                col(friendship_row.user_id) == owner_id_value,
                col(friendship_row.friend_id) == viewer_id_value,
            )
        ),
    )

    return and_(
        viewer_is_owner_or_friend,
        or_(
            all_friends_setting_exists,
            explicit_viewer_visibility_exists,
            explicit_group_visibility_exists,
            and_(
                ~setting_exists,
                or_(
                    ~favorite_group_exists,
                    favorite_group_viewer_visibility_exists,
                ),
            ),
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
    stmt = select(
        is_showtime_visible_to_viewer(
            owner_id_value=owner_id,
            showtime_id_value=showtime_id,
            viewer_id_value=viewer_id,
        )
    )
    return bool(session.exec(stmt).one())
