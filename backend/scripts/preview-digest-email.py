"""Render the watchlist digest email to a browsable page, without sending one.

The digest is hard to eyeball otherwise: it only goes out on a scheduler tick,
and its wording branches on frequency and on whether the films came from a
Letterboxd watchlist or a list the user picked. This renders every combination
side by side, through the real `generate_watchlist_digest_email`, so what you
see is what a real send produces — subject line included.

    python scripts/preview-digest-email.py
    python scripts/preview-digest-email.py --out ~/digest.html

No database is touched. The film data is fixture data below; the Movie and
Showtime stand-ins only need the attributes the mailer reads, so real ORM rows
are unnecessary. Fixtures deliberately include a film with no poster and one
with no Letterboxd slug, since both columns are nullable and each drops part of
a row.
"""

import argparse
import html
import webbrowser
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from app.core.enums import DigestFrequency
from app.mailer import DigestSource, EmailData, generate_watchlist_digest_email

DEFAULT_OUT = Path("/tmp/mikino-digest-preview.html")
TMDB_POSTER_BASE = "https://image.tmdb.org/t/p/w154"


@dataclass
class _FakeCinema:
    name: str


@dataclass
class _FakeShowtime:
    cinema: _FakeCinema
    datetime: datetime


@dataclass
class _FakeMovie:
    id: int
    title: str
    poster_link: str | None
    letterboxd_slug: str | None


def _film(
    movie_id: int,
    title: str,
    cinema: str,
    days_out: int,
    hour: int,
    *,
    poster: str | None = None,
    slug: str | None = None,
) -> tuple[Any, Any]:
    when = (datetime.now() + timedelta(days=days_out)).replace(
        hour=hour, minute=15, second=0, microsecond=0
    )
    movie = _FakeMovie(
        id=movie_id,
        title=title,
        poster_link=f"{TMDB_POSTER_BASE}{poster}" if poster else None,
        letterboxd_slug=slug,
    )
    return movie, _FakeShowtime(cinema=_FakeCinema(name=cinema), datetime=when)


CATALOGUE: list[tuple[Any, Any]] = [
    _film(
        101, "Aftersun", "Kriterion", 1, 20,
        poster="/dPCswmsCsW7ffgHl2mtdqiYFqfC.jpg", slug="aftersun",
    ),
    # No Letterboxd slug: that row renders with the MiKiNO link alone.
    _film(
        102, "Perfect Days", "LAB111", 2, 19,
        poster="/cQjXQrTLLpgL4TVsdIVFtVQNaOG.jpg",
    ),
    _film(
        103, "The Zone of Interest", "Eye Filmmuseum", 3, 16,
        poster="/hUu9zyZmDd8VZegKi1iK1Vk0RYS.jpg", slug="the-zone-of-interest",
    ),
    # No poster: that row falls back to text only.
    _film(104, "Petite Maman", "Filmhuis Cavia", 4, 21, slug="petite-maman"),
    _film(
        105, "Drive My Car", "Rialto De Pijp", 6, 18,
        poster="/tOO0Wgh1U0Y4mznAQxLcTOSSg6t.jpg", slug="drive-my-car",
    ),
]

WATCHLIST = DigestSource(
    label="your Letterboxd watchlist",
    url="https://letterboxd.com/midas/watchlist/",
    frequency=DigestFrequency.WEEKLY_OR_URGENT,
    cinemas_label="All cinemas",
)
WATCHLIST_DAILY = DigestSource(
    label="your Letterboxd watchlist",
    url="https://letterboxd.com/midas/watchlist/",
    frequency=DigestFrequency.DAILY,
    cinemas_label="My Cinemas",
)
CHOSEN_LIST = DigestSource(
    label="the Letterboxd list “Slow Cinema, Fast Food”",
    url="https://letterboxd.com/midas/list/slow-cinema-fast-food/",
    frequency=DigestFrequency.WEEKLY_OR_URGENT,
    cinemas_label="All cinemas",
)
CHOSEN_LIST_DAILY = DigestSource(
    label="the Letterboxd list “Slow Cinema, Fast Food”",
    url="https://letterboxd.com/midas/list/slow-cinema-fast-food/",
    frequency=DigestFrequency.DAILY,
    cinemas_label="3 custom cinemas",
)
# A list the user picked whose row has since been deleted: still named, no link.
DELETED_LIST = DigestSource(
    label="the Letterboxd list you chose",
    url=None,
    frequency=DigestFrequency.WEEKLY_OR_URGENT,
    cinemas_label="All cinemas",
)

CASES: list[tuple[str, list[DigestSource], int, str]] = [
    (
        "Weekly", [WATCHLIST], 3,
        "The default: films from your Letterboxd watchlist.",
    ),
    (
        "Weekly", [CHOSEN_LIST], 5,
        "Same mode following a chosen list — the footer links the list, not the "
        "watchlist. “Petite Maman” has no poster.",
    ),
    (
        "Eager", [WATCHLIST_DAILY], 1,
        "Eager, one film. The subject claims no timeframe and the explainer "
        "line changes with the mode.",
    ),
    (
        "Eager", [CHOSEN_LIST_DAILY], 3,
        "Eager following a list. “Perfect Days” has no Letterboxd slug.",
    ),
    (
        "Weekly", [DELETED_LIST], 2,
        "Edge case: the chosen list row was deleted, so it is named but not linked.",
    ),
    (
        "Combined", [WATCHLIST_DAILY, CHOSEN_LIST], 5,
        "Two sources due the same day, combined into a single email: one footer "
        "line per source, each with its own cadence and explainer.",
    ),
]

PAGE_CSS = """
  :root { --bg:#f4f6f5; --fg:#16211f; --muted:#5f706c; --card:#fff;
          --line:#dfe6e3; --accent:#0b6e64; }
  @media (prefers-color-scheme: dark) {
    :root { --bg:#0f1513; --fg:#e8efec; --muted:#95a5a1; --card:#18201e;
            --line:#2a3532; --accent:#4fd1c0; }
  }
  * { box-sizing:border-box; }
  body { margin:0; padding:28px 20px 60px; background:var(--bg); color:var(--fg);
    font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  .wrap { max-width:760px; margin:0 auto; }
  h1 { font-size:22px; margin:0 0 6px; }
  h2 { font-size:16px; margin:32px 0 8px; }
  .lede { color:var(--muted); margin:0 0 28px; }
  .case { background:var(--card); border:1px solid var(--line); border-radius:12px;
    padding:16px; margin-bottom:22px; }
  .tag { display:inline-block; font-size:11px; font-weight:700; letter-spacing:.08em;
    text-transform:uppercase; padding:3px 8px; border-radius:5px; color:#fff;
    background:var(--accent); }
  .tag.eager { background:#8a5a1f; }
  .note { color:var(--muted); font-size:13.5px; margin:10px 0 12px; }
  .hdr { border:1px solid var(--line); border-radius:8px; padding:10px 12px;
    margin-bottom:12px; }
  .row { display:flex; gap:12px; padding:2px 0; }
  .k { flex:0 0 62px; color:var(--muted); font-size:12.5px; text-transform:uppercase;
    letter-spacing:.05em; }
  .v { font-size:14px; word-break:break-word; }
  .subj { font-weight:650; }
  iframe { width:100%; border:1px solid var(--line); border-radius:8px;
    background:#fff; display:block; }
  pre { background:var(--card); border:1px solid var(--line); border-radius:12px;
    padding:16px; overflow-x:auto; font-size:13px; line-height:1.5; white-space:pre; }
"""


def _render_case(
    *, email: EmailData, label: str, note: str, film_count: int
) -> str:
    """One case: the headers a client would show, then the body in an iframe."""
    # srcdoc rather than a data: URI so the email HTML stays readable in devtools.
    return f"""
    <section class="case">
      <div class="tag {label.lower()}">{label}</div>
      <p class="note">{html.escape(note)}</p>
      <div class="hdr">
        <div class="row"><span class="k">From</span>
          <span class="v">MiKiNO &lt;info@mikino.nl&gt;</span></div>
        <div class="row"><span class="k">Subject</span>
          <span class="v subj">{html.escape(email.subject)}</span></div>
      </div>
      <iframe style="height:{200 + film_count * 118}px"
        title="{html.escape(email.subject)}"
        srcdoc="{html.escape(email.html_content, quote=True)}"></iframe>
    </section>"""


def build_page() -> str:
    cases: list[str] = []
    plain_sample = ""
    for label, sources, film_count, note in CASES:
        email = generate_watchlist_digest_email(
            email_to="preview@mikino.nl",
            movie_entries=CATALOGUE[:film_count],
            sources=sources,
            now=datetime.now(),
        )
        if not plain_sample:
            plain_sample = email.text_content
        cases.append(
            _render_case(
                email=email,
                label=label,
                note=note,
                film_count=film_count,
            )
        )
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Watchlist digest previews</title>
<style>{PAGE_CSS}</style></head>
<body><div class="wrap">
  <h1>Watchlist digest &mdash; rendered previews</h1>
  <p class="lede">Generated by <code>scripts/preview-digest-email.py</code> through the
  real <code>generate_watchlist_digest_email</code>. Fixture films, real wording.</p>
  {"".join(cases)}
  <h2>The text/plain half</h2>
  <pre>{html.escape(plain_sample)}</pre>
</div></body></html>"""


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--out", type=Path, default=DEFAULT_OUT, help=f"output path ({DEFAULT_OUT})"
    )
    parser.add_argument(
        "--open", action="store_true", help="open the page in a browser when done"
    )
    args = parser.parse_args()

    args.out.write_text(build_page())
    print(f"Wrote {args.out}")
    if args.open:
        webbrowser.open(args.out.resolve().as_uri())


if __name__ == "__main__":
    main()
