"""Send one example of each redesigned event-notification email to a real inbox,
and print the exact push title/body + email heading for every type as JSON.

Manual visual check for the notification.mjml redesign, and the source of truth
for the push-notification mockups in the report artifact — no database session
needed at send time, but the fixture showtimes below are real rows on prod
(picked so the CTA links actually resolve, and to cover every day-word branch:
tonight, tomorrow, a weekday name within the rolling week, and a plain date
past that window), and the titles are built through the same helpers
`push_notifications.py` uses, so what you see here matches a real send.

    cd backend && .venv/bin/python scripts/send_notification_email_examples.py you@example.com
"""

import json
import sys
from datetime import datetime

from app.core.config import settings
from app.core.enums import GoingStatus
from app.mailer import (
    EmailData,
    generate_friend_request_accepted_email,
    generate_friend_request_email,
    generate_friend_showtime_status_email,
    generate_invite_response_email,
    generate_showtime_notice_email,
    send_email,
)
from app.services.push_notifications import (
    _format_showtime_when,
    _relative_day_word,
    _showtime_subtitle,
    _status_verb_phrase,
)
from app.utils import now_amsterdam_naive

ACTOR_NAME = "Sam"

# Real prod showtimes (id, movie_id, movie_title, poster_link, cinema_name, datetime),
# one per day-word branch: tonight, tomorrow, a weekday name within the rolling
# week, and far enough out that the title carries no day word at all.
TONIGHT = (
    1920253,
    1600168,
    "Home",
    "https://a.ltrbxd.com/resized/film-poster/1/4/6/8/6/5/4/1468654-home-2026-0-230-0-345-crop.jpg?v=194ea60813",
    "Cinecitta",
    datetime(2026, 9, 9, 19, 0),
)
TOMORROW = (
    1922472,
    51857,
    "Cria!",
    "https://a.ltrbxd.com/resized/film-poster/1/3/9/9/1/13991-cria--0-230-0-345-crop.jpg?v=e040a4f888",
    "KINO",
    datetime(2026, 9, 10, 10, 0),
)
THIS_WEEK = (
    1913968,
    935,
    "Dr. Strangelove or: How I Learned to Stop Worrying and Love the Bomb",
    "https://a.ltrbxd.com/resized/film-poster/5/1/2/1/8/51218-dr-strangelove-or-how-i-learned-to-stop-worrying-and-love--0-230-0-345-crop.jpg?v=c814dfbae0",
    "LAB111",
    datetime(2026, 9, 13, 10, 0),
)
FAR_FUTURE = (
    1920487,
    8337,
    "They Live",
    "https://a.ltrbxd.com/resized/film-poster/4/7/7/9/8/47798-they-live-0-230-0-345-crop.jpg?v=816bf826a0",
    "LAB111",
    datetime(2026, 9, 19, 10, 0),
)


def _example(
    name: str,
    *,
    push_title: str,
    push_body: str,
    email_data: EmailData,
) -> dict:
    return {
        "type": name,
        "push_title": push_title,
        "push_body": push_body,
        "email_subject": email_data.subject,
        "email_data": email_data,
    }


def _build_examples(now: datetime) -> list[dict]:
    _, movie_id, movie_title, poster_link, cinema_name, dt = TONIGHT
    match_title = (
        f"{ACTOR_NAME} is {_status_verb_phrase(GoingStatus.GOING)} {movie_title}"
    )
    day_word = _relative_day_word(dt, now)
    if day_word:
        match_title = f"{match_title} {day_word}"
    match_body = _showtime_subtitle(cinema_name=cinema_name, dt=dt)

    showtime_id, ping_movie_id, ping_title, ping_poster, ping_cinema, ping_dt = TONIGHT
    ping_when = _format_showtime_when(ping_dt, now)
    ping_title_full = (
        f"{ACTOR_NAME} invited you to {ping_title} {ping_when} in {ping_cinema}"
    )

    (
        removed_showtime_id,
        removed_movie_id,
        removed_title,
        removed_poster,
        removed_cinema,
        removed_dt,
    ) = TOMORROW
    removed_title_full = f"{ACTOR_NAME} is no longer going to {removed_title}"
    removed_day_word = _relative_day_word(removed_dt, now)
    if removed_day_word:
        removed_title_full = f"{removed_title_full} {removed_day_word}"
    removed_body = _showtime_subtitle(cinema_name=removed_cinema, dt=removed_dt)

    resp_showtime_id, resp_movie_id, resp_title, resp_poster, resp_cinema, resp_dt = (
        THIS_WEEK
    )
    response_title = (
        f"{ACTOR_NAME} is {_status_verb_phrase(GoingStatus.INTERESTED)} {resp_title}"
    )
    resp_day_word = _relative_day_word(resp_dt, now)
    if resp_day_word:
        response_title = f"{response_title} {resp_day_word}"
    response_body = _showtime_subtitle(cinema_name=resp_cinema, dt=resp_dt)

    rem_showtime_id, rem_movie_id, rem_title, rem_poster, rem_cinema, rem_dt = TOMORROW
    rem_day_word = _relative_day_word(rem_dt, now)
    reminder_title = (
        f"Are you still interested in {rem_title} {rem_day_word}?"
        if rem_day_word
        else f"Are you still interested in {rem_title}?"
    )
    reminder_body = _showtime_subtitle(cinema_name=rem_cinema, dt=rem_dt)

    (
        nudge_showtime_id,
        nudge_movie_id,
        nudge_title,
        nudge_poster,
        nudge_cinema,
        nudge_dt,
    ) = FAR_FUTURE
    nudge_title_full = f"{ACTOR_NAME} sent you a reminder about {nudge_title}"
    nudge_day_word = _relative_day_word(nudge_dt, now)
    if nudge_day_word:
        nudge_title_full = f"{nudge_title_full} {nudge_day_word}"
    nudge_body = _showtime_subtitle(cinema_name=nudge_cinema, dt=nudge_dt)

    seat_showtime_id, seat_movie_id, seat_title, seat_poster, seat_cinema, seat_dt = (
        TONIGHT
    )
    seat_title_full = f"{seat_title} is nearly sold out"
    seat_day_word = _relative_day_word(seat_dt, now)
    if seat_day_word:
        seat_title_full = f"{seat_title_full} {seat_day_word}"
    seat_body = _showtime_subtitle(cinema_name=seat_cinema, dt=seat_dt)

    return [
        _example(
            "friend_showtime_match",
            push_title=match_title,
            push_body=match_body,
            email_data=generate_friend_showtime_status_email(
                heading=match_title,
                movie_id=movie_id,
                showtime_id=showtime_id,
                movie_title=movie_title,
                poster_link=poster_link,
                cinema_name=cinema_name,
                showtime_datetime_label=dt.strftime("%a, %b %d at %H:%M"),
            ),
        ),
        _example(
            "showtime_status_removed",
            push_title=removed_title_full,
            push_body=removed_body,
            email_data=generate_friend_showtime_status_email(
                heading=removed_title_full,
                movie_id=removed_movie_id,
                showtime_id=removed_showtime_id,
                movie_title=removed_title,
                poster_link=removed_poster,
                cinema_name=removed_cinema,
                showtime_datetime_label=removed_dt.strftime("%a, %b %d at %H:%M"),
            ),
        ),
        _example(
            "invite_response",
            push_title=response_title,
            push_body=response_body,
            email_data=generate_invite_response_email(
                heading=response_title,
                movie_id=resp_movie_id,
                showtime_id=resp_showtime_id,
                movie_title=resp_title,
                poster_link=resp_poster,
                cinema_name=resp_cinema,
                showtime_datetime_label=resp_dt.strftime("%a, %b %d at %H:%M"),
            ),
        ),
        _example(
            "showtime_ping",
            push_title=ping_title_full,
            push_body="Tap to respond",
            email_data=generate_showtime_notice_email(
                heading=ping_title_full,
                movie_id=ping_movie_id,
                showtime_id=showtime_id,
                movie_title=ping_title,
                poster_link=ping_poster,
                cinema_name=ping_cinema,
                showtime_datetime_label=ping_dt.strftime("%a, %b %d at %H:%M"),
            ),
        ),
        _example(
            "friend_request",
            push_title=f"{ACTOR_NAME} sent you a friend request",
            push_body="",
            email_data=generate_friend_request_email(
                heading=f"{ACTOR_NAME} sent you a friend request"
            ),
        ),
        _example(
            "friend_request_accepted",
            push_title=f"{ACTOR_NAME} accepted your friend request",
            push_body="",
            email_data=generate_friend_request_accepted_email(
                heading=f"{ACTOR_NAME} accepted your friend request"
            ),
        ),
        _example(
            "interest_reminder",
            push_title=reminder_title,
            push_body=reminder_body,
            email_data=generate_showtime_notice_email(
                heading=reminder_title,
                movie_id=rem_movie_id,
                showtime_id=rem_showtime_id,
                movie_title=rem_title,
                poster_link=rem_poster,
                cinema_name=rem_cinema,
                showtime_datetime_label=rem_dt.strftime("%a, %b %d at %H:%M"),
            ),
        ),
        _example(
            "showtime_reminder",
            push_title=nudge_title_full,
            push_body=nudge_body,
            email_data=generate_showtime_notice_email(
                heading=nudge_title_full,
                movie_id=nudge_movie_id,
                showtime_id=nudge_showtime_id,
                movie_title=nudge_title,
                poster_link=nudge_poster,
                cinema_name=nudge_cinema,
                showtime_datetime_label=nudge_dt.strftime("%a, %b %d at %H:%M"),
            ),
        ),
        _example(
            "seats_running_out",
            push_title=seat_title_full,
            push_body=seat_body,
            email_data=generate_showtime_notice_email(
                heading=seat_title_full,
                movie_id=seat_movie_id,
                showtime_id=seat_showtime_id,
                movie_title=seat_title,
                poster_link=seat_poster,
                cinema_name=seat_cinema,
                showtime_datetime_label=seat_dt.strftime("%a, %b %d at %H:%M"),
            ),
        ),
    ]


def main() -> None:
    if len(sys.argv) != 2:
        print(__doc__)
        raise SystemExit(1)
    email_to = sys.argv[1]

    if not settings.emails_enabled:
        raise SystemExit("SMTP is not configured (SMTP_HOST / EMAILS_FROM_EMAIL).")

    settings.FRONTEND_HOST = "https://mikino.nl"

    now = now_amsterdam_naive()
    examples = _build_examples(now)
    for example in examples:
        send_email(
            email_to=email_to,
            subject=example["email_data"].subject,
            html_content=example["email_data"].html_content,
        )
        print(
            f"sent: {example['type']} — {example['email_subject']!r}", file=sys.stderr
        )

    print(
        json.dumps(
            [
                {
                    "type": e["type"],
                    "push_title": e["push_title"],
                    "push_body": e["push_body"],
                    "email_subject": e["email_subject"],
                }
                for e in examples
            ],
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
