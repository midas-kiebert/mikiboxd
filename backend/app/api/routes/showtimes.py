"""Showtime endpoints."""

import asyncio
import logging
import os
import threading
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi import status as http_status
from fastapi.responses import HTMLResponse

from app.api.deps import (
    OPTIONAL_AUTH_OPENAPI_EXTRA,
    CurrentUser,
    CurrentViewer,
    SessionDep,
    get_db_context,
)
from app.core.config import settings
from app.core.enums import GoingStatus
from app.crud import showtime_ping as showtime_ping_crud
from app.crud import showtime_report as showtime_report_crud
from app.inputs.movie import Filters, get_filters
from app.mailer import (
    REPORT_NOTIFICATION_EMAIL,
    EmailDeliveryError,
    generate_showtime_report_email,
    send_email,
)
from app.models.auth_schemas import Message
from app.models.showtime import Showtime
from app.models.user import is_report_banned
from app.schemas.seat_availability import (
    ShowtimeSeatAvailabilityPublic,
    SoldOutWatchPublic,
)
from app.schemas.showtime import ShowtimePublic, ShowtimeSelectionUpdate
from app.schemas.showtime_ping import SentShowtimePingPublic, ShowtimePingLinkToken
from app.schemas.showtime_report import ShowtimeReportCreate
from app.schemas.showtime_visibility import (
    ShowtimeVisibilityPublic,
    ShowtimeVisibilityUpdate,
    UninvitedSelectedFriendsPublic,
)
from app.services import push_notifications
from app.services import seat_availability as seat_availability_service
from app.services import showtimes as showtimes_service
from app.services import sold_out_watch as sold_out_watch_service
from app.services.share_preview import (
    DEFAULT_SHARE_PREVIEW_IMAGE,
    render_share_preview_html,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/showtimes", tags=["showtimes"])

# Ping IDs added here before deletion suppress the pending notification.
# In-memory so the background task never needs a second DB round-trip,
# which also keeps test transaction isolation intact.
_cancelled_ping_ids: set[int] = set()
_cancelled_ping_ids_lock = threading.Lock()


_PING_NOTIFICATION_DELAY_SECONDS = 0 if os.getenv("TESTING") == "true" else 5  # noqa: SIM210

# Upper bound for one visibility prefetch request; clients chunk larger lists.
_MAX_VISIBILITY_BATCH_SIZE = 200


def _check_seat_availability_now(showtime_id: int) -> None:
    with get_db_context() as session:
        seat_availability_service.check_now(session=session, showtime_id=showtime_id)


@router.put("/selection/{showtime_id}", response_model=ShowtimePublic)
def update_showtime_selection(
    *,
    session: SessionDep,
    background_tasks: BackgroundTasks,
    showtime_id: int,
    payload: ShowtimeSelectionUpdate,
    current_user: CurrentUser,
) -> ShowtimePublic:
    should_update_seat = (
        "seat_row" in payload.model_fields_set
        or "seat_number" in payload.model_fields_set
    )
    # Read before the service call queues the poller read: a never-checked
    # showtime is worth an immediate, best-effort read so whoever just selected
    # it is not left staring at "checking..." until the poller's next tick. Only
    # ever once per showtime — after that there is a number to show, and the
    # queued read the service call makes is enough.
    never_checked = payload.going_status != GoingStatus.NOT_GOING and (
        seat_availability_service.should_check_immediately(
            session=session, showtime_id=showtime_id
        )
    )
    try:
        result = showtimes_service.update_showtime_selection(
            session=session,
            showtime_id=showtime_id,
            user_id=current_user.id,
            going_status=payload.going_status,
            seat_row=payload.seat_row,
            seat_number=payload.seat_number,
            visibility_mode=payload.visibility_mode,
            update_seat=should_update_seat,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail=str(error)
        )
    if never_checked:
        background_tasks.add_task(_check_seat_availability_now, showtime_id)
    return result


async def _notify_after_delay(
    ping_id: int,
    sender_id: UUID,
    receiver_id: UUID,
    showtime_id: int,
) -> None:
    """Send the invite push notification after a short grace window.

    Uninviting within that window adds the ping ID to _cancelled_ping_ids
    which this task checks before sending — no second DB round-trip needed.
    """
    await asyncio.sleep(_PING_NOTIFICATION_DELAY_SECONDS)
    with _cancelled_ping_ids_lock:
        if ping_id in _cancelled_ping_ids:
            _cancelled_ping_ids.discard(ping_id)
            return
    with get_db_context() as session:
        push_notifications.notify_user_on_showtime_ping(
            session=session,
            sender_id=sender_id,
            receiver_id=receiver_id,
            showtime_id=showtime_id,
        )


@router.post("/{showtime_id}/ping/{friend_id}", response_model=Message)
def ping_friend_for_showtime(
    *,
    session: SessionDep,
    background_tasks: BackgroundTasks,
    showtime_id: int,
    friend_id: UUID,
    current_user: CurrentUser,
) -> Message:
    message, ping_id, should_notify = showtimes_service.ping_friend_for_showtime(
        session=session,
        showtime_id=showtime_id,
        actor_id=current_user.id,
        friend_id=friend_id,
    )
    if should_notify:
        background_tasks.add_task(
            _notify_after_delay,
            ping_id=ping_id,
            sender_id=current_user.id,
            receiver_id=friend_id,
            showtime_id=showtime_id,
        )
    return message


@router.post("/{showtime_id}/ping-link-token", response_model=ShowtimePingLinkToken)
def create_showtime_ping_link_token(
    *,
    session: SessionDep,
    showtime_id: int,
    current_user: CurrentUser,
) -> ShowtimePingLinkToken:
    """Mint the signed token embedded in this showtime's shared invite link.

    Called when the current user taps "Share" — the resulting token proves,
    to whoever opens the link, that this user (and no one else) generated it.
    """
    return showtimes_service.create_showtime_ping_link_token(
        session=session,
        showtime_id=showtime_id,
        sender_id=current_user.id,
    )


@router.post("/{showtime_id}/ping-link/{token}", response_model=Message)
def receive_ping_from_link(
    *,
    session: SessionDep,
    showtime_id: int,
    token: str,
    current_user: CurrentUser,
) -> Message:
    return showtimes_service.receive_ping_from_link(
        session=session,
        showtime_id=showtime_id,
        receiver_id=current_user.id,
        token=token,
    )


@router.get(
    "/{showtime_id}/share-preview/{sender_identifier}",
    response_class=HTMLResponse,
    include_in_schema=False,
)
def get_showtime_share_preview(
    *,
    session: SessionDep,
    showtime_id: int,
    sender_identifier: str,
) -> HTMLResponse:
    """Unauthenticated HTML page carrying per-showtime OpenGraph tags.

    Only ever hit by link-preview crawlers (WhatsApp, iMessage, Slack, ...) —
    nginx routes them here based on User-Agent instead of the SPA's static
    index.html, which can't vary per showtime. Real visitors never see this
    page; nginx sends them straight to the SPA.
    """
    showtime = session.get(Showtime, showtime_id)
    if showtime is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Showtime not found"
        )

    body = render_share_preview_html(
        title=showtime.movie.title,
        # Time first, cinema second: WhatsApp truncates the description to
        # roughly one line, so the part that must survive the cut goes first.
        description=(
            f"{showtime.datetime.strftime('%-d %b, %H:%M')} · {showtime.cinema.name}"
        ),
        image_url=showtime.movie.poster_link or DEFAULT_SHARE_PREVIEW_IMAGE,
        page_url=f"{settings.FRONTEND_HOST}/ping/{showtime_id}/{sender_identifier}",
    )
    return HTMLResponse(content=body)


def _send_report_notification_email(
    *,
    movie_title: str,
    cinema_name: str,
    showtime_datetime_label: str,
    reason_label: str,
    message: str | None,
    reporter_email: str,
) -> None:
    if not settings.emails_enabled:
        logger.info("Email notifications are disabled; skipping showtime report email")
        return
    email_data = generate_showtime_report_email(
        movie_title=movie_title,
        cinema_name=cinema_name,
        showtime_datetime_label=showtime_datetime_label,
        reason_label=reason_label,
        message=message,
        reporter_email=reporter_email,
    )
    try:
        send_email(
            email_to=REPORT_NOTIFICATION_EMAIL,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
    except (AssertionError, EmailDeliveryError, Exception):
        logger.exception("Failed sending showtime report notification email")


@router.post("/{showtime_id}/report", response_model=Message)
def report_showtime(
    *,
    session: SessionDep,
    background_tasks: BackgroundTasks,
    showtime_id: int,
    current_user: CurrentUser,
    payload: ShowtimeReportCreate,
) -> Message:
    if is_report_banned(current_user):
        raise HTTPException(
            status_code=http_status.HTTP_403_FORBIDDEN,
            detail="You are temporarily blocked from reporting showtimes",
        )
    showtime = session.get(Showtime, showtime_id)
    if showtime is None:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Showtime not found"
        )
    showtime_report_crud.create_report(
        session=session,
        showtime_id=showtime_id,
        reporter_id=current_user.id,
        reason=payload.reason,
        message=payload.message,
    )
    session.commit()
    background_tasks.add_task(
        _send_report_notification_email,
        movie_title=showtime.movie.title,
        cinema_name=showtime.cinema.name,
        showtime_datetime_label=showtime.datetime.strftime("%a, %b %d at %H:%M"),
        reason_label=payload.reason.value.replace("_", " "),
        message=payload.message,
        reporter_email=current_user.email,
    )
    return Message(message="Report submitted successfully")


@router.get("/{showtime_id}/pinged-friends", response_model=list[UUID])
def get_pinged_friend_ids_for_showtime(
    *,
    session: SessionDep,
    showtime_id: int,
    current_user: CurrentUser,
) -> list[UUID]:
    return showtimes_service.get_pinged_friend_ids_for_showtime(
        session=session,
        showtime_id=showtime_id,
        actor_id=current_user.id,
    )


@router.get("/{showtime_id}/sent-pings", response_model=list[SentShowtimePingPublic])
def get_sent_pings_for_showtime(
    *,
    session: SessionDep,
    showtime_id: int,
    current_user: CurrentUser,
) -> list[SentShowtimePingPublic]:
    return showtimes_service.get_sent_pings_for_showtime(
        session=session,
        showtime_id=showtime_id,
        actor_id=current_user.id,
    )


@router.delete("/{showtime_id}/ping/{friend_id}", response_model=Message)
def uninvite_friend_from_showtime(
    *,
    session: SessionDep,
    showtime_id: int,
    friend_id: UUID,
    current_user: CurrentUser,
) -> Message:
    # Look up the ping ID before deleting so we can cancel the pending notification.
    existing = showtime_ping_crud.get_showtime_ping(
        session=session,
        showtime_id=showtime_id,
        sender_id=current_user.id,
        receiver_id=friend_id,
    )
    if existing is not None and existing.id is not None:
        with _cancelled_ping_ids_lock:
            _cancelled_ping_ids.add(existing.id)

    deleted = showtimes_service.uninvite_friend_from_showtime(
        session=session,
        showtime_id=showtime_id,
        actor_id=current_user.id,
        friend_id=friend_id,
    )
    if not deleted:
        raise HTTPException(
            status_code=http_status.HTTP_404_NOT_FOUND, detail="Invite not found"
        )
    return Message(message="Invite cancelled successfully")


@router.get(
    "/seat-availability/batch", response_model=list[ShowtimeSeatAvailabilityPublic]
)
def get_seat_availability_batch(
    *,
    session: SessionDep,
    showtime_ids: list[int] = Query(default=[]),
) -> list[ShowtimeSeatAvailabilityPublic]:
    """How full many showtimes are (used to prefetch a list).

    Unauthenticated: how full a screening is is the same fact for everyone,
    including someone who has never signed in, and nothing in the answer
    depends on who asked.
    """
    if len(showtime_ids) > _MAX_VISIBILITY_BATCH_SIZE:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(f"At most {_MAX_VISIBILITY_BATCH_SIZE} showtime ids per request"),
        )
    return seat_availability_service.get_seat_availability_batch(
        session=session, showtime_ids=showtime_ids
    )


@router.get(
    "/{showtime_id}/seat-availability",
    response_model=ShowtimeSeatAvailabilityPublic | None,
)
def get_seat_availability(
    *,
    session: SessionDep,
    showtime_id: int,
) -> ShowtimeSeatAvailabilityPublic | None:
    # Unauthenticated — see get_seat_availability_batch above. Null means there
    # is no usable reading, which is a real answer and not an error.
    return seat_availability_service.get_seat_availability(
        session=session, showtime_id=showtime_id
    )


@router.get("/sold-out-watch", response_model=SoldOutWatchPublic | None)
def get_sold_out_watch(
    *,
    session: SessionDep,
    current_user: CurrentUser,
) -> SoldOutWatchPublic | None:
    """The one showtime this user is waiting on a returned ticket for, if any."""
    return sold_out_watch_service.get_watch(session=session, user_id=current_user.id)


@router.put("/{showtime_id}/sold-out-watch", response_model=SoldOutWatchPublic)
def start_sold_out_watch(
    *,
    session: SessionDep,
    showtime_id: int,
    current_user: CurrentUser,
) -> SoldOutWatchPublic:
    """Wait on this showtime for a returned ticket, replacing any earlier watch.

    PUT rather than POST because a user has one watch, not a collection of
    them: this sets where it points.
    """
    return sold_out_watch_service.start_watch(
        session=session, user=current_user, showtime_id=showtime_id
    )


@router.delete("/sold-out-watch", response_model=Message)
def stop_sold_out_watch(
    *,
    session: SessionDep,
    current_user: CurrentUser,
) -> Message:
    sold_out_watch_service.stop_watch(session=session, user_id=current_user.id)
    return Message(message="No longer watching for tickets")


@router.get("/visibility/batch", response_model=list[ShowtimeVisibilityPublic])
def get_showtime_visibility_batch(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    showtime_ids: list[int] = Query(default=[]),
) -> list[ShowtimeVisibilityPublic]:
    """Visibility modes for many showtimes at once (used to prefetch a list)."""
    if len(showtime_ids) > _MAX_VISIBILITY_BATCH_SIZE:
        raise HTTPException(
            status_code=http_status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(f"At most {_MAX_VISIBILITY_BATCH_SIZE} showtime ids per request"),
        )
    return showtimes_service.get_showtime_visibility_batch(
        session=session,
        showtime_ids=showtime_ids,
        actor_id=current_user.id,
    )


@router.get("/{showtime_id}/visibility", response_model=ShowtimeVisibilityPublic)
def get_showtime_visibility(
    *,
    session: SessionDep,
    showtime_id: int,
    current_user: CurrentUser,
) -> ShowtimeVisibilityPublic:
    return showtimes_service.get_showtime_visibility(
        session=session,
        showtime_id=showtime_id,
        actor_id=current_user.id,
    )


@router.get(
    "/{showtime_id}/visibility/uninvited-selected-friends",
    response_model=UninvitedSelectedFriendsPublic,
)
def get_uninvited_selected_friends_for_showtime(
    *,
    session: SessionDep,
    showtime_id: int,
    current_user: CurrentUser,
) -> UninvitedSelectedFriendsPublic:
    """Friends already going/interested but not yet invited to this showtime.

    Used to prompt the actor, before switching to INVITED_ONLY, to invite
    friends who would otherwise silently lose visibility into their status.
    """
    return showtimes_service.get_uninvited_selected_friends_for_showtime(
        session=session,
        showtime_id=showtime_id,
        actor_id=current_user.id,
    )


@router.put("/{showtime_id}/visibility", response_model=ShowtimeVisibilityPublic)
def update_showtime_visibility(
    *,
    session: SessionDep,
    showtime_id: int,
    payload: ShowtimeVisibilityUpdate,
    current_user: CurrentUser,
) -> ShowtimeVisibilityPublic:
    try:
        return showtimes_service.update_showtime_visibility(
            session=session,
            showtime_id=showtime_id,
            actor_id=current_user.id,
            mode=payload.mode,
        )
    except ValueError as error:
        raise HTTPException(
            status_code=http_status.HTTP_400_BAD_REQUEST, detail=str(error)
        )


# Browse endpoint: the schedule is public, so this answers with or without a
# token — see `app.core.viewer`.
@router.get("/count", openapi_extra=OPTIONAL_AUTH_OPENAPI_EXTRA)
def count_main_page_showtimes(
    *,
    session: SessionDep,
    viewer: CurrentViewer,
    filters: Filters = Depends(get_filters),
) -> int:
    return showtimes_service.count_main_page_showtimes(
        session=session,
        current_user_id=viewer,
        filters=filters,
    )


# Browse endpoint — see count_main_page_showtimes above.
@router.get("/", openapi_extra=OPTIONAL_AUTH_OPENAPI_EXTRA)
def get_main_page_showtimes(
    *,
    session: SessionDep,
    viewer: CurrentViewer,
    limit: int = 10,
    offset: int = 0,
    filters: Filters = Depends(get_filters),
) -> list[ShowtimePublic]:
    return showtimes_service.get_main_page_showtimes(
        session=session,
        current_user_id=viewer,
        limit=limit,
        offset=offset,
        filters=filters,
    )


# Declared last so the literal routes above (/count, /visibility/batch, /) are
# matched first and never shadowed by this dynamic single-segment route.
@router.get(
    "/{showtime_id}",
    response_model=ShowtimePublic,
    openapi_extra=OPTIONAL_AUTH_OPENAPI_EXTRA,
)
def get_showtime_by_id(
    *,
    session: SessionDep,
    showtime_id: int,
    viewer: CurrentViewer,
) -> ShowtimePublic:
    # Browse endpoint — see count_main_page_showtimes above. Shared links land
    # here, so it has to open for someone who has never used the app.
    #
    # ShowtimeNotFoundError (an AppError, 404) is converted to JSON by the
    # global app exception handler, so no explicit try/except is needed here.
    return showtimes_service.get_showtime_by_id(
        session=session,
        showtime_id=showtime_id,
        current_user=viewer,
    )
