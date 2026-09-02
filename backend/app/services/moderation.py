"""Blocking and reporting other users.

The two things App Store Review guideline 1.2 requires of an app where users can
reach each other, and the reason they live in one module: blocking without
reporting leaves abuse invisible to the operator, and reporting without blocking
leaves the reporter still exposed to it. The client offers them together (see
`UserReportCreate.block_user`) and this module is where that pair is honoured.

**Blocking is a teardown, not a flag.** Setting a bit and filtering on read
would leave the friendship, the pending requests and the standing invites in
place — each of which is a live channel between the two accounts and a source of
mutual visibility. `block_user` dismantles all of it in one transaction and
rebuilds both users' effective visibility afterwards.

The objectionable-username half of guideline 1.2 lives in
`core/username_filter.py` and is applied by `services/users.py` and
`services/me.py`, since those own account creation and rename.
"""

import logging
from uuid import UUID

from sqlalchemy.exc import NoResultFound
from sqlmodel import Session

from app.core.config import settings
from app.core.enums import UserReportReason
from app.crud import friendship as friendship_crud
from app.crud import showtime_ping as showtime_ping_crud
from app.crud import showtime_visibility as showtime_visibility_crud
from app.crud import user_block as user_block_crud
from app.crud import user_report as user_report_crud
from app.exceptions.base import AppError
from app.exceptions.moderation_exceptions import (
    CannotBlockSelfError,
    CannotReportSelfError,
    UserBlockNotFoundError,
)
from app.exceptions.user_exceptions import UserNotFound
from app.mailer import (
    REPORT_NOTIFICATION_EMAIL,
    EmailDeliveryError,
    generate_user_report_email,
    send_email,
)
from app.models.auth_schemas import Message
from app.models.user import User
from app.schemas.user_block import BlockedUserPublic

logger = logging.getLogger(__name__)

# Shown in the operator email instead of the raw enum value.
REPORT_REASON_LABELS: dict[UserReportReason, str] = {
    UserReportReason.OBJECTIONABLE_USERNAME: "Objectionable username",
    UserReportReason.IMPERSONATION: "Impersonation",
    UserReportReason.REPEATED_UNWANTED_CONTACT: "Repeated unwanted friend requests/invites",
    UserReportReason.SPAM: "Spam",
    UserReportReason.OTHER: "Other",
}


def _require_user(*, session: Session, user_id: UUID) -> User:
    user = session.get(User, user_id)
    if user is None:
        raise UserNotFound(user_id)
    return user


def _tear_down_contact(
    *,
    session: Session,
    user_id: UUID,
    other_id: UUID,
) -> None:
    """Remove every standing channel between two users. Caller owns the commit."""
    if friendship_crud.are_users_friends(
        session=session, user_id=user_id, friend_id=other_id
    ):
        friendship_crud.delete_friendship(
            session=session,
            user_id=user_id,
            friend_id=other_id,
        )

    # Pending requests in both directions. Tolerant of absence: normally at most
    # one of these exists, and neither is required to.
    for sender_id, receiver_id in ((user_id, other_id), (other_id, user_id)):
        try:
            friendship_crud.delete_friend_request(
                session=session,
                sender_id=sender_id,
                receiver_id=receiver_id,
            )
        except NoResultFound:
            pass

    showtime_ping_crud.delete_pings_between_users(
        session=session,
        user_id=user_id,
        other_id=other_id,
    )

    # Unconditional, not just when a friendship or ping existed: under
    # FRIENDS_OF_FRIENDS mode two users can see each other purely through a
    # mutual friend, with no direct Friendship or ShowtimePing row to delete —
    # nothing above would otherwise clear that stale cross-visibility.
    for owner_id in (user_id, other_id):
        showtime_visibility_crud.rebuild_effective_visibility_for_owner(
            session=session,
            owner_id=owner_id,
        )


def block_user(
    *,
    session: Session,
    blocker_id: UUID,
    blocked_id: UUID,
) -> Message:
    """Block a user and tear down every channel between the two accounts.

    Idempotent — blocking someone already blocked succeeds and changes nothing,
    so a stale client or a double tap cannot turn a block into an error the user
    has to interpret.

    Raises:
        CannotBlockSelfError: If the two ids are the same.
        UserNotFound: If the blocked user does not exist.
        AppError: For any other (unexpected) errors.
    """
    if blocker_id == blocked_id:
        raise CannotBlockSelfError

    _require_user(session=session, user_id=blocked_id)

    try:
        user_block_crud.create_block(
            session=session,
            blocker_id=blocker_id,
            blocked_id=blocked_id,
        )
        _tear_down_contact(session=session, user_id=blocker_id, other_id=blocked_id)
        session.commit()
    except AppError:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        raise AppError from e

    return Message(message="User blocked.")


def unblock_user(
    *,
    session: Session,
    blocker_id: UUID,
    blocked_id: UUID,
) -> Message:
    """Lift a block the current user owns.

    Nothing torn down by `block_user` is restored — the friendship, requests and
    invites stay gone. Unblocking only makes the two reachable to each other
    again, which is the honest inverse: silently re-friending two people because
    they happened to be friends before a block would be a nasty surprise for
    both of them.

    What does need refreshing is `ShowtimeVisibilityEffective`: while blocked,
    both users' effective-visibility rows were computed with each other
    excluded (see `crud.showtime_visibility`'s use of `get_hidden_user_ids`),
    and nothing else ever recomputes those rows. Without an explicit rebuild
    here, a pair who were only ever connected through a mutual friend (a
    FRIENDS_OF_FRIENDS bridge, never a direct friendship) would stay invisible
    to each other forever after unblocking — there'd be no later event to
    naturally clear the stale exclusion.

    Raises:
        UserBlockNotFoundError: If the current user has not blocked this user.
        AppError: For any other (unexpected) errors.
    """
    try:
        lifted = user_block_crud.delete_block(
            session=session,
            blocker_id=blocker_id,
            blocked_id=blocked_id,
        )
        if not lifted:
            raise UserBlockNotFoundError(blocker_id, blocked_id)
        for owner_id in (blocker_id, blocked_id):
            showtime_visibility_crud.rebuild_effective_visibility_for_owner(
                session=session,
                owner_id=owner_id,
            )
        session.commit()
    except AppError:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        raise AppError from e

    return Message(message="User unblocked.")


def list_blocked_users(
    *,
    session: Session,
    blocker_id: UUID,
) -> list[BlockedUserPublic]:
    """The current user's blocked accounts, newest block first."""
    return [
        BlockedUserPublic(
            id=user.id,
            display_name=user.display_name,
            blocked_at=blocked_at,
        )
        for user, blocked_at in user_block_crud.list_blocked_users(
            session=session, blocker_id=blocker_id
        )
    ]


def is_contact_blocked(
    *,
    session: Session,
    user_id: UUID,
    other_id: UUID,
) -> bool:
    """Whether a contact attempt between these two must be refused.

    The single question every friend-request, invite and profile-read path asks.
    Symmetric on purpose — see `crud/user_block.is_blocked_either_way`.
    """
    return user_block_crud.is_blocked_either_way(
        session=session, user_id=user_id, other_id=other_id
    )


def has_blocked(
    *,
    session: Session,
    blocker_id: UUID,
    blocked_id: UUID,
) -> bool:
    """Whether this user has blocked that one — one direction only.

    Drives the profile screen's Block/Unblock label. Never ask this the other way
    round for the client: being blocked *by* someone must not be visible to the
    person blocked, or the block becomes a message.
    """
    return blocked_id in user_block_crud.get_blocked_ids(
        session=session, blocker_id=blocker_id
    )


def get_hidden_user_ids(*, session: Session, user_id: UUID) -> set[UUID]:
    """Everyone this user must not see, and who must not see them."""
    return user_block_crud.get_hidden_user_ids(session=session, user_id=user_id)


def filter_hidden_users(
    *,
    session: Session,
    viewer_id: UUID,
    users: list[User],
) -> list[User]:
    """Drop users the viewer has blocked, and users who have blocked the viewer.

    One query for the whole list rather than one per row — this runs on the
    user-search path, which is typed into.
    """
    if not users:
        return users
    hidden = user_block_crud.get_hidden_user_ids(session=session, user_id=viewer_id)
    if not hidden:
        return users
    return [user for user in users if user.id not in hidden]


def report_user(
    *,
    session: Session,
    reporter: User,
    reported_id: UUID,
    reason: UserReportReason,
    message: str | None,
    also_block: bool,
) -> Message:
    """File a report about another user, and block them unless asked not to.

    A repeat report from the same reporter about the same user, while the first
    is still open, is answered with the same success rather than a second row —
    the reporter has already been heard, and a triage queue full of duplicates is
    how a real report gets missed.

    Raises:
        CannotReportSelfError: If the reporter names themselves.
        UserNotFound: If the reported user does not exist.
        AppError: For any other (unexpected) errors.
    """
    if reporter.id == reported_id:
        raise CannotReportSelfError

    reported = _require_user(session=session, user_id=reported_id)

    is_duplicate = user_report_crud.has_open_report(
        session=session, reporter_id=reporter.id, reported_id=reported_id
    )
    if not is_duplicate:
        try:
            user_report_crud.create_report(
                session=session,
                reporter_id=reporter.id,
                reported_id=reported_id,
                reason=reason,
                message=message,
            )
            session.commit()
        except Exception as e:
            session.rollback()
            raise AppError from e

    if also_block:
        block_user(session=session, blocker_id=reporter.id, blocked_id=reported_id)

    if not is_duplicate:
        _send_report_notification_email(
            session=session,
            reported=reported,
            reporter=reporter,
            reason=reason,
            message=message,
        )

    return Message(message="Report received.")


def _send_report_notification_email(
    *,
    session: Session,
    reported: User,
    reporter: User,
    reason: UserReportReason,
    message: str | None,
) -> None:
    """Mail the report to the operator. Never fatal to the report itself.

    Guideline 1.2 asks for "timely responses to concerns", which needs the report
    to reach a person rather than only a table — but a user who has just reported
    harassment must not be told their report failed because SMTP did.
    """
    if not settings.emails_enabled:
        logger.info("Email notifications are disabled; skipping user report email")
        return
    try:
        open_report_count = user_report_crud.count_open_reports_about(
            session=session, reported_id=reported.id
        )
        email_data = generate_user_report_email(
            reported_display_name=reported.display_name,
            reported_email=reported.email,
            reason_label=REPORT_REASON_LABELS[reason],
            message=message,
            reporter_email=reporter.email,
            open_report_count=open_report_count,
        )
        send_email(
            email_to=REPORT_NOTIFICATION_EMAIL,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
    except (AssertionError, EmailDeliveryError, Exception):
        logger.exception("Failed sending user report notification email")
