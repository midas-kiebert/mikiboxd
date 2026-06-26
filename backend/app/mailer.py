"""Email sending and template rendering.

Handles all outbound email: SMTP delivery, Jinja2 template rendering, and
pre-built email generators for common flows (password reset, new account, etc.).

Email templates live in app/email-templates/build/.
SMTP settings come from environment variables (see core/config.py).
"""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import emails  # type: ignore
from jinja2 import Template

from app.core.config import settings
from app.core.security import generate_watchlist_digest_unsubscribe_token

if TYPE_CHECKING:
    from app.models.movie import Movie
    from app.models.showtime import Showtime

logger = logging.getLogger(__name__)

BRAND_NAME = "MiKiNO"
BRAND_LOGO_URL = "https://mikino.nl/assets/images/mikino-logo.png"


@dataclass
class EmailData:
    html_content: str
    subject: str


class EmailDeliveryError(Exception):
    """Raised when the SMTP server returns a 4xx/5xx status code."""


def _render_email_template(*, template_name: str, context: dict[str, Any]) -> str:
    """Render a Jinja2 HTML email template from the build directory."""
    template_str = (
        Path(__file__).parent / "email-templates" / "build" / template_name
    ).read_text()
    template: Template = Template(template_str)
    return template.render(context)


def send_email(
    *,
    email_to: str,
    subject: str = "",
    html_content: str = "",
    attachments: list[dict[str, Any]] | None = None,
) -> None:
    """Send an HTML email via the configured SMTP server.

    Raises:
        AssertionError: If email settings are not configured.
        EmailDeliveryError: If the SMTP server returns a 4xx/5xx response.
    """
    if not settings.emails_enabled:
        raise RuntimeError("no provided configuration for email variables")
    message = emails.Message(
        subject=subject,
        html=html_content,
        mail_from=(settings.EMAILS_FROM_NAME, settings.EMAILS_FROM_EMAIL),
    )
    for attachment in attachments or []:
        message.attach(**attachment)
    smtp_options: dict[str, Any] = {
        "host": settings.SMTP_HOST,
        "port": settings.SMTP_PORT,
    }
    if settings.SMTP_TLS:
        smtp_options["tls"] = True
    elif settings.SMTP_SSL:
        smtp_options["ssl"] = True
    if settings.SMTP_USER:
        smtp_options["user"] = settings.SMTP_USER
    if settings.SMTP_PASSWORD:
        smtp_options["password"] = settings.SMTP_PASSWORD
    if settings.SMTP_TIMEOUT_SECONDS > 0:
        smtp_options["timeout"] = settings.SMTP_TIMEOUT_SECONDS
    response = message.send(to=email_to, smtp=smtp_options)
    logger.info(f"send email result: {response}")

    status_code = getattr(response, "status_code", None)
    status_text = getattr(response, "status_text", "")
    if isinstance(status_text, bytes):
        status_text = status_text.decode(errors="replace")

    if status_code is not None and int(status_code) >= 400:
        raise EmailDeliveryError(f"{status_code} {status_text}")


def generate_reset_password_email(email_to: str, email: str, token: str) -> EmailData:
    """Generate a password reset email containing a signed reset link."""
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - Password recovery for user {email}"
    link = f"{settings.FRONTEND_HOST}/reset-password?token={token}"
    html_content = _render_email_template(
        template_name="reset_password.html",
        context={
            "project_name": settings.PROJECT_NAME,
            "username": email,
            "email": email_to,
            "valid_hours": settings.EMAIL_RESET_TOKEN_EXPIRE_HOURS,
            "link": link,
        },
    )
    return EmailData(html_content=html_content, subject=subject)


def generate_watchlist_digest_email(
    *,
    email_to: str,
    movie_entries: list[tuple["Movie", "Showtime"]],
) -> EmailData:
    """Generate the watchlist digest email for movies that just got a new showtime."""
    subject = f"{BRAND_NAME} - New showtimes for your watchlist"
    movies = [
        {
            "title": movie.title,
            "cinema_name": showtime.cinema.name,
            "datetime_label": showtime.datetime.strftime("%a, %b %d at %H:%M"),
            "poster_link": movie.poster_link,
            "mikino_link": f"{settings.FRONTEND_HOST}/movie/{movie.id}",
            "letterboxd_link": (
                f"https://letterboxd.com/film/{movie.letterboxd_slug}/"
                if movie.letterboxd_slug
                else None
            ),
        }
        for movie, showtime in movie_entries
    ]
    unsubscribe_token = generate_watchlist_digest_unsubscribe_token(email=email_to)
    unsubscribe_link = (
        f"{settings.API_HOST}{settings.API_V1_STR}"
        f"/users/unsubscribe-watchlist-digest?token={unsubscribe_token}"
    )
    html_content = _render_email_template(
        template_name="watchlist_digest.html",
        context={
            "brand_name": BRAND_NAME,
            "logo_url": BRAND_LOGO_URL,
            "movies": movies,
            "unsubscribe_link": unsubscribe_link,
        },
    )
    return EmailData(html_content=html_content, subject=subject)
