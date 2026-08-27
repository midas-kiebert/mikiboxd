"""Email sending and template rendering.

Handles all outbound email: SMTP delivery, Jinja2 template rendering, and
pre-built email generators for common flows (password reset, new account, etc.).

Email templates live in app/email-templates/build/.
SMTP settings come from environment variables (see core/config.py).
"""

import html
import logging
import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any

import emails  # type: ignore
from jinja2 import Template

from app.core.config import settings
from app.core.enums import DigestFrequency
from app.core.security import generate_watchlist_digest_unsubscribe_token

if TYPE_CHECKING:
    from app.models.movie import Movie
    from app.models.showtime import Showtime

logger = logging.getLogger(__name__)

BRAND_NAME = "MiKiNO"
REPORT_NOTIFICATION_EMAIL = "info@mikino.nl"


@dataclass
class EmailData:
    html_content: str
    subject: str
    # Hand-written text/plain alternative. Generators that care about the
    # wording set it; the rest fall back to _html_to_plain_text().
    text_content: str = ""


class EmailDeliveryError(Exception):
    """Raised when the SMTP server returns a 4xx/5xx status code."""


def _render_email_template(*, template_name: str, context: dict[str, Any]) -> str:
    """Render a Jinja2 HTML email template from the build directory."""
    template_str = (
        Path(__file__).parent / "email-templates" / "build" / template_name
    ).read_text()
    template: Template = Template(template_str)
    return template.render(context)


# <head> goes wholesale: MJML puts the <title> and the responsive <style> block
# there, and both would otherwise surface as stray text.
_DROPPED_BLOCK_RE = re.compile(
    r"<(script|style|head)\b.*?</\1>", re.IGNORECASE | re.DOTALL
)
# Comments carry MJML's Outlook ghost tables and its <o:PixelsPerInch>96</...>
# block, which leaks a bare "96" into the text part if left in.
_COMMENT_RE = re.compile(r"<!--.*?-->", re.DOTALL)
_LINK_RE = re.compile(
    r"<a\b[^>]*\bhref=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.IGNORECASE | re.DOTALL
)
_BLOCK_BOUNDARY_RE = re.compile(
    r"</(?:p|div|tr|li|h[1-6]|table)\s*>|<br\s*/?>", re.IGNORECASE
)
_ANY_TAG_RE = re.compile(r"<[^>]+>")


def _html_to_plain_text(html_content: str) -> str:
    """Derive a readable text/plain part from rendered HTML.

    Every email goes out as multipart/alternative rather than HTML-only: an
    HTML-only body is one of the signals mail clients use to sort a message as
    bulk mail, which is part of why the watchlist digest was landing in Proton's
    Promotions category instead of the primary inbox.

    This is the fallback for the internal emails (moderation reports, scrape
    recap) whose plain-text wording nobody reads closely. User-facing
    generators hand-write `EmailData.text_content` instead.
    """
    text = _COMMENT_RE.sub("", html_content)
    text = _DROPPED_BLOCK_RE.sub("", text)
    text = _LINK_RE.sub(
        lambda match: f"{_ANY_TAG_RE.sub('', match.group(2)).strip()} ({match.group(1)})",
        text,
    )
    text = _BLOCK_BOUNDARY_RE.sub("\n", text)
    text = _ANY_TAG_RE.sub("", text)
    text = html.unescape(text)
    lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        # Collapse runs of blank lines, but keep single ones as paragraph breaks.
        if line or (lines and lines[-1]):
            lines.append(line)
    return "\n".join(lines).strip()


def send_email(
    *,
    email_to: str,
    subject: str = "",
    html_content: str = "",
    text_content: str = "",
    attachments: list[dict[str, Any]] | None = None,
) -> None:
    """Send a multipart/alternative email via the configured SMTP server.

    Raises:
        AssertionError: If email settings are not configured.
        EmailDeliveryError: If the SMTP server returns a 4xx/5xx response.
    """
    if settings.TESTING:
        # Belt-and-suspenders: even if a test forgets to mock send_email, this
        # stops the real SMTP call. Callers already treat delivery failures as
        # non-fatal (see call sites' try/except), so raising here is safe.
        raise RuntimeError(
            "send_email() was called during a test run without being mocked"
        )
    if not settings.emails_enabled:
        raise RuntimeError("no provided configuration for email variables")
    message = emails.Message(
        subject=subject,
        html=html_content,
        text=text_content or _html_to_plain_text(html_content),
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


def generate_verify_email_email(email_to: str, token: str) -> EmailData:
    """Generate the "confirm your email" email sent when an account is created.

    The link points straight at the API rather than the frontend, like the
    digest's unsubscribe link: confirming is one click with nothing to fill in,
    and routing it through a single-page app would only add a way for it to
    fail in someone's mail client.
    """
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - Confirm your email address"
    link = (
        f"{settings.API_HOST}{settings.API_V1_STR}" f"/users/verify-email?token={token}"
    )
    html_content = _render_email_template(
        template_name="verify_email.html",
        context={
            "project_name": project_name,
            "username": email_to,
            "email": email_to,
            "valid_hours": settings.EMAIL_VERIFICATION_TOKEN_EXPIRE_HOURS,
            "link": link,
        },
    )
    return EmailData(html_content=html_content, subject=subject)


def _watchlist_digest_subject(
    movie_entries: list[tuple["Movie", "Showtime"]], *, frequency: DigestFrequency
) -> str:
    """Build the digest subject line from the films it is about.

    Deliberately no "MiKiNO - " prefix and no standing phrase: a brand-prefixed,
    identical-every-time subject is one of the shapes mail clients score as bulk
    marketing, and this digest was being filed under Proton's Promotions
    category. Naming the actual films makes it read like the notification it is.

    The two frequencies get different wording because they promise different
    things. WEEKLY only ever carries films screening within seven days, so it
    can say "this week". DAILY has no horizon at all — its whole purpose is to
    flag a film months before it screens — so it must not imply one.
    """
    titles = [movie.title for movie, _ in movie_entries]
    is_weekly = frequency == DigestFrequency.WEEKLY_OR_URGENT
    if len(titles) == 1:
        cinema_name = movie_entries[0][1].cinema.name
        if is_weekly:
            return f"{titles[0]} is showing at {cinema_name} this week"
        return f"{titles[0]} is coming to {cinema_name}"
    if len(titles) == 2:
        subjects = f"{titles[0]} and {titles[1]}"
    else:
        subjects = f"{titles[0]}, {titles[1]} and {len(titles) - 2} more"
    if is_weekly:
        return f"{subjects} are showing this week"
    return f"{subjects} are coming up"


def _watchlist_digest_intro(frequency: DigestFrequency) -> str:
    """The email's opening line, matched to the frequency's horizon."""
    if frequency == DigestFrequency.WEEKLY_OR_URGENT:
        return "These films on your watchlist are showing in the coming week:"
    return "These films on your watchlist are coming up:"


def _watchlist_digest_text(
    *, intro: str, movies: list[dict[str, Any]], unsubscribe_link: str
) -> str:
    """Render the text/plain half of the digest.

    Hand-written rather than derived from the HTML so the plain-text part reads
    as a real message; some clients show it, and all of them weigh it.
    """
    lines = [intro, ""]
    for movie in movies:
        lines.append(str(movie["title"]))
        lines.append(f"{movie['cinema_name']} - {movie['datetime_label']}")
        lines.append(str(movie["mikino_link"]))
        lines.append("")
    lines.append(f"You get this because you watchlisted these films on {BRAND_NAME}.")
    lines.append(f"To stop them: {unsubscribe_link}")
    return "\n".join(lines)


def generate_watchlist_digest_email(
    *,
    email_to: str,
    movie_entries: list[tuple["Movie", "Showtime"]],
    frequency: DigestFrequency,
) -> EmailData:
    """Generate the watchlist digest email for movies that just became available."""
    movies: list[dict[str, Any]] = [
        {
            "title": movie.title,
            "cinema_name": showtime.cinema.name,
            "datetime_label": showtime.datetime.strftime("%a, %b %d at %H:%M"),
            "poster_link": movie.poster_link,
            "mikino_link": f"{settings.PUBLIC_HOST}/movie/{movie.id}",
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
    intro = _watchlist_digest_intro(frequency)
    html_content = _render_email_template(
        template_name="watchlist_digest.html",
        context={
            "brand_name": BRAND_NAME,
            "intro": intro,
            "movies": movies,
            "unsubscribe_link": unsubscribe_link,
        },
    )
    return EmailData(
        html_content=html_content,
        subject=_watchlist_digest_subject(movie_entries, frequency=frequency),
        text_content=_watchlist_digest_text(
            intro=intro, movies=movies, unsubscribe_link=unsubscribe_link
        ),
    )


def generate_user_report_email(
    *,
    reported_display_name: str | None,
    reported_email: str,
    reason_label: str,
    message: str | None,
    reporter_email: str,
    open_report_count: int,
) -> EmailData:
    """Generate the internal notification sent on every report about a user.

    Guideline 1.2 asks for timely responses to concerns, so a report about a
    person is mailed rather than only queued — the open-report count is in the
    subject because a second or third report about the same account is the
    signal worth acting on immediately.

    Plain inline HTML rather than a Jinja template, matching
    `generate_showtime_report_email`: internal moderation mail, not a branded
    user-facing email.
    """
    reported_label = reported_display_name or "(no username)"
    subject = (
        f"{BRAND_NAME} - User report: {reported_label} ({reason_label})"
        f"{f' — {open_report_count} open' if open_report_count > 1 else ''}"
    )
    admin_link = f"{settings.FRONTEND_HOST}/admin/user-reports"
    html_content = f"""
    <p>Reported account: <strong>{html.escape(reported_label)}</strong> ({html.escape(reported_email)})</p>
    <p>Reason: {html.escape(reason_label)}</p>
    <p>Message: {html.escape(message) if message else "(none)"}</p>
    <p>Reported by: {html.escape(reporter_email)}</p>
    <p>Open reports about this account: {open_report_count}</p>
    <p><a href="{admin_link}">Open the user-reports dashboard</a></p>
    """
    return EmailData(html_content=html_content, subject=subject)


def generate_showtime_report_email(
    *,
    movie_title: str,
    cinema_name: str,
    showtime_datetime_label: str,
    reason_label: str,
    message: str | None,
    reporter_email: str,
) -> EmailData:
    """Generate the internal notification sent to REPORT_NOTIFICATION_EMAIL on every report.

    Plain inline HTML rather than a Jinja template — this is an internal
    moderation notification, not a branded user-facing email.
    """
    subject = f"{BRAND_NAME} - Showtime report: {movie_title} ({reason_label})"
    admin_link = f"{settings.FRONTEND_HOST}/admin/reports"
    html_content = f"""
    <p><strong>{html.escape(movie_title)}</strong> at <strong>{html.escape(cinema_name)}</strong>, {html.escape(showtime_datetime_label)}</p>
    <p>Reason: {html.escape(reason_label)}</p>
    <p>Message: {html.escape(message) if message else "(none)"}</p>
    <p>Reported by: {html.escape(reporter_email)}</p>
    <p><a href="{admin_link}">Open the reports dashboard</a></p>
    """
    return EmailData(html_content=html_content, subject=subject)
