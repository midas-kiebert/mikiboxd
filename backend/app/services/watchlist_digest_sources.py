"""CRUD orchestration for watchlist digest sources (see `models/watchlist_digest_source.py`).

Sending is handled entirely by `services/watchlist_digest.py`; this module is
only the management surface behind `/me/watchlist-digest-sources`.
"""

from uuid import UUID

from sqlmodel import Session

from app.crud import watchlist_digest_source as sources_crud
from app.exceptions.watchlist_digest_source_exceptions import (
    WatchlistDigestSourceCinemaSelectionConflict,
    WatchlistDigestSourceLimitReached,
    WatchlistDigestSourceNotFound,
)
from app.models.watchlist_digest_source import WatchlistDigestSource
from app.schemas.watchlist_digest_source import (
    WatchlistDigestSourceCreate,
    WatchlistDigestSourcePublic,
    WatchlistDigestSourceUpdate,
)
from app.utils import now_amsterdam_naive

# A generous cap, mostly to stop the digest queue evaluation from growing
# unbounded per user rather than to constrain a genuine use case.
MAX_SOURCES_PER_USER = 5


def _to_public(source: WatchlistDigestSource) -> WatchlistDigestSourcePublic:
    return WatchlistDigestSourcePublic(
        id=source.id,
        frequency=source.frequency,
        list_id=source.list_id,
        cinema_preset_id=source.cinema_preset_id,
        custom_cinema_ids=source.custom_cinema_ids,
        created_at=source.created_at,
    )


def list_sources(
    *, session: Session, user_id: UUID
) -> list[WatchlistDigestSourcePublic]:
    sources = sources_crud.list_user_sources(session=session, user_id=user_id)
    return [_to_public(source) for source in sources]


def create_source(
    *, session: Session, user_id: UUID, payload: WatchlistDigestSourceCreate
) -> WatchlistDigestSourcePublic:
    if (
        sources_crud.count_user_sources(session=session, user_id=user_id)
        >= MAX_SOURCES_PER_USER
    ):
        raise WatchlistDigestSourceLimitReached()
    source = sources_crud.create_source(
        session=session,
        user_id=user_id,
        frequency=payload.frequency,
        list_id=payload.list_id,
        cinema_preset_id=payload.cinema_preset_id,
        custom_cinema_ids=payload.custom_cinema_ids,
        now=now_amsterdam_naive(),
    )
    session.commit()
    return _to_public(source)


def update_source(
    *,
    session: Session,
    user_id: UUID,
    source_id: UUID,
    payload: WatchlistDigestSourceUpdate,
) -> WatchlistDigestSourcePublic:
    source = sources_crud.get_user_source_by_id(
        session=session, user_id=user_id, source_id=source_id
    )
    if source is None:
        raise WatchlistDigestSourceNotFound()

    data = payload.model_dump(exclude_unset=True)

    # The cinema selection is one of {preset, custom, neither}. A client that
    # sends only one side switches to it and implicitly clears the other; a
    # client that sends both is explicit and must not pick two at once.
    sends_preset = "cinema_preset_id" in data
    sends_custom = "custom_cinema_ids" in data
    if sends_preset and sends_custom:
        if data["cinema_preset_id"] is not None and data["custom_cinema_ids"] is not None:
            raise WatchlistDigestSourceCinemaSelectionConflict()
    elif sends_preset and data["cinema_preset_id"] is not None:
        data["custom_cinema_ids"] = None
    elif sends_custom and data["custom_cinema_ids"] is not None:
        data["cinema_preset_id"] = None

    for field, value in data.items():
        setattr(source, field, value)
    session.add(source)
    session.commit()
    session.refresh(source)
    return _to_public(source)


def delete_source(*, session: Session, user_id: UUID, source_id: UUID) -> bool:
    deleted = sources_crud.delete_source(
        session=session, user_id=user_id, source_id=source_id
    )
    if deleted:
        session.commit()
    return deleted
