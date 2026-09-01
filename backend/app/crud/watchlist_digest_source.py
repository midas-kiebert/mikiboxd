from datetime import datetime
from uuid import UUID

from sqlmodel import Session, col, select

from app.core.enums import DigestFrequency
from app.models.watchlist_digest_source import WatchlistDigestSource


def list_user_sources(
    *, session: Session, user_id: UUID
) -> list[WatchlistDigestSource]:
    stmt = (
        select(WatchlistDigestSource)
        .where(col(WatchlistDigestSource.owner_user_id) == user_id)
        .order_by(col(WatchlistDigestSource.created_at))
    )
    return list(session.exec(stmt).all())


def count_user_sources(*, session: Session, user_id: UUID) -> int:
    return len(list_user_sources(session=session, user_id=user_id))


def get_user_source_by_id(
    *, session: Session, user_id: UUID, source_id: UUID
) -> WatchlistDigestSource | None:
    stmt = select(WatchlistDigestSource).where(
        col(WatchlistDigestSource.owner_user_id) == user_id,
        col(WatchlistDigestSource.id) == source_id,
    )
    return session.exec(stmt).one_or_none()


def create_source(
    *,
    session: Session,
    user_id: UUID,
    frequency: DigestFrequency,
    list_id: UUID | None,
    cinema_preset_id: UUID | None,
    custom_cinema_ids: list[int] | None,
    now: datetime,
) -> WatchlistDigestSource:
    source = WatchlistDigestSource(
        owner_user_id=user_id,
        frequency=frequency,
        list_id=list_id,
        cinema_preset_id=cinema_preset_id,
        custom_cinema_ids=custom_cinema_ids,
        created_at=now,
    )
    session.add(source)
    session.flush()
    return source


def delete_source(
    *, session: Session, user_id: UUID, source_id: UUID
) -> bool:
    source = get_user_source_by_id(
        session=session, user_id=user_id, source_id=source_id
    )
    if source is None:
        return False
    session.delete(source)
    session.flush()
    return True
