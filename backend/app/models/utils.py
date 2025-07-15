from typing import Any, cast

from sqlalchemy.orm.attributes import InstrumentedAttribute


def column(attr: Any) -> InstrumentedAttribute[Any]:
    return cast(InstrumentedAttribute[Any], attr)
