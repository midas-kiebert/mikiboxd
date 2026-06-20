"""Current user endpoints.

All routes are scoped to the authenticated user — they operate on the user's
own data (profile, presets, cinemas, pings, friends, watchlist, push tokens).
"""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi import status as http_status

from app.api.deps import (
    CurrentUser,
    SessionDep,
)
from app.converters import user as user_converters
from app.core.enums import FilterPresetScope, ShowtimePingSort
from app.core.security import get_password_hash, verify_password
from app.inputs.movie import Filters, get_filters
from app.models.auth_schemas import Message, UpdatePassword
from app.models.user import UserUpdate
from app.schemas.cinema_preset import CinemaPresetCreate, CinemaPresetPublic
from app.schemas.filter_preset import FilterPresetCreate, FilterPresetPublic
from app.schemas.friend_group import FriendGroupCreate, FriendGroupPublic
from app.schemas.letterboxd_list import (
    LetterboxdListCreate,
    LetterboxdListPublic,
)
from app.schemas.notification import NotificationFeedItem
from app.schemas.push_token import PushTokenDelete, PushTokenRegister
from app.schemas.saved_preset import SavedPresetCreate, SavedPresetPublic
from app.schemas.showtime import ShowtimeLoggedIn
from app.schemas.showtime_ping import ShowtimePingPublic
from app.schemas.user import UserMe, UserWithFriendStatus
from app.services import letterboxd_lists as letterboxd_lists_service
from app.services import me as me_service
from app.services import users as users_service
from app.services import watched as watched_service
from app.services import watchlist as watchlist_service
from app.utils import now_amsterdam_naive

router = APIRouter(prefix="/me", tags=["me"])


@router.get("/", response_model=UserMe)
def get_current_user(current_user: CurrentUser) -> UserMe:
    return user_converters.to_me(current_user)


@router.get("/filter-presets", response_model=list[FilterPresetPublic])
def get_filter_presets(
    session: SessionDep,
    current_user: CurrentUser,
    scope: FilterPresetScope = Query(...),
) -> list[FilterPresetPublic]:
    return me_service.list_filter_presets(
        session=session,
        user_id=current_user.id,
        scope=scope,
    )


@router.post("/filter-presets", response_model=FilterPresetPublic)
def create_filter_preset(
    session: SessionDep,
    current_user: CurrentUser,
    payload: FilterPresetCreate,
) -> FilterPresetPublic:
    if not payload.name.strip():
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Preset name cannot be empty",
        )
    return me_service.save_filter_preset(
        session=session,
        user_id=current_user.id,
        payload=payload,
    )


@router.get("/filter-presets/favorite", response_model=FilterPresetPublic | None)
def get_favorite_filter_preset(
    session: SessionDep,
    current_user: CurrentUser,
    scope: FilterPresetScope = Query(...),
) -> FilterPresetPublic | None:
    return me_service.get_favorite_filter_preset(
        session=session,
        user_id=current_user.id,
        scope=scope,
    )


@router.put("/filter-presets/{preset_id}/favorite", response_model=FilterPresetPublic)
def set_favorite_filter_preset(
    session: SessionDep,
    current_user: CurrentUser,
    preset_id: UUID,
) -> FilterPresetPublic:
    favorite = me_service.set_favorite_filter_preset(
        session=session,
        user_id=current_user.id,
        preset_id=preset_id,
    )
    if favorite is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Filter preset not found",
        )
    return favorite


@router.delete("/filter-presets/favorite", response_model=Message)
def clear_favorite_filter_preset(
    session: SessionDep,
    current_user: CurrentUser,
    scope: FilterPresetScope = Query(...),
) -> Message:
    me_service.clear_favorite_filter_preset(
        session=session,
        user_id=current_user.id,
        scope=scope,
    )
    return Message(message="Favorite filter preset cleared successfully")


@router.delete("/filter-presets/{preset_id}", response_model=Message)
def delete_filter_preset(
    session: SessionDep,
    current_user: CurrentUser,
    preset_id: UUID,
) -> Message:
    deleted = me_service.delete_filter_preset(
        session=session,
        user_id=current_user.id,
        preset_id=preset_id,
    )
    if not deleted:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Filter preset not found",
        )
    return Message(message="Filter preset deleted successfully")


@router.get("/saved-presets", response_model=list[SavedPresetPublic])
def get_saved_presets(
    session: SessionDep,
    current_user: CurrentUser,
    scope: FilterPresetScope = Query(...),
) -> list[SavedPresetPublic]:
    return me_service.list_saved_presets(
        session=session,
        user_id=current_user.id,
        scope=scope,
    )


@router.post("/saved-presets", response_model=SavedPresetPublic)
def create_saved_preset(
    session: SessionDep,
    current_user: CurrentUser,
    payload: SavedPresetCreate,
) -> SavedPresetPublic:
    if not payload.name.strip():
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Preset name cannot be empty",
        )
    return me_service.save_saved_preset(
        session=session,
        user_id=current_user.id,
        payload=payload,
    )


@router.get("/saved-presets/favorite", response_model=SavedPresetPublic | None)
def get_favorite_saved_preset(
    session: SessionDep,
    current_user: CurrentUser,
    scope: FilterPresetScope = Query(...),
) -> SavedPresetPublic | None:
    return me_service.get_favorite_saved_preset(
        session=session,
        user_id=current_user.id,
        scope=scope,
    )


@router.put("/saved-presets/{preset_id}/favorite", response_model=SavedPresetPublic)
def set_favorite_saved_preset(
    session: SessionDep,
    current_user: CurrentUser,
    preset_id: UUID,
) -> SavedPresetPublic:
    favorite = me_service.set_favorite_saved_preset(
        session=session,
        user_id=current_user.id,
        preset_id=preset_id,
    )
    if favorite is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Saved preset not found",
        )
    return favorite


@router.delete("/saved-presets/favorite", response_model=Message)
def clear_favorite_saved_preset(
    session: SessionDep,
    current_user: CurrentUser,
    scope: FilterPresetScope = Query(...),
) -> Message:
    me_service.clear_favorite_saved_preset(
        session=session,
        user_id=current_user.id,
        scope=scope,
    )
    return Message(message="Favorite saved preset cleared successfully")


@router.delete("/saved-presets/{preset_id}", response_model=Message)
def delete_saved_preset(
    session: SessionDep,
    current_user: CurrentUser,
    preset_id: UUID,
) -> Message:
    deleted = me_service.delete_saved_preset(
        session=session,
        user_id=current_user.id,
        preset_id=preset_id,
    )
    if not deleted:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Saved preset not found",
        )
    return Message(message="Saved preset deleted successfully")


@router.get("/cinema-presets", response_model=list[CinemaPresetPublic])
def get_cinema_presets(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[CinemaPresetPublic]:
    return me_service.list_cinema_presets(
        session=session,
        user_id=current_user.id,
    )


@router.get("/cinema-presets/favorite", response_model=CinemaPresetPublic | None)
def get_favorite_cinema_preset(
    session: SessionDep,
    current_user: CurrentUser,
) -> CinemaPresetPublic | None:
    return me_service.get_favorite_cinema_preset(
        session=session,
        user_id=current_user.id,
    )


@router.post("/cinema-presets", response_model=CinemaPresetPublic)
def create_cinema_preset(
    session: SessionDep,
    current_user: CurrentUser,
    payload: CinemaPresetCreate,
) -> CinemaPresetPublic:
    if not payload.name.strip():
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Preset name cannot be empty",
        )
    return me_service.save_cinema_preset(
        session=session,
        user_id=current_user.id,
        payload=payload,
    )


@router.put("/cinema-presets/{preset_id}/favorite", response_model=CinemaPresetPublic)
def set_favorite_cinema_preset(
    session: SessionDep,
    current_user: CurrentUser,
    preset_id: UUID,
) -> CinemaPresetPublic:
    favorite = me_service.set_favorite_cinema_preset(
        session=session,
        user_id=current_user.id,
        preset_id=preset_id,
    )
    if favorite is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Cinema preset not found",
        )
    return favorite


@router.delete("/cinema-presets/favorite", response_model=Message)
def clear_favorite_cinema_preset(
    session: SessionDep,
    current_user: CurrentUser,
) -> Message:
    me_service.clear_favorite_cinema_preset(
        session=session,
        user_id=current_user.id,
    )
    return Message(message="Favorite cinema preset cleared successfully")


@router.delete("/cinema-presets/{preset_id}", response_model=Message)
def delete_cinema_preset(
    session: SessionDep,
    current_user: CurrentUser,
    preset_id: UUID,
) -> Message:
    deleted = me_service.delete_cinema_preset(
        session=session,
        user_id=current_user.id,
        preset_id=preset_id,
    )
    if not deleted:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Cinema preset not found",
        )
    return Message(message="Cinema preset deleted successfully")


@router.get("/friend-groups", response_model=list[FriendGroupPublic])
def get_friend_groups(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[FriendGroupPublic]:
    return me_service.list_friend_groups(
        session=session,
        user_id=current_user.id,
    )


@router.get("/friend-groups/favorite", response_model=FriendGroupPublic | None)
def get_favorite_friend_group(
    session: SessionDep,
    current_user: CurrentUser,
) -> FriendGroupPublic | None:
    return me_service.get_favorite_friend_group(
        session=session,
        user_id=current_user.id,
    )


@router.post("/friend-groups", response_model=FriendGroupPublic)
def create_friend_group(
    session: SessionDep,
    current_user: CurrentUser,
    payload: FriendGroupCreate,
) -> FriendGroupPublic:
    if not payload.name.strip():
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Group name cannot be empty",
        )
    try:
        return me_service.save_friend_group(
            session=session,
            user_id=current_user.id,
            payload=payload,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        ) from e


@router.put("/friend-groups/{group_id}/favorite", response_model=FriendGroupPublic)
def set_favorite_friend_group(
    session: SessionDep,
    current_user: CurrentUser,
    group_id: UUID,
) -> FriendGroupPublic:
    favorite = me_service.set_favorite_friend_group(
        session=session,
        user_id=current_user.id,
        group_id=group_id,
    )
    if favorite is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Friend group not found",
        )
    return favorite


@router.delete("/friend-groups/favorite", response_model=Message)
def clear_favorite_friend_group(
    session: SessionDep,
    current_user: CurrentUser,
) -> Message:
    me_service.clear_favorite_friend_group(
        session=session,
        user_id=current_user.id,
    )
    return Message(message="Default visibility friend group cleared successfully")


@router.delete("/friend-groups/{group_id}", response_model=Message)
def delete_friend_group(
    session: SessionDep,
    current_user: CurrentUser,
    group_id: UUID,
) -> Message:
    deleted = me_service.delete_friend_group(
        session=session,
        user_id=current_user.id,
        group_id=group_id,
    )
    if not deleted:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Friend group not found",
        )
    return Message(message="Friend group deleted successfully")


@router.delete("/", response_model=Message)
def delete_user_me(session: SessionDep, current_user: CurrentUser) -> Message:
    """Delete the authenticated user's own account. Superusers cannot delete themselves."""
    if current_user.is_superuser:
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="Super users are not allowed to delete themselves",
        )
    me_service.delete_me(
        session=session,
        current_user=current_user,
    )
    return Message(message="User deleted successfully")


@router.patch("/", response_model=UserMe)
def update_user_me(
    *, session: SessionDep, user_in: UserUpdate, current_user: CurrentUser
) -> UserMe:
    return me_service.update_me(
        session=session, user_in=user_in, current_user=current_user
    )


@router.patch("/password", response_model=Message)
def update_password_me(
    *, session: SessionDep, body: UpdatePassword, current_user: CurrentUser
) -> Message:
    """Change the authenticated user's password. Requires the current password to be provided."""
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="Incorrect password",
        )
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST,
            detail="New password cannot be the same as the current one",
        )
    current_user.hashed_password = get_password_hash(body.new_password)
    session.add(current_user)
    session.commit()
    return Message(message="Password updated successfully")


@router.get("/showtimes/count")
def count_my_showtimes(
    session: SessionDep,
    current_user: CurrentUser,
    filters: Filters = Depends(get_filters),
) -> int:
    return users_service.count_selected_showtimes(
        session=session,
        current_user_id=current_user.id,
        filters=filters,
    )


@router.get("/showtimes", response_model=list[ShowtimeLoggedIn])
def get_my_showtimes(
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(10, ge=1, le=50),
    offset: int = Query(0, ge=0),
    filters: Filters = Depends(get_filters),
) -> list[ShowtimeLoggedIn]:
    return users_service.get_selected_showtimes(
        session=session,
        user_id=current_user.id,
        current_user_id=current_user.id,
        limit=limit,
        offset=offset,
        filters=filters,
    )


@router.get("/agenda", response_model=list[ShowtimeLoggedIn])
def get_my_agenda(
    session: SessionDep,
    current_user: CurrentUser,
    include_interested: bool = Query(True),
    include_invited: bool = Query(True),
    snapshot_time: datetime | None = Query(
        None, description="Only show showtimes after this moment"
    ),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[ShowtimeLoggedIn]:
    if snapshot_time is None:
        snapshot_time = now_amsterdam_naive()
    return me_service.get_agenda_showtimes(
        session=session,
        user_id=current_user.id,
        snapshot_time=snapshot_time,
        include_interested=include_interested,
        include_invited=include_invited,
        limit=limit,
        offset=offset,
    )


@router.get("/pings", response_model=list[ShowtimePingPublic])
def get_my_showtime_pings(
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort_by: ShowtimePingSort = Query(ShowtimePingSort.PING_CREATED_AT),
) -> list[ShowtimePingPublic]:
    return me_service.get_received_showtime_pings(
        session=session,
        user_id=current_user.id,
        sort_by=sort_by,
        limit=limit,
        offset=offset,
    )


@router.get("/pings/unseen-count", response_model=int)
def get_my_unseen_showtime_ping_count(
    session: SessionDep,
    current_user: CurrentUser,
) -> int:
    return me_service.get_unseen_showtime_ping_count(
        session=session,
        user_id=current_user.id,
    )


@router.post("/pings/mark-seen", response_model=Message)
def mark_my_showtime_pings_seen(
    session: SessionDep,
    current_user: CurrentUser,
) -> Message:
    me_service.mark_showtime_pings_seen(
        session=session,
        user_id=current_user.id,
    )
    return Message(message="Showtime invites marked as seen")


@router.delete("/pings/{ping_id}", response_model=Message)
def delete_my_showtime_ping(
    session: SessionDep,
    current_user: CurrentUser,
    ping_id: int,
) -> Message:
    deleted = me_service.delete_received_showtime_ping(
        session=session,
        user_id=current_user.id,
        ping_id=ping_id,
    )
    if not deleted:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Showtime invite not found",
        )
    return Message(message="Showtime invite deleted successfully")


@router.post("/pings/{ping_id}/dismiss", response_model=Message)
def dismiss_my_showtime_ping(
    session: SessionDep,
    current_user: CurrentUser,
    ping_id: int,
) -> Message:
    dismissed = me_service.dismiss_received_showtime_ping(
        session=session,
        user_id=current_user.id,
        ping_id=ping_id,
    )
    if not dismissed:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Showtime invite not found",
        )
    return Message(message="Showtime invite dismissed")


@router.get("/notifications", response_model=list[NotificationFeedItem])
def get_my_notifications(
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[NotificationFeedItem]:
    return me_service.get_notification_feed(
        session=session,
        user_id=current_user.id,
        limit=limit,
        offset=offset,
    )


@router.get("/notifications/unseen-count", response_model=int)
def get_my_unseen_notification_count(
    session: SessionDep,
    current_user: CurrentUser,
) -> int:
    return me_service.get_notifications_unseen_count(
        session=session,
        user_id=current_user.id,
    )


@router.post("/notifications/mark-seen", response_model=Message)
def mark_my_notifications_seen(
    session: SessionDep,
    current_user: CurrentUser,
) -> Message:
    me_service.mark_notifications_seen(
        session=session,
        user_id=current_user.id,
    )
    return Message(message="Notifications marked as seen")


@router.delete("/notifications/{notification_id}", response_model=Message)
def dismiss_my_notification(
    session: SessionDep,
    current_user: CurrentUser,
    notification_id: int,
) -> Message:
    dismissed = me_service.dismiss_notification(
        session=session,
        user_id=current_user.id,
        notification_id=notification_id,
    )
    if not dismissed:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )
    return Message(message="Notification dismissed")


@router.put("/watchlist", response_model=Message)
def sync_watchlist(
    session: SessionDep,
    current_user: CurrentUser,
) -> Message:
    watchlist_service.sync_watchlist(session=session, user_id=current_user.id)
    return Message(message="Watchlist synced successfully")


@router.put("/watched", response_model=Message)
def sync_watched(
    session: SessionDep,
    current_user: CurrentUser,
) -> Message:
    watched_service.sync_watched(session=session, user_id=current_user.id)
    return Message(message="Watched list synced successfully")


@router.get("/letterboxd-lists", response_model=list[LetterboxdListPublic])
def get_letterboxd_lists(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[LetterboxdListPublic]:
    return letterboxd_lists_service.list_available_lists(
        session=session, user_id=current_user.id
    )


@router.post("/letterboxd-lists", response_model=LetterboxdListPublic)
def add_letterboxd_list(
    body: LetterboxdListCreate,
    session: SessionDep,
    current_user: CurrentUser,
) -> LetterboxdListPublic:
    letterboxd_list = letterboxd_lists_service.add_list_for_user(
        session=session, user_id=current_user.id, raw_url=body.url
    )
    return letterboxd_lists_service.to_public(
        session=session, letterboxd_list=letterboxd_list
    )


@router.put("/letterboxd-lists/{list_id}/sync", response_model=LetterboxdListPublic)
def sync_letterboxd_list(list_id: UUID, session: SessionDep) -> LetterboxdListPublic:
    letterboxd_list = letterboxd_lists_service.sync_list(
        session=session, list_id=list_id
    )
    return letterboxd_lists_service.to_public(
        session=session, letterboxd_list=letterboxd_list
    )


@router.delete("/letterboxd-lists/{list_id}", response_model=Message)
def remove_letterboxd_list(
    list_id: UUID,
    session: SessionDep,
    current_user: CurrentUser,
) -> Message:
    letterboxd_lists_service.remove_list_for_user(
        session=session, user_id=current_user.id, list_id=list_id
    )
    return Message(message="List removed successfully")


@router.get("/friends", response_model=list[UserWithFriendStatus])
def get_friends(
    *, session: SessionDep, current_user: CurrentUser
) -> list[UserWithFriendStatus]:
    return users_service.get_friends(session=session, user_id=current_user.id)


@router.get("/requests/sent", response_model=list[UserWithFriendStatus])
def get_sent_friend_requests(
    *,
    session: SessionDep,
    current_user: CurrentUser,
) -> list[UserWithFriendStatus]:
    return users_service.get_sent_friend_requests(
        session=session, user_id=current_user.id
    )


@router.get("/requests/received", response_model=list[UserWithFriendStatus])
def get_received_friend_requests(
    *,
    session: SessionDep,
    current_user: CurrentUser,
) -> list[UserWithFriendStatus]:
    return users_service.get_received_friend_requests(
        session=session, user_id=current_user.id
    )


@router.get("/cinemas", response_model=list[int])
def get_cinema_selections(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[int]:
    return me_service.get_favorite_cinema_ids(session=session, user_id=current_user.id)


@router.post("/cinemas", response_model=Message)
def set_cinema_selections(
    session: SessionDep,
    current_user: CurrentUser,
    cinema_ids: list[int],
) -> Message:
    me_service.set_favorite_cinema_ids(
        session=session, user_id=current_user.id, cinema_ids=cinema_ids
    )
    return Message(message="Cinemas updated successfully")


@router.post("/push-tokens", response_model=Message)
def register_push_token(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    payload: PushTokenRegister,
) -> Message:
    me_service.register_push_token(
        session=session,
        user_id=current_user.id,
        token=payload.token,
        platform=payload.platform,
    )
    return Message(message="Push token registered successfully")


@router.delete("/push-tokens", response_model=Message)
def delete_push_token(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    payload: PushTokenDelete,
) -> Message:
    me_service.delete_push_token_for_user(
        session=session,
        user_id=current_user.id,
        token=payload.token,
    )
    return Message(message="Push token deleted successfully")
