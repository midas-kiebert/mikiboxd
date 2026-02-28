from datetime import datetime
from typing import Any
from uuid import UUID

from sqlalchemy import exists, or_
from sqlalchemy.sql.elements import ColumnElement
from sqlmodel import Session, col, select

from app.models.showtime_visibility import (
    ShowtimeVisibilityFriend,
    ShowtimeVisibilitySetting,
)


def is_showtime_visible_to_viewer(
    *,
    owner_id_value: Any,
    showtime_id_value: Any,
    viewer_id_value: Any,
) -> ColumnElement[bool]:
    setting_exists = exists(
        select(ShowtimeVisibilitySetting.owner_id).where(
            col(ShowtimeVisibilitySetting.owner_id) == owner_id_value,
            col(ShowtimeVisibilitySetting.showtime_id) == showtime_id_value,
        )
    )
    all_friends_setting_exists = exists(
        select(ShowtimeVisibilitySetting.owner_id).where(
            col(ShowtimeVisibilitySetting.owner_id) == owner_id_value,
            col(ShowtimeVisibilitySetting.showtime_id) == showtime_id_value,
            col(ShowtimeVisibilitySetting.is_all_friends).is_(True),
        )
    )
    explicit_viewer_visibility_exists = exists(
        select(ShowtimeVisibilityFriend.owner_id).where(
            col(ShowtimeVisibilityFriend.owner_id) == owner_id_value,
            col(ShowtimeVisibilityFriend.showtime_id) == showtime_id_value,
            col(ShowtimeVisibilityFriend.viewer_id) == viewer_id_value,
        )
    )
    return or_(
        ~setting_exists,
        all_friends_setting_exists,
        explicit_viewer_visibility_exists,
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


def set_visible_friend_ids_for_showtime(
    *,
    session: Session,
    owner_id: UUID,
    showtime_id: int,
    visible_friend_ids: list[UUID],
    all_friend_ids: set[UUID],
    now: datetime,
) -> None:
    deduped_visible_friend_ids = sorted(set(visible_friend_ids), key=str)
    all_friends_selected = set(deduped_visible_friend_ids) == all_friend_ids
    setting = session.get(ShowtimeVisibilitySetting, (owner_id, showtime_id))

    existing_visibility_rows = list(
        session.exec(
            select(ShowtimeVisibilityFriend).where(
                ShowtimeVisibilityFriend.owner_id == owner_id,
                ShowtimeVisibilityFriend.showtime_id == showtime_id,
            )
        ).all()
    )
    for row in existing_visibility_rows:
        session.delete(row)

    if all_friends_selected:
        if setting is not None:
            session.delete(setting)
        session.flush()
        return

    if setting is None:
        setting = ShowtimeVisibilitySetting(
            owner_id=owner_id,
            showtime_id=showtime_id,
            is_all_friends=False,
            updated_at=now,
        )
    else:
        setting.is_all_friends = False
        setting.updated_at = now
    session.add(setting)

    for viewer_id in deduped_visible_friend_ids:
        session.add(
            ShowtimeVisibilityFriend(
                owner_id=owner_id,
                showtime_id=showtime_id,
                viewer_id=viewer_id,
                created_at=now,
            )
        )
    session.flush()
