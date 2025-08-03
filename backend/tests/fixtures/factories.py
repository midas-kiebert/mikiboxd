from uuid import uuid4

import pytest
from factory import (
    Factory,  # type: ignore
    Faker,  # type: ignore
    LazyFunction,  # type: ignore
    SelfAttribute,  # type: ignore
    Sequence,  # type: ignore
    SubFactory,  # type: ignore
    post_generation,  # type: ignore
)
from factory.alchemy import SQLAlchemyModelFactory
from sqlmodel import Session

from app.core.security import get_password_hash
from app.models.cinema import Cinema, CinemaCreate
from app.models.city import City, CityCreate
from app.models.letterboxd import Letterboxd
from app.models.movie import Movie, MovieCreate
from app.models.showtime import Showtime, ShowtimeCreate
from app.models.showtime_selection import ShowtimeSelection
from app.models.user import User, UserCreate, UserRegister
from app.schemas.cinema import CinemaPublic
from app.schemas.city import CityPublic
from app.schemas.movie import MovieSummaryLoggedIn
from app.schemas.showtime import ShowtimeInMovieLoggedIn
from app.schemas.user import UserPublic

__all__ = [
    "city_create_factory",
    "city_factory",
    "cinema_create_factory",
    "cinema_factory",
    "movie_create_factory",
    "movie_factory",
    "showtime_create_factory",
    "showtime_factory",
    "user_register_factory",
    "user_create_factory",
    "user_factory",
    "showtime_in_movie_logged_in_factory",
    "cinema_public_factory",
    "city_public_factory",
    "user_public_factory",
    "showtime_logged_in_factory",
    "movie_summary_logged_in_factory",
]


class SQLModelFactory(SQLAlchemyModelFactory):
    class Meta:
        abstract = True
        sqlalchemy_session_persistence = "flush"


# --------------------------------------
# FACTORIES
# --------------------------------------


class CityCreateFactory(Factory):
    class Meta:
        model = CityCreate

    id = Sequence(lambda n: n + 1)
    name = Faker("city")


@pytest.fixture
def city_create_factory():
    return CityCreateFactory


class CityFactory(SQLModelFactory):
    class Meta:
        model = City

    id = Sequence(lambda n: n + 1)
    name = Faker("city")


@pytest.fixture
def city_factory(db_transaction: Session):
    CityFactory._meta.sqlalchemy_session = db_transaction
    return CityFactory


class CinemaCreateFactory(Factory):
    class Meta:
        model = CinemaCreate

    name = Faker("company")
    cineville = Faker("boolean", chance_of_getting_true=50)
    badge_bg_color = Faker("color")
    badge_text_color = Faker("color")
    url = Faker("url")
    city_id: int


@pytest.fixture
def cinema_create_factory():
    return CinemaCreateFactory


class CinemaFactory(SQLModelFactory):
    class Meta:
        model = Cinema

    id = Sequence(lambda n: n + 1)
    name = Faker("company")
    cineville = Faker("boolean", chance_of_getting_true=50)
    badge_bg_color = Faker("color")
    badge_text_color = Faker("color")
    url = Faker("url")
    city_id = Faker("random_int", min=1, max=1000)  # Random city ID for testing
    city = SubFactory(CityFactory)
    city_id = SelfAttribute("city.id")

    @post_generation
    def showtimes(self, create, extracted, **kwargs):
        if not create:
            return

        if extracted:
            for showtime in extracted:
                showtime.cinema = self
                showtime.cinema_id = self.id


@pytest.fixture
def cinema_factory(db_transaction: Session):
    CityFactory._meta.sqlalchemy_session = db_transaction
    CinemaFactory._meta.sqlalchemy_session = db_transaction
    return CinemaFactory


class MovieCreateFactory(Factory):
    class Meta:
        model = MovieCreate

    id = Sequence(lambda n: n + 1)
    title = Faker("sentence", nb_words=3)
    poster_link = Faker("image_url", width=300, height=450)
    letterboxd_slug = Faker("slug")


@pytest.fixture
def movie_create_factory():
    return MovieCreateFactory


class MovieFactory(SQLModelFactory):
    class Meta:
        model = Movie

    id = Sequence(lambda n: n + 1)
    title = Faker("sentence", nb_words=3)
    poster_link = Faker("image_url", width=300, height=450)
    letterboxd_slug = Faker("slug")

    @post_generation
    def showtimes(self, create, extracted, **kwargs):
        if not create:
            return

        if extracted:
            for showtime in extracted:
                showtime.movie = self
                showtime.movie_id = self.id


@pytest.fixture
def movie_factory(db_transaction: Session):
    MovieFactory._meta.sqlalchemy_session = db_transaction
    return MovieFactory


class ShowtimeCreateFactory(Factory):
    class Meta:
        model = ShowtimeCreate

    cinema_id: int
    movie_id: int
    datetime = Faker("date_time_between", start_date="+1d", end_date="+30d")
    theatre = Faker("sentence", nb_words=2)
    ticket_link = Faker("url")


@pytest.fixture
def showtime_create_factory():
    return ShowtimeCreateFactory


class ShowtimeFactory(SQLModelFactory):
    class Meta:
        model = Showtime

    id = Sequence(lambda n: n + 1)
    datetime = Faker("date_time_between", start_date="+1d", end_date="+30d")
    theatre = Faker("sentence", nb_words=2)
    ticket_link = Faker("url")
    cinema = SubFactory(CinemaFactory)
    cinema_id = SelfAttribute("cinema.id")
    movie = SubFactory(MovieFactory)
    movie_id = SelfAttribute("movie.id")


@pytest.fixture
def showtime_factory(db_transaction: Session):
    CityFactory._meta.sqlalchemy_session = db_transaction
    CinemaFactory._meta.sqlalchemy_session = db_transaction
    MovieFactory._meta.sqlalchemy_session = db_transaction
    ShowtimeFactory._meta.sqlalchemy_session = db_transaction
    return ShowtimeFactory


class CityPublicFactory(Factory):
    class Meta:
        model = CityPublic

    id = Sequence(lambda n: n + 1)
    name = Faker("city")


@pytest.fixture
def city_public_factory():
    return CityPublicFactory


class CinemaPublicFactory(Factory):
    class Meta:
        model = CinemaPublic

    id = Sequence(lambda n: n + 1)
    name = Faker("company")
    cineville = Faker("boolean", chance_of_getting_true=50)
    badge_bg_color = Faker("color")
    badge_text_color = Faker("color")
    url = Faker("url")
    city = SubFactory(CityPublicFactory)


@pytest.fixture
def cinema_public_factory():
    return CinemaPublicFactory

class UserPublicFactory(Factory):
    class Meta:
        model = UserPublic

    id = Faker("uuid4")
    email = Faker("email")
    display_name = Faker("name")
    letterboxd_username = Faker("user_name")
    is_active = True
    is_superuser = False
    last_watchlist_sync = Faker("date_time_this_year", before_now=True, after_now=False)


@pytest.fixture
def user_public_factory():
    return UserPublicFactory


class ShowtimeInMovieLoggedInFactory(Factory):
    class Meta:
        model = ShowtimeInMovieLoggedIn

    id = Sequence(lambda n: n + 1)
    datetime = Faker("date_time_between", start_date="+1d", end_date="+30d")
    theatre = Faker("sentence", nb_words=2)
    ticket_link = Faker("url")
    cinema = SubFactory(CinemaPublicFactory)
    friends_going = LazyFunction(lambda: [UserPublicFactory() for _ in range(3)])
    going = Faker("boolean", chance_of_getting_true=50)


@pytest.fixture
def showtime_in_movie_logged_in_factory():
    return ShowtimeInMovieLoggedInFactory


class MovieSummaryLoggedInFactory(Factory):
    class Meta:
        model = MovieSummaryLoggedIn

    id = Sequence(lambda n: n + 1)
    title = Faker("sentence", nb_words=3)
    poster_link = Faker("image_url", width=300, height=450)
    letterboxd_slug = Faker("slug")
    showtimes = LazyFunction(
        lambda: [ShowtimeInMovieLoggedInFactory() for _ in range(3)]
    )
    cinemas = LazyFunction(lambda: [CinemaPublicFactory() for _ in range(2)])
    last_showtime_datetime = Faker(
        "date_time_this_year", before_now=True, after_now=True
    )
    total_showtimes = Faker("random_int", min=1, max=10)
    friends_going = LazyFunction(lambda: [UserPublicFactory() for _ in range(3)])
    going = Faker("boolean", chance_of_getting_true=50)


@pytest.fixture
def movie_summary_logged_in_factory():
    return MovieSummaryLoggedInFactory


class ShowtimeLoggedInFactory(Factory):
    class Meta:
        model = ShowtimeSelection

    id = Sequence(lambda n: n + 1)
    datetime = Faker("date_time_between", start_date="+1d", end_date="+30d")
    theatre = Faker("sentence", nb_words=2)
    ticket_link = Faker("url")
    cinema = SubFactory(CinemaPublicFactory)
    movie = SubFactory(MovieSummaryLoggedInFactory)
    friends_going = LazyFunction(lambda: [UserPublicFactory() for _ in range(3)])
    going = Faker("boolean", chance_of_getting_true=50)


@pytest.fixture
def showtime_logged_in_factory():
    return ShowtimeLoggedInFactory


class UserCreateFactory(Factory):
    class Meta:
        model = UserCreate

    email = Faker("email")
    password = Faker(
        "password", special_chars=True, digits=True, upper_case=True, lower_case=True
    )
    display_name = Faker("name")
    # letterboxd_username = Faker("user_name")
    is_active = True
    is_superuser = False


@pytest.fixture
def user_register_factory():
    return UserRegisterFactory


class UserRegisterFactory(Factory):
    class Meta:
        model = UserRegister

    email = Faker("email")
    password = Faker(
        "", special_chars=True, digits=True, upper_case=True, lower_case=True
    )
    display_name = Faker("name")


@pytest.fixture
def user_create_factory():
    return UserCreateFactory


class LetterboxdFactory(SQLModelFactory):
    class Meta:
        model = Letterboxd

    letterboxd_username = Faker("user_name")
    last_watchlist_sync = Faker("date_time_this_year", before_now=True, after_now=False)


class UserFactory(SQLModelFactory):
    class Meta:
        model = User

    id = LazyFunction(uuid4)
    email = Faker("email")
    display_name = Faker("name")
    is_active = True
    is_superuser = False
    hashed_password = get_password_hash("password")
    letterboxd = SubFactory(LetterboxdFactory)
    letterboxd_username = SelfAttribute("letterboxd.letterboxd_username")

    @post_generation
    def password(self, create, extracted, **kwargs):
        if create and extracted:
            self.hashed_password = get_password_hash(extracted)


@pytest.fixture
def user_factory(db_transaction: Session):
    LetterboxdFactory._meta.sqlalchemy_session = db_transaction # type: ignore
    UserFactory._meta.sqlalchemy_session = db_transaction # type: ignore
    return UserFactory
