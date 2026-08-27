"""Resolving a browse request's filters against whoever is asking.

Some of the browse filters are only half-specified by the client. It sends no
cinema list when it means "wherever I usually go", and it sends watchlist and
Letterboxd-list filters that only mean something once we know whose account to
read them against. Both are settled here, before the query is built.

An anonymous viewer (see `app.core.viewer`) has none of it, and that is a real
answer rather than a missing one: no saved cinemas means the whole catalogue,
not an empty feed.
"""

from uuid import UUID

from sqlmodel import Session

from app.core.enums import SearchField
from app.core.viewer import ViewerId
from app.crud import cinema_preset as cinema_presets_crud
from app.crud import letterboxd_list as lists_crud
from app.crud import user as users_crud
from app.inputs.movie import Filters


def _is_cinema_name_search(filters: Filters) -> bool:
    """Is this request searching *for* cinemas by name?

    Such a search already names the cinemas it wants, so falling back to the
    viewer's usual ones on top of it could only ever hide the cinema they typed.
    """
    return filters.search_field == SearchField.CINEMA and bool(
        filters.query and filters.query.strip()
    )


def _keep_curated(
    list_ids: list[UUID] | None, curated_ids: set[UUID]
) -> list[UUID] | None:
    """Narrow a list-id filter to the shared lists, or None if none survive."""
    if list_ids is None:
        return None
    kept = [list_id for list_id in list_ids if list_id in curated_ids]
    return kept or None


def apply_viewer_defaults(
    *,
    session: Session,
    viewer_id: ViewerId,
    filters: Filters,
) -> None:
    """Settle the filters that depend on who is asking, in place.

    Cinemas: an explicit list from the client always wins — that is the user
    narrowing the feed by hand for this one request. Only when none was sent do
    we fall back to the account's favourite cinema preset, then to its legacy
    cinema selection. A cinema-name search is the other way a request already
    says which cinemas it means, and it is left unrestricted for the same
    reason. An anonymous viewer has neither, so the field is left as None, which
    every query reads as "no cinema restriction".

    Letterboxd lists: the curated ones are shared by everybody, so an anonymous
    request may filter by them exactly as a signed-in one does. Any other id
    names a list somebody added to their own account, which an anonymous request
    cannot be filtering by — whatever it sent is somebody else's, or a guess —
    so those are dropped.
    """
    if viewer_id is None:
        curated_ids = lists_crud.get_curated_list_ids(session=session)
        filters.list_ids = _keep_curated(filters.list_ids, curated_ids)
        filters.exclude_list_ids = _keep_curated(filters.exclude_list_ids, curated_ids)
        return

    if filters.selected_cinema_ids is None and not _is_cinema_name_search(filters):
        favorite_preset = cinema_presets_crud.get_user_favorite_preset(
            session=session,
            user_id=viewer_id,
        )
        if favorite_preset is not None:
            filters.selected_cinema_ids = list(favorite_preset.cinema_ids)
        else:
            # Compatibility fallback for users still on legacy cinema selections.
            filters.selected_cinema_ids = users_crud.get_selected_cinemas_ids(
                session=session,
                user_id=viewer_id,
            )


def letterboxd_username_for(*, session: Session, viewer_id: ViewerId) -> str | None:
    """The viewer's linked Letterboxd account, if any. None when anonymous."""
    if viewer_id is None:
        return None
    return users_crud.get_letterboxd_username(session=session, user_id=viewer_id)
