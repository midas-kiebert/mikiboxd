"""Letterboxd member RSS feed — the cheap way to ask "anything new?".

`letterboxd.com/<user>/rss/` returns a member's recent activity as a single
small XML document. Measured 2026-07-28: it answers 200 while `/films/` and
`/films/page/N/` are returning 403 from the same host in the same minute, so it
is not behind the protection that throttles the poster-grid pages.

That makes it the right first request for a watched sync: one feed fetch
replaces a full paginated walk whenever nothing has changed, which is almost
always. It cannot replace the walk outright — the feed only carries recent
*diary entries*, so films marked watched without logging them, and anything
past the feed window, are invisible here. Callers must still do a periodic full
scrape (see `LETTERBOXD_WATCHED_FULL_RESYNC_DAYS`).
"""

import re
from time import perf_counter
from xml.etree import ElementTree

from . import logger
from .load_letterboxd_data import _fetch_page

# A member's own diary entry or review: letterboxd.com/<member>/film/<slug>/,
# optionally with the "/1/" suffix Letterboxd appends to a repeat viewing.
#
# The <member>/ segment is load-bearing, not decoration. The feed is roughly
# 40% list items, and a list's description embeds a link per film in it — but
# in the *canonical* form letterboxd.com/film/<slug>/, with no member segment.
# Requiring the segment is the entire reason a list of 200 films does not pour
# into the member's watched list. Do not "simplify" this to an optional group.
_MEMBER_FILM_LINK_PATTERN = re.compile(
    r"letterboxd\.com/[^/\s<]+/film/(?P<slug>[^/\s<]+)/",
)


def _slug_from_item_link(link: str | None) -> str | None:
    if not link:
        return None
    match = _MEMBER_FILM_LINK_PATTERN.search(link)
    return match.group("slug") if match else None


def extract_slugs_from_feed(feed_xml: str) -> list[str]:
    """Return the member's own film slugs, newest first, de-duplicated.

    Only each `<item>`'s `<link>` is considered. Scanning the whole document
    instead would also pick up member-form links appearing inside a review
    body (a member linking to someone else's entry for the film they are
    comparing against), which are not films this member watched.

    Falls back to a whole-document scan if the feed is not parseable as XML,
    since a malformed feed is still better than no incremental sync at all.
    """
    seen: set[str] = set()
    slugs: list[str] = []

    try:
        root = ElementTree.fromstring(feed_xml)
    except ElementTree.ParseError:
        logger.warning("Letterboxd feed is not valid XML; falling back to a text scan.")
        candidates = (
            match.group("slug")
            for match in _MEMBER_FILM_LINK_PATTERN.finditer(feed_xml)
        )
    else:
        candidates = (
            slug
            for item in root.iter("item")
            if (slug := _slug_from_item_link(item.findtext("link"))) is not None
        )

    for slug in candidates:
        if slug in seen:
            continue
        seen.add(slug)
        slugs.append(slug)
    return slugs


def get_recent_watched_slugs(username: str) -> list[str] | None:
    """Recent diary-entry slugs for a member, or None if the feed is unusable.

    None means "could not tell" (blocked, 404, transport error) and must be
    treated as no information — never as an empty feed, which would read as
    "this member has watched nothing".
    """
    url = f"https://letterboxd.com/{username}/rss/"
    start = perf_counter()
    # The cooldown is skipped deliberately: it exists for the poster-grid pages,
    # and the feed keeps answering 200 while those 403. Pacing and the request
    # budget still apply, so this cannot turn into a hammer.
    result = _fetch_page(url, ignore_challenge_block=True)
    if result.response is None:
        logger.info(
            "Letterboxd RSS unavailable for %s (status=%s blocked=%s not_found=%s).",
            username,
            result.status_code,
            result.blocked,
            result.not_found,
        )
        return None

    slugs = extract_slugs_from_feed(result.response.text)
    logger.info(
        "Fetched %s recent slugs from the Letterboxd feed for %s in %.2f seconds.",
        len(slugs),
        username,
        perf_counter() - start,
    )
    return slugs
