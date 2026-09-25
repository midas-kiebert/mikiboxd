"""The "these cinemas" filter on showtimes, shared by every list and count.

A festival is a cinema row too (`CinemaKind.FESTIVAL`), and picking it means
the festival: its screenings play in real cinemas and only point at it through
`Showtime.festival_id`. Matching that as well as `cinema_id` is what makes
picking LIFF show all of LIFF, in Trianon and Kijkhuis included, while picking
Trianon still shows the LIFF screenings that play there.
"""

from collections.abc import Collection
from typing import Any

from sqlalchemy import ColumnElement, Select, or_
from sqlmodel import col

from app.models.showtime import Showtime


def showtime_at_cinemas(
    cinema_ids: Collection[int] | Select[Any],
) -> ColumnElement[bool]:
    """Showtimes at these cinemas, or part of these festivals.

    Takes a subquery of ids too (search by cinema name).
    """
    return or_(
        col(Showtime.cinema_id).in_(cinema_ids),
        col(Showtime.festival_id).in_(cinema_ids),
    )
