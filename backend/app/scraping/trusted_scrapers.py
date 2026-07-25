"""Cinema scrapers whose own site is trusted over Cineville.

When a scraper listed here completes a healthy run (see
``scrape.py:_run_single_cinema_scraper``), any showtime Cineville reports for
that cinema but the site itself does not is treated as a Cineville false
positive: its Cineville presence is deactivated immediately instead of
waiting out the normal missing-streak grace period.

Only add a scraper once you're confident it reliably scrapes its cinema's
full upcoming schedule — a trusted scraper's own gaps or bugs will actively
delete showtimes that Cineville has right.
"""

TRUSTED_SCRAPERS: set[str] = {
    "LAB111Scraper",
}
