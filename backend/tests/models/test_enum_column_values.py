"""Enum columns must store the enum's *value*, not its Python name.

SQLAlchemy's default `Enum` mapping persists `ScreenSide.TOP` as `"TOP"`.
Every enum column here is meant to hold the lowercase value instead — it is
what the migrations write, what `cinemas.yaml` writes, and what makes the
column readable in a psql session. Getting it wrong does not fail at import
or at write time: it fails when a row written by a migration is *read back*,
with `LookupError: 'top' is not among the defined enum values`, which is how
this was found — on staging, from a script, after the migration had already
run.
"""

from sqlalchemy import Enum as SAEnum

from app.models.cinema import Cinema
from app.models.cinema_room_floor_plan import CinemaRoomFloorPlan
from app.models.showtime import Showtime

# (model, column) pairs whose Python enum has values that differ from its
# member names. Add a row here when a model gains such a column.
ENUM_COLUMNS = (
    (Cinema, "seating"),
    (Showtime, "seats_level_floor"),
    (CinemaRoomFloorPlan, "screen_side"),
)


def test_enum_columns_persist_lowercase_values() -> None:
    for model, column_name in ENUM_COLUMNS:
        column = model.__table__.c[column_name]
        assert isinstance(column.type, SAEnum), f"{model.__name__}.{column_name}"
        # Names are upper-case by convention; values are not. If the stored
        # set matches the names, `values_callable` was forgotten.
        assert column.type.enums == [
            member.value for member in column.type.enum_class
        ], f"{model.__name__}.{column_name} stores names, not values"


def test_enum_columns_are_not_native_postgres_enums() -> None:
    """A native enum type would need its own migration to add a member, and
    would reject the plain VARCHAR the migrations write."""
    for model, column_name in ENUM_COLUMNS:
        column = model.__table__.c[column_name]
        assert column.type.native_enum is False, f"{model.__name__}.{column_name}"


def test_floor_plan_screen_side_defaults_to_top_in_the_database() -> None:
    """Rooms ingested before the column existed have to keep rendering the way
    they did, which is screen-at-top — so the default belongs on the column and
    not only in Python."""
    column = CinemaRoomFloorPlan.__table__.c["screen_side"]
    assert column.server_default is not None
    assert column.server_default.arg == "top"
    assert column.nullable is False
