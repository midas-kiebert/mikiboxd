"""Turning a ticked list of cinemas into a rule, and back again.

The two directions are deliberately in one file: they are inverses, and the
only way to see that ``resolve`` undoes ``infer`` is to read them together.

Inference happens on the backend rather than in the app on purpose. Every
client — including builds already installed on phones — keeps sending and
reading a plain list of cinema ids, and gets the follow-the-city behaviour
without knowing the rule exists.
"""

from typing import Any

from sqlmodel import Session

from app.crud import cinema as cinemas_crud
from app.models.cinema import Cinema
from app.schemas.cinema_scope import CinemaScope

__all__ = ["infer_cinema_scope", "parse_cinema_scope", "resolve_cinema_scope"]

# A city is only read as "the user wanted this whole city" from this many
# cinemas up. Below it the rule would be indistinguishable from picking the
# cinemas themselves: ticking the single cinema in a one-cinema city says
# nothing about wanting the next one that opens there.
CITY_SCOPE_MINIMUM_CINEMAS = 2


def _cinemas_by_city(cinemas: list[Cinema]) -> dict[int, set[int]]:
    grouped: dict[int, set[int]] = {}
    for cinema in cinemas:
        grouped.setdefault(cinema.city_id, set()).add(cinema.id)
    return grouped


def infer_cinema_scope(
    *,
    session: Session,
    cinema_ids: list[int],
) -> CinemaScope:
    """Read a ticked selection as the rule the user most likely meant.

    Selecting every cinema means every cinema; selecting every cinema in a
    city means that city. Anything left over stays an explicit id, so a
    partly-ticked city never starts collecting new cinemas.

    An empty selection carries no rule. It is already how "no cinema filter"
    is spelled everywhere else, and turning it into ``all_cinemas`` would make
    a preset that filters nothing indistinguishable from one that deliberately
    selects everything.
    """
    selected = set(cinema_ids)
    if not selected:
        return CinemaScope()

    all_cinemas = cinemas_crud.get_cinemas(session=session)
    every_id = {cinema.id for cinema in all_cinemas}
    if every_id and selected >= every_id:
        return CinemaScope(all_cinemas=True)

    covered: set[int] = set()
    city_ids: list[int] = []
    for city_id, city_cinema_ids in _cinemas_by_city(all_cinemas).items():
        if len(city_cinema_ids) < CITY_SCOPE_MINIMUM_CINEMAS:
            continue
        if city_cinema_ids <= selected:
            city_ids.append(city_id)
            covered |= city_cinema_ids

    return CinemaScope(
        city_ids=sorted(city_ids),
        cinema_ids=sorted(selected - covered),
    )


def resolve_cinema_scope(
    *,
    session: Session,
    scope: CinemaScope | None,
    stored_cinema_ids: list[int] | None,
) -> list[int] | None:
    """Expand a stored rule into the ids it selects *today*.

    Presets saved before scopes existed have no rule, and fall back to the ids
    they froze — they keep behaving exactly as they did.
    """
    if scope is None:
        return stored_cinema_ids

    all_cinemas = cinemas_crud.get_cinemas(session=session)
    if scope.all_cinemas:
        return sorted(cinema.id for cinema in all_cinemas)

    wanted_cities = set(scope.city_ids)
    resolved = set(scope.cinema_ids)
    resolved |= {
        cinema.id for cinema in all_cinemas if cinema.city_id in wanted_cities
    }
    return sorted(resolved)


def parse_cinema_scope(stored: dict[str, Any] | None) -> CinemaScope | None:
    """Read a scope back off a row, treating anything unreadable as absent.

    A row whose scope cannot be parsed falls back to its frozen id list, which
    is the behaviour every preset had before scopes existed — worse than
    following the city, but never wrong enough to empty someone's feed.
    """
    if stored is None:
        return None
    try:
        return CinemaScope.model_validate(stored)
    except ValueError:
        return None
