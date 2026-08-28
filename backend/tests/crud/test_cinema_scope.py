"""A preset stores the rule behind a cinema selection, not a frozen list.

Cinemas open every few months. A preset saved as "everything in Amsterdam" has
to keep meaning that; one saved as "these three cinemas" has to keep meaning
*that*, even when the two selected the same ids on the day they were saved.
"""

from sqlmodel import Session

from app.crud import cinema as cinema_crud
from app.crud.cinema_scope import (
    CITY_SCOPE_MINIMUM_CINEMAS,
    infer_cinema_scope,
    parse_cinema_scope,
    resolve_cinema_scope,
)
from app.models.cinema import Cinema
from app.schemas.cinema_scope import CinemaScope


def _every_cinema_id(session: Session) -> list[int]:
    return sorted(cinema.id for cinema in cinema_crud.get_cinemas(session=session))


def test_selecting_every_cinema_infers_the_all_cinemas_rule(
    *,
    db_transaction: Session,
    cinema_factory,
):
    cinema_factory()
    cinema_factory()

    scope = infer_cinema_scope(
        session=db_transaction,
        cinema_ids=_every_cinema_id(db_transaction),
    )

    assert scope.all_cinemas is True
    # `all_cinemas` subsumes the other two, which stay empty.
    assert scope.city_ids == []
    assert scope.cinema_ids == []


def test_selecting_a_whole_city_infers_that_city(
    *,
    db_transaction: Session,
    cinema_factory,
    city_factory,
):
    amsterdam = city_factory()
    elsewhere = city_factory()
    in_city: list[Cinema] = [
        cinema_factory(city=amsterdam),
        cinema_factory(city=amsterdam),
    ]
    # Another city keeps this from also being "every cinema".
    cinema_factory(city=elsewhere)
    cinema_factory(city=elsewhere)

    scope = infer_cinema_scope(
        session=db_transaction,
        cinema_ids=[cinema.id for cinema in in_city],
    )

    assert scope.all_cinemas is False
    assert scope.city_ids == [amsterdam.id]
    assert scope.cinema_ids == []


def test_a_partly_selected_city_stays_a_list_of_cinemas(
    *,
    db_transaction: Session,
    cinema_factory,
    city_factory,
):
    """The user picked some of the city, so a new cinema there is not implied."""
    amsterdam = city_factory()
    picked = cinema_factory(city=amsterdam)
    cinema_factory(city=amsterdam)
    cinema_factory(city=amsterdam)

    scope = infer_cinema_scope(session=db_transaction, cinema_ids=[picked.id])

    assert scope.all_cinemas is False
    assert scope.city_ids == []
    assert scope.cinema_ids == [picked.id]


def test_a_one_cinema_city_is_never_read_as_a_city_rule(
    *,
    db_transaction: Session,
    cinema_factory,
    city_factory,
):
    """Ticking the only cinema in a city says nothing about the next one there.

    Below `CITY_SCOPE_MINIMUM_CINEMAS` the city rule and the plain selection
    are indistinguishable at save time, so the narrower reading wins.
    """
    assert CITY_SCOPE_MINIMUM_CINEMAS == 2

    small_city = city_factory()
    only_cinema = cinema_factory(city=small_city)
    other_city = city_factory()
    cinema_factory(city=other_city)
    cinema_factory(city=other_city)

    scope = infer_cinema_scope(session=db_transaction, cinema_ids=[only_cinema.id])

    assert scope.city_ids == []
    assert scope.cinema_ids == [only_cinema.id]


def test_a_whole_city_plus_extras_keeps_both(
    *,
    db_transaction: Session,
    cinema_factory,
    city_factory,
):
    amsterdam = city_factory()
    utrecht = city_factory()
    amsterdam_cinemas = [cinema_factory(city=amsterdam), cinema_factory(city=amsterdam)]
    utrecht_picked = cinema_factory(city=utrecht)
    cinema_factory(city=utrecht)

    scope = infer_cinema_scope(
        session=db_transaction,
        cinema_ids=[cinema.id for cinema in amsterdam_cinemas] + [utrecht_picked.id],
    )

    assert scope.city_ids == [amsterdam.id]
    assert scope.cinema_ids == [utrecht_picked.id]


def test_an_empty_selection_carries_no_rule(
    *,
    db_transaction: Session,
    cinema_factory,
):
    """Empty already means "no cinema filter"; it must not become "all"."""
    cinema_factory()

    scope = infer_cinema_scope(session=db_transaction, cinema_ids=[])

    assert scope.all_cinemas is False
    assert scope.city_ids == []
    assert scope.cinema_ids == []


def test_a_city_rule_picks_up_a_cinema_that_opens_later(
    *,
    db_transaction: Session,
    cinema_factory,
    city_factory,
):
    amsterdam = city_factory()
    original = [cinema_factory(city=amsterdam), cinema_factory(city=amsterdam)]
    scope = infer_cinema_scope(
        session=db_transaction,
        cinema_ids=[cinema.id for cinema in original],
    )

    newcomer = cinema_factory(city=amsterdam)

    resolved = resolve_cinema_scope(
        session=db_transaction,
        scope=scope,
        stored_cinema_ids=[cinema.id for cinema in original],
    )

    assert resolved == sorted([cinema.id for cinema in original] + [newcomer.id])


def test_the_all_cinemas_rule_picks_up_a_new_cinema_anywhere(
    *,
    db_transaction: Session,
    cinema_factory,
    city_factory,
):
    cinema_factory()
    cinema_factory()
    original = _every_cinema_id(db_transaction)
    scope = infer_cinema_scope(session=db_transaction, cinema_ids=original)
    assert scope.all_cinemas is True

    # A new cinema in a city the preset had never heard of.
    cinema_factory(city=city_factory())

    resolved = resolve_cinema_scope(
        session=db_transaction,
        scope=scope,
        stored_cinema_ids=original,
    )

    assert resolved == _every_cinema_id(db_transaction)
    assert resolved != original


def test_an_explicit_selection_never_grows(
    *,
    db_transaction: Session,
    cinema_factory,
    city_factory,
):
    amsterdam = city_factory()
    picked = cinema_factory(city=amsterdam)
    cinema_factory(city=amsterdam)
    cinema_factory(city=amsterdam)
    scope = infer_cinema_scope(session=db_transaction, cinema_ids=[picked.id])

    cinema_factory(city=amsterdam)

    resolved = resolve_cinema_scope(
        session=db_transaction,
        scope=scope,
        stored_cinema_ids=[picked.id],
    )

    assert resolved == [picked.id]


def test_a_preset_saved_before_rules_existed_keeps_its_frozen_list(
    *,
    db_transaction: Session,
    cinema_factory,
    city_factory,
):
    amsterdam = city_factory()
    original = [cinema_factory(city=amsterdam), cinema_factory(city=amsterdam)]
    cinema_factory(city=amsterdam)

    resolved = resolve_cinema_scope(
        session=db_transaction,
        scope=None,
        stored_cinema_ids=[cinema.id for cinema in original],
    )

    assert resolved == [cinema.id for cinema in original]


def test_an_unreadable_stored_rule_falls_back_to_the_frozen_list():
    """Never worse than the old behaviour, whatever ends up in the column."""
    assert parse_cinema_scope(None) is None
    assert parse_cinema_scope({"all_cinemas": "not a boolean"}) is None
    assert parse_cinema_scope({"all_cinemas": True}) == CinemaScope(all_cinemas=True)
