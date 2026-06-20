from datetime import datetime, timedelta
from uuid import uuid4

import pytest
from pytest_mock import MockerFixture

from app.exceptions.letterboxd_list_exceptions import (
    InvalidLetterboxdListUrl,
    LetterboxdListNotFound,
    LetterboxdListSyncTooSoon,
)
from app.models.letterboxd_list import LetterboxdList
from app.scraping.letterboxd.lists import InvalidListUrl, ListRef, ScrapedList
from app.services import letterboxd_lists as service


def _ref(owner="official", list_slug="top-500", shortcode=None) -> ListRef:
    return ListRef(owner=owner, list_slug=list_slug, boxd_shortcode=shortcode)


def _scraped(owner="official", list_slug="top-500") -> ScrapedList:
    return ScrapedList(
        owner=owner,
        list_slug=list_slug,
        title="Top 500",
        last_updated=datetime(2026, 1, 1),
        slugs=["a", "b"],
    )


def test_add_list_scrapes_when_not_cached(mocker: MockerFixture):
    mocker.patch.object(service, "resolve_list_url", return_value=_ref())
    crud = mocker.patch.object(service, "lists_crud")
    crud.get_list_by_owner_slug.return_value = None
    created = LetterboxdList(owner="official", list_slug="top-500")
    crud.create_list.return_value = created
    crud.user_list_link_exists.return_value = False
    scrape = mocker.patch.object(service, "scrape_list", return_value=_scraped())
    mocker.patch.object(service, "movies_crud")
    session = mocker.MagicMock()

    result = service.add_list_for_user(
        session=session, user_id=uuid4(), raw_url="https://x/list/y/"
    )

    scrape.assert_called_once()
    crud.add_user_list_link.assert_called_once()
    assert result is created


def test_add_list_reuses_cache_for_second_user(mocker: MockerFixture):
    """A list already in the cache is linked without re-scraping."""
    mocker.patch.object(service, "resolve_list_url", return_value=_ref())
    crud = mocker.patch.object(service, "lists_crud")
    existing = LetterboxdList(owner="official", list_slug="top-500")
    crud.get_list_by_owner_slug.return_value = existing
    crud.user_list_link_exists.return_value = False
    scrape = mocker.patch.object(service, "scrape_list")
    session = mocker.MagicMock()

    result = service.add_list_for_user(
        session=session, user_id=uuid4(), raw_url="https://x/list/y/"
    )

    scrape.assert_not_called()
    crud.create_list.assert_not_called()
    crud.add_user_list_link.assert_called_once()
    assert result is existing


def test_add_list_does_not_duplicate_link(mocker: MockerFixture):
    mocker.patch.object(service, "resolve_list_url", return_value=_ref())
    crud = mocker.patch.object(service, "lists_crud")
    crud.get_list_by_owner_slug.return_value = LetterboxdList(
        owner="official", list_slug="top-500"
    )
    crud.user_list_link_exists.return_value = True
    mocker.patch.object(service, "scrape_list")
    session = mocker.MagicMock()

    service.add_list_for_user(
        session=session, user_id=uuid4(), raw_url="https://x/list/y/"
    )

    crud.add_user_list_link.assert_not_called()


def test_add_list_invalid_url_raises_app_error(mocker: MockerFixture):
    mocker.patch.object(
        service, "resolve_list_url", side_effect=InvalidListUrl("bad")
    )
    with pytest.raises(InvalidLetterboxdListUrl):
        service.add_list_for_user(
            session=mocker.MagicMock(), user_id=uuid4(), raw_url="nope"
        )


def test_sync_list_not_found_raises(mocker: MockerFixture):
    crud = mocker.patch.object(service, "lists_crud")
    crud.get_list_by_id.return_value = None
    with pytest.raises(LetterboxdListNotFound):
        service.sync_list(session=mocker.MagicMock(), list_id=uuid4())


def test_sync_list_too_soon_when_fresh(mocker: MockerFixture):
    crud = mocker.patch.object(service, "lists_crud")
    crud.get_list_by_id.return_value = LetterboxdList(
        owner="o", list_slug="s", last_synced=service.now_amsterdam_naive()
    )
    with pytest.raises(LetterboxdListSyncTooSoon):
        service.sync_list(session=mocker.MagicMock(), list_id=uuid4())


def test_sync_list_skips_full_scrape_when_unchanged(mocker: MockerFixture):
    updated = datetime(2026, 1, 1)
    stale = service.now_amsterdam_naive() - timedelta(days=1)
    cached = LetterboxdList(
        owner="o",
        list_slug="s",
        last_synced=stale,
        last_updated_on_letterboxd=updated,
    )
    crud = mocker.patch.object(service, "lists_crud")
    crud.get_list_by_id.return_value = cached
    mocker.patch.object(service, "scrape_list_metadata", return_value=updated)
    full_scrape = mocker.patch.object(service, "scrape_list")

    service.sync_list(session=mocker.MagicMock(), list_id=uuid4())

    full_scrape.assert_not_called()
    assert cached.last_synced > stale


def test_sync_list_rescrapes_when_changed(mocker: MockerFixture):
    stale = service.now_amsterdam_naive() - timedelta(days=1)
    cached = LetterboxdList(
        owner="o",
        list_slug="s",
        last_synced=stale,
        last_updated_on_letterboxd=datetime(2026, 1, 1),
    )
    crud = mocker.patch.object(service, "lists_crud")
    crud.get_list_by_id.return_value = cached
    mocker.patch.object(
        service, "scrape_list_metadata", return_value=datetime(2026, 2, 1)
    )
    mocker.patch.object(service, "movies_crud")
    full_scrape = mocker.patch.object(
        service, "scrape_list", return_value=_scraped("o", "s")
    )

    service.sync_list(session=mocker.MagicMock(), list_id=uuid4(), force=True)

    full_scrape.assert_called_once()
