from sqlmodel import Field, SQLModel

__all__ = [
    "MovieBase",
    "MovieCreate",
    "MovieUpdate",
    "Movie",
]


# Shared properties
class MovieBase(SQLModel):
    id: int = Field(
        unique=True,
        index=True,
        primary_key=True,
    )
    title: str
    poster_link: str | None = None
    letterboxd_slug: str | None = None


# Properties to receive on movie creation
class MovieCreate(MovieBase):
    pass


# Properties to receive on movie update
class MovieUpdate(SQLModel):
    title: str | None = None
    poster_link: str | None = None
    letterboxd_slug: str | None = None


# Database model, database table inferred from class name
class Movie(MovieBase, table=True):
    pass
