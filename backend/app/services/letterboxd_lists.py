"""Service layer for shared, cached Letterboxd lists.

A list is identified by its ``(owner, list_slug)`` and shared across every user
who follows it, so it is scraped once and reused. The Letterboxd "last updated"
timestamp is stored and used as a cheap freshness probe: when re-syncing we
re-fetch only the first page and skip the full multi-page scrape if the list has
not changed since our last sync.
"""

from datetime import timedelta
from pathlib import Path
from uuid import UUID

import yaml
from sqlmodel import Session

from app.crud import letterboxd_list as lists_crud
from app.crud import movie as movies_crud
from app.exceptions.letterboxd_list_exceptions import (
    InvalidLetterboxdListUrl,
    LetterboxdListNotFound,
    LetterboxdListSyncTooSoon,
)
from app.models.letterboxd_list import LetterboxdList, LetterboxdListFilm
from app.schemas.letterboxd_list import LetterboxdListPublic
from app.scraping.letterboxd.lists import (
    InvalidListUrl,
    ScrapedList,
    list_url,
    resolve_list_url,
    scrape_list,
    scrape_list_metadata,
)
from app.scraping.logger import logger
from app.utils import now_amsterdam_naive

# A shared list is re-scraped at most this often, regardless of how many users
# request a sync; until then a sync is a no-op (the cache is served).
LIST_SYNC_MIN_INTERVAL = timedelta(hours=6)

_CURATED_LISTS_CONFIG = (
    Path(__file__).resolve().parents[1] / "configs" / "letterboxd_lists.yaml"
)


def _films_from_scrape(
    *, session: Session, list_id: UUID, scraped: ScrapedList
) -> list[LetterboxdListFilm]:
    """Build film rows, matching each slug to a catalog movie when present."""
    films: list[LetterboxdListFilm] = []
    for slug in scraped.slugs:
        movie = movies_crud.get_movie_by_letterboxd_slug(
            session=session, letterboxd_slug=slug
        )
        films.append(
            LetterboxdListFilm(
                list_id=list_id,
                letterboxd_slug=slug,
                movie_id=movie.id if movie else None,
            )
        )
    return films


def _scrape_and_store(
    *,
    session: Session,
    letterboxd_list: LetterboxdList,
) -> None:
    """Scrape the list and replace its cached films + metadata."""
    scraped = scrape_list(letterboxd_list.owner, letterboxd_list.list_slug)
    films = _films_from_scrape(
        session=session, list_id=letterboxd_list.id, scraped=scraped
    )
    lists_crud.replace_list_films(
        session=session, list_id=letterboxd_list.id, films=films
    )
    if scraped.title and not letterboxd_list.title:
        letterboxd_list.title = scraped.title
    letterboxd_list.last_updated_on_letterboxd = scraped.last_updated
    letterboxd_list.last_synced = now_amsterdam_naive()
    session.add(letterboxd_list)


def add_list_for_user(
    *, session: Session, user_id: UUID, raw_url: str
) -> LetterboxdList:
    """Attach a Letterboxd list (URL or boxd.it shortlink) to a user.

    If the list is already cached (another user follows it), the user is simply
    linked to the existing row — no scrape. Otherwise the list is scraped once
    and cached.
    """
    try:
        ref = resolve_list_url(raw_url)
    except InvalidListUrl as e:
        raise InvalidLetterboxdListUrl() from e

    letterboxd_list = lists_crud.get_list_by_owner_slug(
        session=session, owner=ref.owner, list_slug=ref.list_slug
    )
    if letterboxd_list is None:
        letterboxd_list = lists_crud.create_list(
            session=session,
            letterboxd_list=LetterboxdList(
                owner=ref.owner,
                list_slug=ref.list_slug,
                boxd_shortcode=ref.boxd_shortcode,
            ),
        )
        _scrape_and_store(session=session, letterboxd_list=letterboxd_list)
    elif ref.boxd_shortcode and not letterboxd_list.boxd_shortcode:
        letterboxd_list.boxd_shortcode = ref.boxd_shortcode
        session.add(letterboxd_list)

    if not lists_crud.user_list_link_exists(
        session=session, user_id=user_id, list_id=letterboxd_list.id
    ):
        lists_crud.add_user_list_link(
            session=session, user_id=user_id, list_id=letterboxd_list.id
        )

    session.commit()
    session.refresh(letterboxd_list)
    return letterboxd_list


def _is_fresh(letterboxd_list: LetterboxdList) -> bool:
    last_synced = letterboxd_list.last_synced
    return (
        last_synced is not None
        and now_amsterdam_naive() - last_synced < LIST_SYNC_MIN_INTERVAL
    )


def sync_list(
    *, session: Session, list_id: UUID, force: bool = False
) -> LetterboxdList:
    """Re-scrape a shared list, honouring the cache.

    Skips entirely when synced recently (unless ``force``). Otherwise probes the
    list's first page: if the Letterboxd "last updated" timestamp is unchanged,
    only the sync time is bumped and the full multi-page scrape is skipped.
    """
    letterboxd_list = lists_crud.get_list_by_id(session=session, list_id=list_id)
    if letterboxd_list is None:
        raise LetterboxdListNotFound()

    if not force and _is_fresh(letterboxd_list):
        raise LetterboxdListSyncTooSoon()

    previous_updated = letterboxd_list.last_updated_on_letterboxd
    current_updated = scrape_list_metadata(
        letterboxd_list.owner, letterboxd_list.list_slug
    )
    unchanged = (
        previous_updated is not None
        and current_updated is not None
        and current_updated == previous_updated
    )
    if unchanged:
        logger.info(
            "Letterboxd list %s/%s unchanged since %s; skipping full scrape.",
            letterboxd_list.owner,
            letterboxd_list.list_slug,
            previous_updated,
        )
        letterboxd_list.last_synced = now_amsterdam_naive()
        session.add(letterboxd_list)
    else:
        _scrape_and_store(session=session, letterboxd_list=letterboxd_list)

    session.commit()
    session.refresh(letterboxd_list)
    return letterboxd_list


def to_public(
    *, session: Session, letterboxd_list: LetterboxdList
) -> LetterboxdListPublic:
    return LetterboxdListPublic(
        id=letterboxd_list.id,
        owner=letterboxd_list.owner,
        list_slug=letterboxd_list.list_slug,
        title=letterboxd_list.title,
        url=list_url(letterboxd_list.owner, letterboxd_list.list_slug),
        is_curated=letterboxd_list.is_curated,
        last_updated_on_letterboxd=letterboxd_list.last_updated_on_letterboxd,
        last_synced=letterboxd_list.last_synced,
        film_count=lists_crud.get_list_film_count(
            session=session, list_id=letterboxd_list.id
        ),
    )


def list_available_lists(
    *, session: Session, user_id: UUID
) -> list[LetterboxdListPublic]:
    """Return the user's followed lists plus the curated set (de-duplicated)."""
    by_id: dict[UUID, LetterboxdList] = {}
    for letterboxd_list in lists_crud.get_user_lists(session=session, user_id=user_id):
        by_id[letterboxd_list.id] = letterboxd_list
    for letterboxd_list in lists_crud.get_curated_lists(session=session):
        by_id.setdefault(letterboxd_list.id, letterboxd_list)
    return [
        to_public(session=session, letterboxd_list=letterboxd_list)
        for letterboxd_list in by_id.values()
    ]


def remove_list_for_user(*, session: Session, user_id: UUID, list_id: UUID) -> None:
    lists_crud.remove_user_list_link(session=session, user_id=user_id, list_id=list_id)
    session.commit()


def seed_curated_lists(*, session: Session) -> int:
    """Ensure the curated lists from ``letterboxd_lists.yaml`` exist (no scrape).

    Each yaml entry's ``users[]`` maps to a real Letterboxd list
    (``username``/``slug``). Rows are created as ``is_curated`` placeholders;
    their films are populated lazily on the first sync. Returns the number of
    lists created.
    """
    if not _CURATED_LISTS_CONFIG.exists():
        logger.warning("Curated lists config not found at %s", _CURATED_LISTS_CONFIG)
        return 0

    with open(_CURATED_LISTS_CONFIG, encoding="utf-8") as fp:
        config = yaml.safe_load(fp) or {}

    created = 0
    for key, entry in config.items():
        if not isinstance(entry, dict) or not entry.get("enabled", False):
            continue
        for user_entry in entry.get("users", []):
            owner = user_entry.get("username")
            list_slug = user_entry.get("slug")
            if not owner or not list_slug:
                continue
            existing = lists_crud.get_list_by_owner_slug(
                session=session, owner=owner, list_slug=list_slug
            )
            if existing is not None:
                if not existing.is_curated:
                    existing.is_curated = True
                    session.add(existing)
                continue
            lists_crud.create_list(
                session=session,
                letterboxd_list=LetterboxdList(
                    owner=owner,
                    list_slug=list_slug,
                    title=entry.get("title"),
                    is_curated=True,
                ),
            )
            created += 1
            logger.info(
                "Seeded curated Letterboxd list %s (%s/%s)", key, owner, list_slug
            )

    session.commit()
    return created
