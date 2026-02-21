from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import (
    CurrentUser,
    SessionDep,
)
from app.converters import user as user_converters
from app.core.enums import FilterPresetScope
from app.core.security import get_password_hash, verify_password
from app.inputs.movie import Filters, get_filters
from app.models.auth_schemas import Message, UpdatePassword
from app.models.user import UserUpdate
from app.schemas.cinema_preset import CinemaPresetCreate, CinemaPresetPublic
from app.schemas.filter_preset import FilterPresetCreate, FilterPresetPublic
from app.schemas.push_token import PushTokenRegister
from app.schemas.showtime import ShowtimeLoggedIn
from app.schemas.showtime_ping import ShowtimePingPublic
from app.schemas.user import UserMe, UserWithFriendStatus
from app.services import me as me_service
from app.services import users as users_service
from app.services import watchlist as watchlist_service

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
def save_filter_preset(
    session: SessionDep,
    current_user: CurrentUser,
    payload: FilterPresetCreate,
) -> FilterPresetPublic:
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Preset name cannot be empty")
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
        raise HTTPException(status_code=404, detail="Filter preset not found")
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
        raise HTTPException(status_code=404, detail="Filter preset not found")
    return Message(message="Filter preset deleted successfully")


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
def save_cinema_preset(
    session: SessionDep,
    current_user: CurrentUser,
    payload: CinemaPresetCreate,
) -> CinemaPresetPublic:
    if not payload.name.strip():
        raise HTTPException(status_code=400, detail="Preset name cannot be empty")
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
        raise HTTPException(status_code=404, detail="Cinema preset not found")
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
        raise HTTPException(status_code=404, detail="Cinema preset not found")
    return Message(message="Cinema preset deleted successfully")


@router.delete("/", response_model=Message)
def delete_user_me(session: SessionDep, current_user: CurrentUser) -> Message:
    if current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="Super users are not allowed to delete themselves"
        )
    session.delete(current_user)
    session.commit()
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
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Incorrect password")
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=400, detail="New password cannot be the same as the current one"
        )
    hashed_password = get_password_hash(body.new_password)
    current_user.hashed_password = hashed_password
    session.add(current_user)
    session.commit()
    return Message(message="Password updated successfully")


@router.get("/showtimes", response_model=list[ShowtimeLoggedIn])
def get_my_showtimes(
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(20, ge=1, le=50),
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


@router.get("/pings", response_model=list[ShowtimePingPublic])
def get_my_showtime_pings(
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> list[ShowtimePingPublic]:
    return me_service.get_received_showtime_pings(
        session=session,
        user_id=current_user.id,
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
    return Message(message="Showtime pings marked as seen")


@router.put("/watchlist", response_model=Message)
def sync_watchlist(
    session: SessionDep,
    current_user: CurrentUser,
) -> Message:
    watchlist_service.sync_watchlist(session=session, user_id=current_user.id)
    return Message(message="Watchlist synced successfully")


@router.get("/friends", response_model=list[UserWithFriendStatus])
def get_friends(
    *, session: SessionDep, current_user: CurrentUser
) -> list[UserWithFriendStatus]:
    return users_service.get_friends(session=session, user_id=current_user.id)


@router.get("/requests/sent")
def get_sent_friend_requests(
    *,
    session: SessionDep,
    current_user: CurrentUser,
) -> list[UserWithFriendStatus]:
    return users_service.get_sent_friend_requests(
        session=session, user_id=current_user.id
    )


@router.get("/requests/received")
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
