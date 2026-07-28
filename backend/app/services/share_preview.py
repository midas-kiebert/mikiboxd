"""Shared HTML rendering for public, unauthenticated share-preview pages.

Used by link-preview crawlers (WhatsApp, iMessage, Slack, ...) that nginx
routes here based on User-Agent, since the SPA's static index.html can't
carry per-showtime/per-movie OpenGraph tags.
"""

import html

from app.core.config import settings

DEFAULT_SHARE_PREVIEW_IMAGE = f"{settings.FRONTEND_HOST}/assets/images/mikino-logo.png"


def render_share_preview_html(
    *, title: str, description: str, image_url: str, page_url: str
) -> str:
    escaped_title = html.escape(title)
    escaped_description = html.escape(description)
    escaped_image_url = html.escape(image_url)
    escaped_page_url = html.escape(page_url)

    return f"""<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta property="og:type" content="website" />
    <meta property="og:url" content="{escaped_page_url}" />
    <meta property="og:title" content="{escaped_title}" />
    <meta property="og:description" content="{escaped_description}" />
    <meta property="og:image" content="{escaped_image_url}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{escaped_title}" />
    <meta name="twitter:description" content="{escaped_description}" />
    <meta name="twitter:image" content="{escaped_image_url}" />
    <title>{escaped_title}</title>
  </head>
  <body></body>
</html>"""
