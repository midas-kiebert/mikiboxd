"""Which ticket links count as Eagerly, and under which host form.

Two separate rules, both of which used to be wrong in a way nothing caught:

* `/tickets/<number>` is not, on its own, an Eagerly link. It is an ordinary
  path shape, and two Cineville cinemas (AnnexCinema, De Sien) sell at it
  without running Eagerly at all. Matching them made `supports()` claim seat
  counts work at those cinemas, which the client shows as a seat-count block
  and an offer to go and read one — and every read 404s on the agenda feed.

* One Eagerly cinema reaches us under two host forms: our own scrapers build
  ticket links with the `www.`, Cineville hands out the bare domain. Both have
  to find the same booking host, or the cinema silently drops from an exact
  seat count to sold-out-or-not depending on which source won the dedupe.
"""

from app.scraping.seat_availability import (
    EAGERLY_BOOKING_HOSTS,
    EAGERLY_BOOKING_HOSTS_BY_CINEMA,
    EAGERLY_SITE_HOSTS,
    eagerly_booking_host,
    eagerly_site,
    supports,
)

# Both sell at `/tickets/<number>` and neither serves `/fk-feed/agenda`.
NOT_EAGERLY_TICKET_LINKS = (
    "https://www.annexcinema.nl/tickets/1767",
    "https://desienfilm.nl/tickets/11852941/",
)


def test_a_ticket_path_on_an_unknown_host_is_not_supported() -> None:
    for ticket_link in NOT_EAGERLY_TICKET_LINKS:
        assert supports(ticket_link) is False, ticket_link


def test_both_host_forms_of_an_eagerly_site_are_supported() -> None:
    assert supports("https://www.kinorotterdam.nl/tickets/131530") is True
    assert supports("https://kinorotterdam.nl/tickets/131530") is True


def test_both_host_forms_resolve_to_the_same_booking_host() -> None:
    """The regression itself: `www.` decided whether a seat map was read."""
    for netloc in ("www.hartlooper.nl", "hartlooper.nl"):
        assert EAGERLY_BOOKING_HOSTS[eagerly_site(netloc)] == "shop.hartlooper.nl"


def test_every_booking_host_belongs_to_a_known_eagerly_site() -> None:
    """The booking table is a subset of the sites the pattern admits — a site
    that isn't matched can never reach the lookup, so an entry only reachable
    that way is dead weight and a sign one of the two lists was edited alone."""
    assert set(EAGERLY_BOOKING_HOSTS) <= set(EAGERLY_SITE_HOSTS)


def test_site_hosts_are_stored_without_the_www() -> None:
    """Both tables are keyed on the normalised form; a `www.` entry would never
    be found, since every lookup goes through `eagerly_site` first."""
    for host in EAGERLY_SITE_HOSTS:
        assert eagerly_site(host) == host


def test_a_shared_site_picks_its_booking_host_by_cinema() -> None:
    """Bioscopen Leiden is the one site running several cinemas: all three sell
    from `bioscopenleiden.nl/tickets/…`, so the link's host cannot say which
    booking app holds the seat plan. The agenda feed's own `cinema_id` does,
    and it is already on the show entry the reading looks up."""
    assert supports("https://bioscopenleiden.nl/tickets/135430") is True
    assert "bioscopenleiden.nl" not in EAGERLY_BOOKING_HOSTS

    assert (
        eagerly_booking_host("bioscopenleiden.nl", "6")
        == "book.lido.bioscopenleiden.nl"
    )
    assert (
        eagerly_booking_host("bioscopenleiden.nl", "4")
        == "book.trianon.bioscopenleiden.nl"
    )
    assert (
        eagerly_booking_host("bioscopenleiden.nl", "5")
        == "book.kijkhuis.bioscopenleiden.nl"
    )


def test_a_shared_site_has_no_answer_without_a_cinema_id() -> None:
    """Falling back to the site-wide table would be worse than saying nothing:
    there is no site-wide answer, and guessing one would read another cinema's
    room and file its seat count against this screening."""
    assert eagerly_booking_host("bioscopenleiden.nl", None) is None
    assert eagerly_booking_host("bioscopenleiden.nl", "99") is None


def test_an_ordinary_site_ignores_the_cinema_id() -> None:
    """One booking app for the whole site: whatever the feed calls its cinema,
    the answer is the same."""
    for cinema_id in (None, "1", "42"):
        assert (
            eagerly_booking_host("filmhallen.nl", cinema_id) == "book.filmhallen.nl"
        )


def test_the_split_table_only_names_sites_the_pattern_admits() -> None:
    assert {site for site, _ in EAGERLY_BOOKING_HOSTS_BY_CINEMA} <= set(
        EAGERLY_SITE_HOSTS
    )
