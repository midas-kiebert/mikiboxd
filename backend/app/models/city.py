from sqlmodel import SQLModel, Field, Relationship

from typing import TYPE_CHECKING
if TYPE_CHECKING:
    from .cinema import Cinema

class CityBase(SQLModel):
    name: str = Field(description="Name of the city")
    id: int = Field(description="ID of the city")

class CityCreate(CityBase):
    pass


class City(CityBase, table=True):
    id: int = Field(default=None, primary_key=True, index=True, description="Unique identifier for the city")
    cinemas: list["Cinema"] = Relationship(back_populates="city", sa_relationship_kwargs={"lazy": "noload"})


class CityPublic(CityBase):
    pass

