from uuid import UUID

from sqlmodel import Session, col, select

from app.models.push_token import PushToken


def upsert_push_token(
    *,
    session: Session,
    user_id: UUID,
    token: str,
    platform: str | None = None,
) -> PushToken:
    db_obj = session.get(PushToken, token)
    if db_obj is None:
        db_obj = PushToken(
            token=token,
            user_id=user_id,
            platform=platform,
        )
        session.add(db_obj)
        session.flush()
        return db_obj

    db_obj.user_id = user_id
    db_obj.platform = platform
    session.add(db_obj)
    session.flush()
    return db_obj


def get_push_tokens_for_users(
    *,
    session: Session,
    user_ids: list[UUID],
) -> list[PushToken]:
    if not user_ids:
        return []
    stmt = select(PushToken).where(col(PushToken.user_id).in_(user_ids))
    return list(session.exec(stmt).all())


def delete_push_token(
    *,
    session: Session,
    token: str,
) -> None:
    db_obj = session.get(PushToken, token)
    if db_obj is None:
        return
    session.delete(db_obj)
