"""How a preset stores *which* cinemas it selects.

A preset used to store the plain list of cinema ids the user had ticked. New
cinemas open every few months, and a frozen list silently excludes them: a
user who picked "everything in Amsterdam" a year ago is still looking at last
year's Amsterdam.

So a selection is stored as the *rule* that produced it instead — every
cinema, every cinema in these cities, plus these specific ones — and the rule
is expanded against the current cinema list every time the preset is read.
The rule is inferred from the ticked ids at save time (see
``app.services.cinema_scope``), so no client has to know this exists; the
selection a client sends and the one it reads back are still plain id lists.
"""

from sqlmodel import Field, SQLModel

__all__ = ["CinemaScope"]


class CinemaScope(SQLModel):
    """A cinema selection as a rule rather than a frozen list of ids.

    The three parts are a union: the selection is every cinema (``all_cinemas``),
    or everything in ``city_ids`` together with everything in ``cinema_ids``.
    ``all_cinemas`` subsumes the other two, which are left empty when it is set.
    """

    all_cinemas: bool = False
    # Cities the user selected in full. Every cinema in these is selected,
    # including ones added after the preset was saved.
    city_ids: list[int] = Field(default_factory=list)
    # Cinemas selected individually — the ones no city rule already covers.
    cinema_ids: list[int] = Field(default_factory=list)
