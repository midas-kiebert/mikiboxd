from uuid import UUID

from sqlmodel import Session

from app.models.showtime_ping_link import ShowtimePingLink


def create_showtime_ping_link(
    *,
    session: Session,
    token: str,
    showtime_id: int,
    sender_id: UUID,
) -> ShowtimePingLink:
    link = ShowtimePingLink(token=token, showtime_id=showtime_id, sender_id=sender_id)
    session.add(link)
    session.flush()
    session.refresh(link)
    return link


def get_showtime_ping_link(*, session: Session, token: str) -> ShowtimePingLink | None:
    return session.get(ShowtimePingLink, token)
