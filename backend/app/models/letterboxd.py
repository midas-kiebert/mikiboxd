from datetime import datetime

from sqlmodel import Field, SQLModel


class Letterboxd(SQLModel, table=True):
    letterboxd_username: str = Field(primary_key=True)
    last_watchlist_sync: datetime | None
