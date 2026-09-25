"""The festival badge and the Cineville pass flag on served showtimes.

`cineville_pass` on a showtime is None for a regular programme ("same as the
cinema") and set per screening by a festival; the served value must fall back
to `cinema.cineville` only in the first case.
"""

import pytest
from sqlmodel import Session

from app.converters import cinema as cinema_converters
from app.converters import showtime as showtime_converters
from app.core.enums import CinemaKind
from app.schemas.cinema import FestivalPublic


@pytest.mark.parametrize(
    ("showtime_pass", "cinema_cineville", "expected"),
    [
        (None, True, True),
        (None, False, False),
        (False, True, False),
        (True, False, True),
        (True, True, True),
        (False, False, False),
    ],
)
def test_cineville_pass_prefers_showtime_value_then_cinema(
    *,
    cinema_factory,
    showtime_factory,
    showtime_pass,
    cinema_cineville,
    expected,
):
    cinema = cinema_factory(cineville=cinema_cineville)
    showtime = showtime_factory(cinema=cinema, cineville_pass=showtime_pass)

    assert cinema_converters.cineville_pass(showtime) is expected


def test_festival_to_public_is_none_without_festival_id(
    *,
    db_transaction: Session,
    showtime_factory,
):
    showtime = showtime_factory(festival_id=None)

    assert (
        cinema_converters.festival_to_public(
            session=db_transaction, showtime=showtime
        )
        is None
    )


def test_festival_to_public_returns_the_festival_cinema(
    *,
    db_transaction: Session,
    cinema_factory,
    showtime_factory,
):
    festival = cinema_factory(
        kind=CinemaKind.FESTIVAL,
        name="Leiden International Film Festival",
        url="https://www.liff.nl",
        badge_bg_color="#e30613",
    )
    real_cinema = cinema_factory()
    showtime = showtime_factory(cinema=real_cinema, festival_id=festival.id)

    public = cinema_converters.festival_to_public(
        session=db_transaction, showtime=showtime
    )

    assert isinstance(public, FestivalPublic)
    assert public.id == festival.id
    assert public.name == "Leiden International Film Festival"
    assert public.url == "https://www.liff.nl"
    assert public.badge_bg_color == "#e30613"


def test_showtime_to_public_fills_festival_and_cineville_pass(
    *,
    db_transaction: Session,
    cinema_factory,
    showtime_factory,
):
    """A festival screening in a Cineville cinema that the pass does not
    cover: `cineville_pass` is the showtime's False, not the cinema's True,
    and `cinema` stays the real location."""
    festival = cinema_factory(kind=CinemaKind.FESTIVAL)
    real_cinema = cinema_factory(cineville=True)
    showtime = showtime_factory(
        cinema=real_cinema, festival_id=festival.id, cineville_pass=False
    )

    public = showtime_converters.to_public(
        showtime, session=db_transaction, user_id=None
    )

    assert public.festival is not None
    assert public.festival.id == festival.id
    assert public.cinema.id == real_cinema.id
    assert public.cineville_pass is False


def test_showtime_to_public_without_festival_falls_back_to_cinema(
    *,
    db_transaction: Session,
    cinema_factory,
    showtime_factory,
):
    cinema = cinema_factory(cineville=True)
    showtime = showtime_factory(cinema=cinema, cineville_pass=None)

    public = showtime_converters.to_public(
        showtime, session=db_transaction, user_id=None
    )

    assert public.festival is None
    assert public.cineville_pass is True


def test_showtime_to_in_movie_public_fills_festival_and_cineville_pass(
    *,
    db_transaction: Session,
    cinema_factory,
    showtime_factory,
):
    festival = cinema_factory(kind=CinemaKind.FESTIVAL)
    real_cinema = cinema_factory(cineville=False)
    showtime = showtime_factory(
        cinema=real_cinema, festival_id=festival.id, cineville_pass=True
    )

    public = showtime_converters.to_in_movie_public(
        showtime, session=db_transaction, user_id=None
    )

    assert public.festival is not None
    assert public.festival.id == festival.id
    assert public.cineville_pass is True


def test_showtime_to_in_movie_public_without_festival_falls_back_to_cinema(
    *,
    db_transaction: Session,
    cinema_factory,
    showtime_factory,
):
    cinema = cinema_factory(cineville=False)
    showtime = showtime_factory(cinema=cinema, cineville_pass=None)

    public = showtime_converters.to_in_movie_public(
        showtime, session=db_transaction, user_id=None
    )

    assert public.festival is None
    assert public.cineville_pass is False
