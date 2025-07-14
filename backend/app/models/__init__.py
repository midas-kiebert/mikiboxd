from .user import *
from .item import *
from .auth_schemas import *
from .showtime import Showtime, ShowtimeCreate, ShowtimePublic, ShowtimeInMoviePublic
from .movie import Movie, MovieCreate, MoviePublic, MovieUpdate, MovieSummaryPublic
from .friendship import Friendship, FriendRequest
from .showtime_selection import ShowtimeSelection
from .city import City, CityCreate, CityPublic
from .cinema import Cinema, CinemaCreate, CinemaPublic
from .watchlist_selection import WatchlistSelection

Showtime.model_rebuild()
Movie.model_rebuild()
MoviePublic.model_rebuild()
ShowtimePublic.model_rebuild()  # Rebuild the public model to ensure all fields are set up correctly
ShowtimeInMoviePublic.model_rebuild()  # Rebuild the model for showtimes in MoviePublic
User.model_rebuild()
ShowtimeSelection.model_rebuild()  # Rebuild the ShowtimeSelection model to ensure relationships are set up correctly
WatchlistSelection.model_rebuild()

__all__ = [
    "User",
    "UserBase",
    "UserCreate",
    "UserUpdate",
    "UserPublic",
    "UserWithShowtimesPublic",
    "UsersPublic",
    "Item",
    "ItemCreate",
    "ItemPublic",
    "AuthToken",
    "AuthTokenCreate",
    "Showtime",
    "ShowtimeCreate",
    "ShowtimePublic",
    "ShowtimeInMoviePublic",
    "Movie",
    "MovieCreate",
    "MoviePublic",
    "MovieUpdate",
    "MovieSummaryPublic",
    "Friendship",
    "FriendRequest",
    "ShowtimeSelection",
    "City",
    "CityCreate",
    "CityPublic",
    "Cinema",
    "CinemaCreate",
    "CinemaPublic",
    "WatchlistSelection"
]