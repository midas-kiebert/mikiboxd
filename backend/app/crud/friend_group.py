from datetime import datetime
from uuid import UUID

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.models.friend_group import FriendGroup, FriendGroupMember


def list_user_groups(
    *,
    session: Session,
    user_id: UUID,
) -> list[FriendGroup]:
    stmt = (
        select(FriendGroup)
        .where(col(FriendGroup.owner_user_id) == user_id)
        .order_by(
            col(FriendGroup.is_favorite).desc(),
            func.lower(col(FriendGroup.name)),
            col(FriendGroup.created_at),
        )
    )
    return list(session.exec(stmt).all())


def get_user_group_by_name(
    *,
    session: Session,
    user_id: UUID,
    name: str,
) -> FriendGroup | None:
    stmt = select(FriendGroup).where(
        col(FriendGroup.owner_user_id) == user_id,
        col(FriendGroup.name) == name,
    )
    return session.exec(stmt).one_or_none()


def get_user_group_by_id(
    *,
    session: Session,
    user_id: UUID,
    group_id: UUID,
) -> FriendGroup | None:
    stmt = select(FriendGroup).where(
        col(FriendGroup.owner_user_id) == user_id,
        col(FriendGroup.id) == group_id,
    )
    return session.exec(stmt).one_or_none()


def get_user_favorite_group(
    *,
    session: Session,
    user_id: UUID,
) -> FriendGroup | None:
    stmt = select(FriendGroup).where(
        col(FriendGroup.owner_user_id) == user_id,
        col(FriendGroup.is_favorite).is_(True),
    )
    return session.exec(stmt).one_or_none()


def get_existing_user_group_ids(
    *,
    session: Session,
    user_id: UUID,
    group_ids: list[UUID],
) -> set[UUID]:
    if len(group_ids) == 0:
        return set()
    stmt = select(FriendGroup.id).where(
        col(FriendGroup.owner_user_id) == user_id,
        col(FriendGroup.id).in_(group_ids),
    )
    return set(session.exec(stmt).all())


def get_group_member_ids(
    *,
    session: Session,
    group_id: UUID,
) -> list[UUID]:
    stmt = select(FriendGroupMember.friend_id).where(
        col(FriendGroupMember.group_id) == group_id
    )
    return list(session.exec(stmt).all())


def get_group_member_ids_for_user_group(
    *,
    session: Session,
    user_id: UUID,
    group_id: UUID,
) -> list[UUID]:
    stmt = (
        select(FriendGroupMember.friend_id)
        .join(FriendGroup, col(FriendGroup.id) == col(FriendGroupMember.group_id))
        .where(
            col(FriendGroup.owner_user_id) == user_id,
            col(FriendGroup.id) == group_id,
        )
    )
    return list(session.exec(stmt).all())


def get_member_ids_for_groups(
    *,
    session: Session,
    user_id: UUID,
    group_ids: list[UUID],
) -> set[UUID]:
    if len(group_ids) == 0:
        return set()
    stmt = (
        select(FriendGroupMember.friend_id)
        .join(FriendGroup, col(FriendGroup.id) == col(FriendGroupMember.group_id))
        .where(
            col(FriendGroup.owner_user_id) == user_id,
            col(FriendGroup.id).in_(group_ids),
        )
    )
    return set(session.exec(stmt).all())


def create_group(
    *,
    session: Session,
    user_id: UUID,
    name: str,
    is_favorite: bool,
    now: datetime,
) -> FriendGroup:
    group = FriendGroup(
        owner_user_id=user_id,
        name=name,
        is_favorite=is_favorite,
        created_at=now,
        updated_at=now,
    )
    session.add(group)
    session.flush()
    return group


def update_group(
    *,
    session: Session,
    group: FriendGroup,
    is_favorite: bool | None,
    now: datetime,
) -> FriendGroup:
    if is_favorite is not None:
        group.is_favorite = is_favorite
    group.updated_at = now
    session.add(group)
    session.flush()
    return group


def replace_group_members(
    *,
    session: Session,
    group: FriendGroup,
    friend_ids: list[UUID],
    now: datetime,
) -> None:
    existing_rows = list(
        session.exec(
            select(FriendGroupMember).where(
                col(FriendGroupMember.group_id) == group.id,
            )
        ).all()
    )
    for row in existing_rows:
        session.delete(row)

    for friend_id in friend_ids:
        session.add(
            FriendGroupMember(
                group_id=group.id,
                friend_id=friend_id,
                created_at=now,
            )
        )
    session.flush()


def remove_member_from_owner_groups(
    *,
    session: Session,
    owner_id: UUID,
    friend_id: UUID,
    now: datetime,
) -> int:
    membership_rows = list(
        session.exec(
            select(FriendGroupMember)
            .join(FriendGroup, col(FriendGroup.id) == col(FriendGroupMember.group_id))
            .where(
                col(FriendGroup.owner_user_id) == owner_id,
                col(FriendGroupMember.friend_id) == friend_id,
            )
        ).all()
    )
    if len(membership_rows) == 0:
        return 0

    affected_group_ids = {row.group_id for row in membership_rows}
    for row in membership_rows:
        session.delete(row)

    groups = list(
        session.exec(
            select(FriendGroup).where(col(FriendGroup.id).in_(affected_group_ids))
        ).all()
    )
    for group in groups:
        group.updated_at = now
        session.add(group)

    session.flush()
    return len(membership_rows)


def clear_user_favorite_group(
    *,
    session: Session,
    user_id: UUID,
) -> None:
    stmt = select(FriendGroup).where(
        col(FriendGroup.owner_user_id) == user_id,
        col(FriendGroup.is_favorite).is_(True),
    )
    favorites = list(session.exec(stmt).all())
    for favorite in favorites:
        favorite.is_favorite = False
        session.add(favorite)
    session.flush()


def set_group_favorite(
    *,
    session: Session,
    group: FriendGroup,
    is_favorite: bool,
    now: datetime,
) -> FriendGroup:
    group.is_favorite = is_favorite
    group.updated_at = now
    session.add(group)
    session.flush()
    return group


def delete_group(
    *,
    session: Session,
    user_id: UUID,
    group_id: UUID,
) -> bool:
    group = get_user_group_by_id(
        session=session,
        user_id=user_id,
        group_id=group_id,
    )
    if group is None:
        return False
    session.delete(group)
    session.flush()
    return True
