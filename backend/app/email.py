"""Email sending and template rendering.

Handles all outbound email: SMTP delivery, Jinja2 template rendering, and
pre-built email generators for common flows (password reset, new account, etc.).

Email templates live in app/email-templates/build/.
SMTP settings come from environment variables (see core/config.py).
"""

import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import emails  # type: ignore
from jinja2 import Template

from app.core.config import settings

logger = logging.getLogger(__name__)


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


def generate_test_email(email_to: str) -> EmailData:
    """Generate a test email to verify SMTP configuration is working."""
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - Test email"
    html_content = _render_email_template(
        template_name="test_email.html",
        context={"project_name": settings.PROJECT_NAME, "email": email_to},
    )
    return EmailData(html_content=html_content, subject=subject)


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


def generate_new_account_email(
    email_to: str, username: str, password: str
) -> EmailData:
    """Generate a welcome email for a newly created account."""
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - New account for user {username}"
    html_content = _render_email_template(
        template_name="new_account.html",
        context={
            "project_name": settings.PROJECT_NAME,
            "username": username,
            "password": password,
            "email": email_to,
            "link": settings.FRONTEND_HOST,
        },
    )
    return EmailData(html_content=html_content, subject=subject)
