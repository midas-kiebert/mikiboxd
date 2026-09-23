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
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

import emails  # type: ignore
from jinja2 import Template
from markupsafe import Markup

from app.core.config import settings
from app.core.enums import DIGEST_FREQUENCY_LABELS, DigestFrequency
from app.core.security import generate_watchlist_digest_unsubscribe_token

if TYPE_CHECKING:
    from app.models.movie import Movie
    from app.models.showtime import Showtime

logger = logging.getLogger(__name__)

BRAND_NAME = "MiKiNO"
REPORT_NOTIFICATION_EMAIL = "info@mikino.nl"


@dataclass
class DigestSource:
    """One `WatchlistDigestSource` that contributed films to a digest email,
    named and dated for the email's footer.

    A user with several digest sources due the same day gets one combined
    email rather than one per source (see
    `services/watchlist_digest.py::build_and_send_combined_digest`), so the
    footer lists every contributing source — usually just one.

    ``label`` is a complete noun phrase ("your Letterboxd watchlist", "the
    Letterboxd list “Best of 2026”") because the two cases don't share a
    sentence shape. ``url`` is None when the source can't be linked — a chosen
    list whose row has since been deleted. ``frequency`` is this source's own
    cadence, since sources combined into one email may not share one.
    ``cinemas_label`` names its cinema restriction ("All cinemas", "My
    Cinemas", "3 custom cinemas") the same way — each row of the footer
    describes one axis of the source rather than folding all three into one
    sentence, so a source with an unusual combination is never left implicit.
    """

    label: str
    url: str | None
    frequency: DigestFrequency
    cinemas_label: str


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
    # autoescape: film titles come from TMDB and list titles from Letterboxd,
    # so every value interpolated here is third-party text.
    template: Template = Template(template_str, autoescape=True)
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

    The link goes to the website's /verify-email page rather than the API: that
    path is claimed by the app's universal/app links, so on a phone with the app
    installed it opens there, and everywhere else it lands on a page that looks
    like the rest of the site instead of a bare API response.
    """
    project_name = settings.PROJECT_NAME
    subject = f"{project_name} - Confirm your email address"
    link = f"{settings.FRONTEND_HOST}/verify-email?token={token}"
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
    movie_entries: list[tuple["Movie", "Showtime"]], *, within_week: bool
) -> str:
    """Build the digest subject line from the films it is about.

    Deliberately no "MiKiNO - " prefix and no standing phrase: a brand-prefixed,
    identical-every-time subject is one of the shapes mail clients score as bulk
    marketing, and this digest was being filed under Proton's Promotions
    category. Naming the actual films makes it read like the notification it is.

    ``within_week`` is about the films actually being sent, not a source's
    declared frequency: a combined email can carry films from a DAILY source
    and a WEEKLY one in the same send, so "this week" is only said when every
    film shown really is screening within seven days — never inferred from
    which source(s) contributed them.
    """
    titles = [movie.title for movie, _ in movie_entries]
    if len(titles) == 1:
        cinema_name = movie_entries[0][1].cinema.name
        if within_week:
            return f"{titles[0]} is showing at {cinema_name} this week"
        return f"{titles[0]} is coming to {cinema_name}"
    if len(titles) == 2:
        subjects = f"{titles[0]} and {titles[1]}"
    else:
        subjects = f"{titles[0]}, {titles[1]} and {len(titles) - 2} more"
    if within_week:
        return f"{subjects} are showing this week"
    return f"{subjects} are coming up"


def _watchlist_digest_intro(within_week: bool) -> str:
    """The email's opening line, matched to whether every film shown is
    actually screening within the coming week (see `_watchlist_digest_subject`
    on why this is derived from the films themselves rather than a frequency).

    Says nothing about where the films came from — the source is named in the
    footer, and it isn't always a watchlist.
    """
    if within_week:
        return "These films are showing in the coming week:"
    return "These films are coming to your cinemas:"


def _watchlist_digest_explainer(frequency: DigestFrequency) -> str:
    """One sentence telling the reader what their chosen mode actually does.

    Kept in the email rather than left to Settings so the footer answers "why am
    I getting this now?" on its own. Deliberately shorter than the settings
    descriptions in api/routes/utils.py, but must not contradict them.
    """
    if frequency == DigestFrequency.WEEKLY_OR_URGENT:
        return "You get one email each Thursday, covering the next seven days."
    return (
        "You get an email the day a film on it becomes available, "
        "however far ahead it screens."
    )


def _watchlist_digest_text(
    *,
    intro: str,
    movies: list[dict[str, Any]],
    sources: list[DigestSource],
    unsubscribe_link: str,
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
    for index, source in enumerate(sources):
        following = source.label + (f" ({source.url})" if source.url else "")
        if len(sources) > 1:
            lines.append(f"Source {index + 1}:")
        lines.append(
            f"Frequency: {DIGEST_FREQUENCY_LABELS[source.frequency]}"
            f" — {_watchlist_digest_explainer(source.frequency)}"
        )
        lines.append(f"List: {following}")
        lines.append(f"Cinemas: {source.cinemas_label}")
        lines.append("")
    lines.append(f"To stop these emails: {unsubscribe_link}")
    return "\n".join(lines)


# How far ahead a film has to screen to still count as "this week" in the
# subject/intro — matches `_WEEKLY_HORIZON` in `services/watchlist_digest.py`,
# the same seven-day window a WEEKLY source's own films are always filtered
# to. Kept as a separate constant since this module has no reason to import
# that one — the two are the same figure by design, not by coincidence.
_SUBJECT_WEEK_HORIZON = timedelta(days=7)


def generate_watchlist_digest_email(
    *,
    email_to: str,
    movie_entries: list[tuple["Movie", "Showtime"]],
    sources: list[DigestSource],
    now: datetime,
) -> EmailData:
    """Generate the watchlist digest email for movies that just became available.

    ``sources`` is every digest source that contributed at least one of
    ``movie_entries`` to this send — usually one, but a user with several due
    the same day gets a single combined email rather than one per source (see
    `services/watchlist_digest.py::build_and_send_combined_digest`), so the
    footer lists each of them.
    """
    within_week = all(
        showtime.datetime <= now + _SUBJECT_WEEK_HORIZON
        for _, showtime in movie_entries
    )
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
    intro = _watchlist_digest_intro(within_week)
    html_content = _render_email_template(
        template_name="watchlist_digest.html",
        context={
            "brand_name": BRAND_NAME,
            "intro": intro,
            "movies": movies,
            "sources": [
                {
                    "label": source.label,
                    "url": source.url,
                    "frequency_label": DIGEST_FREQUENCY_LABELS[source.frequency],
                    "frequency_explainer": _watchlist_digest_explainer(
                        source.frequency
                    ),
                    "cinemas_label": source.cinemas_label,
                }
                for source in sources
            ],
            "unsubscribe_link": unsubscribe_link,
        },
    )
    return EmailData(
        html_content=html_content,
        subject=_watchlist_digest_subject(movie_entries, within_week=within_week),
        text_content=_watchlist_digest_text(
            intro=intro,
            movies=movies,
            sources=sources,
            unsubscribe_link=unsubscribe_link,
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


def _italicize_movie_title(text: str, movie_title: str) -> Markup:
    """Escape `text`, then wrap the (also escaped) `movie_title` in <em>.

    Titles are plain strings built by string concatenation upstream (actor
    name + verb phrase + movie title + day word), so this is the one place
    that needs to turn just the movie's name italic without touching the
    rest of the sentence. Returns pre-escaped `Markup` so the autoescaping
    template renders the `<em>` tag instead of escaping it away.
    """
    escaped_text = str(Markup.escape(text))
    escaped_title = str(Markup.escape(movie_title))
    if escaped_title and escaped_title in escaped_text:
        escaped_text = escaped_text.replace(
            escaped_title, f"<em>{escaped_title}</em>", 1
        )
    return Markup(escaped_text)


def _generate_activity_notification_email(
    *,
    subject: str,
    heading: str,
    cta_label: str,
    cta_link: str,
    movie: dict[str, Any] | None = None,
) -> EmailData:
    """Render one of the branded event-notification emails (invites, matches, etc.)."""
    heading_html: str | Markup = (
        _italicize_movie_title(heading, movie["title"]) if movie else heading
    )
    html_content = _render_email_template(
        template_name="notification.html",
        context={
            "brand_name": BRAND_NAME,
            "heading": heading_html,
            "movie": movie,
            "cta_label": cta_label,
            "cta_link": cta_link,
            "settings_link": f"{settings.FRONTEND_HOST}/settings",
        },
    )
    return EmailData(html_content=html_content, subject=subject)


def _movie_context(
    *,
    title: str,
    cinema_name: str,
    showtime_datetime_label: str,
    poster_link: str | None,
) -> dict[str, Any]:
    return {
        "title": title,
        "cinema_name": cinema_name,
        "datetime_label": showtime_datetime_label,
        "poster_link": poster_link,
    }


def _showtime_link(*, movie_id: int, showtime_id: int) -> str:
    return f"{settings.FRONTEND_HOST}/movie/{movie_id}?showtime={showtime_id}"


def generate_friend_showtime_status_email(
    *,
    heading: str,
    movie_id: int,
    showtime_id: int,
    movie_title: str,
    poster_link: str | None,
    cinema_name: str,
    showtime_datetime_label: str,
) -> EmailData:
    """A friend you're both attending changed status on a showtime you share."""
    return _generate_activity_notification_email(
        subject=heading,
        heading=heading,
        movie=_movie_context(
            title=movie_title,
            cinema_name=cinema_name,
            showtime_datetime_label=showtime_datetime_label,
            poster_link=poster_link,
        ),
        cta_label=f"View on {BRAND_NAME}",
        cta_link=_showtime_link(movie_id=movie_id, showtime_id=showtime_id),
    )


def generate_invite_response_email(
    *,
    heading: str,
    movie_id: int,
    showtime_id: int,
    movie_title: str,
    poster_link: str | None,
    cinema_name: str,
    showtime_datetime_label: str,
) -> EmailData:
    """Someone you invited to a showtime responded going/interested."""
    return _generate_activity_notification_email(
        subject=heading,
        heading=heading,
        movie=_movie_context(
            title=movie_title,
            cinema_name=cinema_name,
            showtime_datetime_label=showtime_datetime_label,
            poster_link=poster_link,
        ),
        cta_label=f"View on {BRAND_NAME}",
        cta_link=_showtime_link(movie_id=movie_id, showtime_id=showtime_id),
    )


def generate_friend_request_email(*, heading: str) -> EmailData:
    """Someone sent you a friend request."""
    return _generate_activity_notification_email(
        subject=heading,
        heading=heading,
        cta_label="View friends",
        cta_link=f"{settings.FRONTEND_HOST}/friends",
    )


def generate_friend_request_accepted_email(*, heading: str) -> EmailData:
    """Someone accepted the friend request you sent."""
    return _generate_activity_notification_email(
        subject=heading,
        heading=heading,
        cta_label="View friends",
        cta_link=f"{settings.FRONTEND_HOST}/friends",
    )


def generate_showtime_notice_email(
    *,
    heading: str,
    movie_id: int,
    showtime_id: int,
    movie_title: str,
    poster_link: str | None,
    cinema_name: str,
    showtime_datetime_label: str,
) -> EmailData:
    """A generic branded notice about one showtime.

    Shared by every event type whose email is just "headline + movie card +
    view on MiKiNO" — interest reminders, a friend's manual nudge, and seat
    availability alerts.
    """
    return _generate_activity_notification_email(
        subject=heading,
        heading=heading,
        movie=_movie_context(
            title=movie_title,
            cinema_name=cinema_name,
            showtime_datetime_label=showtime_datetime_label,
            poster_link=poster_link,
        ),
        cta_label=f"View on {BRAND_NAME}",
        cta_link=_showtime_link(movie_id=movie_id, showtime_id=showtime_id),
    )


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
