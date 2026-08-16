"""Resolving a browse request's filters against whoever is asking.

Some of the browse filters are only half-specified by the client. It sends no
cinema list when it means "wherever I usually go", and it sends watchlist and
Letterboxd-list filters that only mean something once we know whose account to
read them against. Both are settled here, before the query is built.

An anonymous viewer (see `app.core.viewer`) has none of it, and that is a real
answer rather than a missing one: no saved cinemas means the whole catalogue,
not an empty feed.
"""

from sqlmodel import Session

from app.core.viewer import ViewerId
from app.crud import cinema_preset as cinema_presets_crud
from app.crud import user as users_crud
from app.inputs.movie import Filters


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
    cinema selection. An anonymous viewer has neither, so the field is left as
    None, which every query reads as "no cinema restriction".

    Letterboxd lists: these name rows that belong to an account, so an anonymous
    request cannot be filtering by its own — whatever ids it sent are somebody
    else's, or a guess. They are dropped rather than honoured.
    """
    if viewer_id is None:
        filters.list_ids = None
        filters.exclude_list_ids = None
        return

    if filters.selected_cinema_ids is None:
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
