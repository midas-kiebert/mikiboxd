from datetime import timedelta

from sqlmodel import select

from app.models.friend_group import FriendGroup
from app.models.letterboxd import Letterboxd
from app.models.showtime import Showtime
from app.models.showtime_ping import ShowtimePing
from app.models.showtime_selection import ShowtimeSelection
from app.models.showtime_source_presence import ShowtimeSourcePresence
from app.models.showtime_visibility import (
    ShowtimeVisibilityEffective,
    ShowtimeVisibilityFriend,
    ShowtimeVisibilityGroup,
    ShowtimeVisibilitySetting,
)
from app.models.watchlist_selection import WatchlistSelection
from app.services import scrape_sync as scrape_sync_service
from app.utils import now_amsterdam_naive


def test_delete_old_showtimes_removes_related_rows(
    *,
    db_transaction,
    cinema_factory,
    movie_factory,
    showtime_factory,
    user_factory,
) -> None:
    base_time = now_amsterdam_naive()
    cinema = cinema_factory()
    movie = movie_factory()
    old_showtime = showtime_factory(
        cinema=cinema,
        movie=movie,
        datetime=base_time - timedelta(days=2),
    )
    keep_showtime = showtime_factory(
        cinema=cinema,
        movie=movie,
        datetime=base_time + timedelta(days=1),
    )
    owner = user_factory()
    viewer = user_factory()

    friend_group = FriendGroup(
        owner_user_id=owner.id,
        name="Cleanup Test Group",
    )
    db_transaction.add(friend_group)
    db_transaction.flush()

    db_transaction.add(
        ShowtimeSourcePresence(
            source_stream="cinema_scraper:test",
            source_event_key="old-showtime",
            showtime_id=old_showtime.id,
            last_seen_at=base_time,
            missing_streak=0,
            active=True,
        )
    )
    db_transaction.add(
        ShowtimeSourcePresence(
            source_stream="cinema_scraper:test",
            source_event_key="keep-showtime",
            showtime_id=keep_showtime.id,
            last_seen_at=base_time,
            missing_streak=0,
            active=True,
        )
    )
    db_transaction.add(
        ShowtimeSelection(user_id=owner.id, showtime_id=old_showtime.id),
    )
    db_transaction.add(
        ShowtimePing(
            showtime_id=old_showtime.id,
            sender_id=owner.id,
            receiver_id=viewer.id,
        )
    )
    db_transaction.add(
        ShowtimeVisibilitySetting(
            owner_id=owner.id,
            showtime_id=old_showtime.id,
            is_all_friends=False,
        )
    )
    db_transaction.add(
        ShowtimeVisibilityFriend(
            owner_id=owner.id,
            showtime_id=old_showtime.id,
            viewer_id=viewer.id,
        )
    )
    db_transaction.add(
        ShowtimeVisibilityGroup(
            owner_id=owner.id,
            showtime_id=old_showtime.id,
            group_id=friend_group.id,
        )
    )
    db_transaction.add(
        ShowtimeVisibilityEffective(
            owner_id=owner.id,
            showtime_id=old_showtime.id,
            viewer_id=viewer.id,
        )
    )
    db_transaction.flush()

    deleted = scrape_sync_service.delete_old_showtimes(session=db_transaction)
    assert [item.showtime_id for item in deleted] == [old_showtime.id]
    db_transaction.commit()

    assert (
        db_transaction.exec(
            select(Showtime).where(Showtime.id == old_showtime.id)
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(Showtime).where(Showtime.id == keep_showtime.id)
        ).one_or_none()
        is not None
    )
    assert (
        db_transaction.exec(
            select(ShowtimeSourcePresence).where(
                ShowtimeSourcePresence.showtime_id == old_showtime.id
            )
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(ShowtimeSelection).where(
                ShowtimeSelection.showtime_id == old_showtime.id
            )
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(ShowtimePing).where(ShowtimePing.showtime_id == old_showtime.id)
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(ShowtimeVisibilitySetting).where(
                ShowtimeVisibilitySetting.showtime_id == old_showtime.id
            )
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(ShowtimeVisibilityFriend).where(
                ShowtimeVisibilityFriend.showtime_id == old_showtime.id
            )
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(ShowtimeVisibilityGroup).where(
                ShowtimeVisibilityGroup.showtime_id == old_showtime.id
            )
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(ShowtimeVisibilityEffective).where(
                ShowtimeVisibilityEffective.showtime_id == old_showtime.id
            )
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(ShowtimeSourcePresence).where(
                ShowtimeSourcePresence.showtime_id == keep_showtime.id
            )
        ).one_or_none()
        is not None
    )


def test_delete_old_showtimes_obeys_cutoff_days(
    *,
    db_transaction,
    cinema_factory,
    movie_factory,
    showtime_factory,
) -> None:
    base_time = now_amsterdam_naive()
    cinema = cinema_factory()
    movie = movie_factory()
    keep_showtime = showtime_factory(
        cinema=cinema,
        movie=movie,
        datetime=base_time - timedelta(hours=23),
    )
    delete_showtime = showtime_factory(
        cinema=cinema,
        movie=movie,
        datetime=base_time - timedelta(days=2),
    )

    deleted = scrape_sync_service.delete_old_showtimes(
        session=db_transaction,
        cutoff_days=1,
    )
    deleted_ids = {item.showtime_id for item in deleted}
    assert delete_showtime.id in deleted_ids
    assert keep_showtime.id not in deleted_ids
    db_transaction.commit()

    assert (
        db_transaction.exec(
            select(Showtime).where(Showtime.id == keep_showtime.id)
        ).one_or_none()
        is not None
    )
    assert (
        db_transaction.exec(
            select(Showtime).where(Showtime.id == delete_showtime.id)
        ).one_or_none()
        is None
    )


def test_cleanup_letterboxd_data_removes_orphans_and_clears_stale_syncs(
    *,
    db_transaction,
    movie_factory,
    user_factory,
) -> None:
    base_time = now_amsterdam_naive()

    active_user = user_factory()
    assert active_user.letterboxd_username is not None
    active_letterboxd = db_transaction.get(Letterboxd, active_user.letterboxd_username)
    assert active_letterboxd is not None
    active_letterboxd.last_watchlist_sync = base_time - timedelta(days=3)

    orphaned_username = "orphan-removed"
    watchlist_username = "watchlist-retained"

    db_transaction.add(
        Letterboxd(
            letterboxd_username=orphaned_username,
            last_watchlist_sync=base_time - timedelta(days=3),
        )
    )
    db_transaction.add(
        Letterboxd(
            letterboxd_username=watchlist_username,
            last_watchlist_sync=base_time - timedelta(days=3),
        )
    )
    movie = movie_factory()
    db_transaction.add(
        WatchlistSelection(letterboxd_username=watchlist_username, movie_id=movie.id)
    )

    db_transaction.flush()

    cleanup_result = scrape_sync_service.cleanup_letterboxd_data(session=db_transaction)
    db_transaction.commit()

    assert cleanup_result.orphaned_rows_deleted == 1
    assert cleanup_result.stale_sync_timestamps_cleared == 3

    assert (
        db_transaction.exec(
            select(Letterboxd).where(
                Letterboxd.letterboxd_username == orphaned_username
            )
        ).one_or_none()
        is None
    )
    assert (
        db_transaction.exec(
            select(Letterboxd).where(
                Letterboxd.letterboxd_username == watchlist_username
            )
        ).one_or_none()
        is not None
    )
    assert (
        db_transaction.exec(
            select(WatchlistSelection).where(
                WatchlistSelection.letterboxd_username == watchlist_username
            )
        ).one_or_none()
        is not None
    )

    updated_watchlist_row = db_transaction.get(Letterboxd, watchlist_username)
    updated_active_row = db_transaction.get(Letterboxd, active_user.letterboxd_username)
    assert updated_watchlist_row is not None
    assert updated_active_row is not None
    assert updated_watchlist_row.last_watchlist_sync is None
    assert updated_active_row.last_watchlist_sync is None
