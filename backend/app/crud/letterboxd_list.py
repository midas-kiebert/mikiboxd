"""CRUD helpers for shared Letterboxd lists and their per-user links."""

from uuid import UUID

from sqlmodel import Session, col, delete, func, select

from app.models.letterboxd_list import (
    LetterboxdList,
    LetterboxdListFilm,
    UserLetterboxdList,
)


def get_list_by_owner_slug(
    *, session: Session, owner: str, list_slug: str
) -> LetterboxdList | None:
    stmt = select(LetterboxdList).where(
        col(LetterboxdList.owner) == owner,
        col(LetterboxdList.list_slug) == list_slug,
    )
    return session.exec(stmt).one_or_none()


def get_list_by_id(*, session: Session, list_id: UUID) -> LetterboxdList | None:
    return session.get(LetterboxdList, list_id)


def create_list(*, session: Session, letterboxd_list: LetterboxdList) -> LetterboxdList:
    session.add(letterboxd_list)
    session.flush()
    return letterboxd_list


def replace_list_films(
    *,
    session: Session,
    list_id: UUID,
    films: list[LetterboxdListFilm],
) -> None:
    """Replace the cached film set for a list (delete-all then insert)."""
    session.execute(
        delete(LetterboxdListFilm).where(col(LetterboxdListFilm.list_id) == list_id)
    )
    for film in films:
        session.add(film)
    session.flush()


def get_list_film_count(*, session: Session, list_id: UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(LetterboxdListFilm)
        .where(col(LetterboxdListFilm.list_id) == list_id)
    )
    return int(session.exec(stmt).one())


def get_user_lists(*, session: Session, user_id: UUID) -> list[LetterboxdList]:
    stmt = (
        select(LetterboxdList)
        .join(
            UserLetterboxdList,
            col(UserLetterboxdList.list_id) == col(LetterboxdList.id),
        )
        .where(col(UserLetterboxdList.user_id) == user_id)
    )
    return list(session.exec(stmt).all())


def get_curated_lists(*, session: Session) -> list[LetterboxdList]:
    stmt = select(LetterboxdList).where(col(LetterboxdList.is_curated).is_(True))
    return list(session.exec(stmt).all())


def user_list_link_exists(*, session: Session, user_id: UUID, list_id: UUID) -> bool:
    return session.get(UserLetterboxdList, (user_id, list_id)) is not None


def add_user_list_link(
    *, session: Session, user_id: UUID, list_id: UUID
) -> UserLetterboxdList:
    link = UserLetterboxdList(user_id=user_id, list_id=list_id)
    session.add(link)
    session.flush()
    return link


def remove_user_list_link(*, session: Session, user_id: UUID, list_id: UUID) -> None:
    link = session.get(UserLetterboxdList, (user_id, list_id))
    if link is not None:
        session.delete(link)
        session.flush()
