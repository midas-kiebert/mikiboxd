"""City models."""

from sqlmodel import Field, SQLModel


class CityBase(SQLModel):
    name: str = Field(description="Name of the city")
    id: int = Field(description="ID of the city")


class CityCreate(CityBase):
    pass


class City(CityBase, table=True):
    id: int = Field(
        default=None,
        primary_key=True,
        index=True,
        description="Unique identifier for the city",
    )
