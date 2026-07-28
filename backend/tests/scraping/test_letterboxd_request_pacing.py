"""Cross-process pacing and block-cooldown behaviour of the Letterboxd fetcher.

Regression tests for the block-amplification bug: the API container runs 4
uvicorn workers and the scheduler is a separate process, but the request
interval and the challenge cooldown were both process-local. One worker getting
403'd blocked only itself while the rest kept firing, and the configured
"1 request per second" was really up to 5.
"""

import json
import os
import time

import pytest

from app.scraping.letterboxd import load_letterboxd_data as letterboxd


@pytest.fixture(autouse=True)
def _clean_runtime_state():
    letterboxd.reset_letterboxd_request_budget()
    letterboxd.reset_letterboxd_block_state()
    yield
    letterboxd.reset_letterboxd_block_state()


def _response(status_code: int, headers: dict[str, str] | None = None):
    return letterboxd.CurlResponse(
        url="https://letterboxd.com/u/films/",
        text="Access denied",
        status_code=status_code,
        headers={"server": "cloudflare", **(headers or {})},
    )


def test_pacing_reservation_is_shared_between_processes(monkeypatch):
    # The reservation lives in a file, so a second process (simulated here by
    # resetting the in-process clock) still waits for the slot the first took.
    monkeypatch.setattr(letterboxd, "LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS", 2.0)
    monkeypatch.setattr(letterboxd, "LETTERBOXD_REQUEST_INTERVAL_JITTER_SECONDS", 0.0)

    first_wait = letterboxd._reserve_request_slot_across_processes()
    second_wait = letterboxd._reserve_request_slot_across_processes()

    assert first_wait == 0.0
    # Whoever asks next has to wait out the interval, whichever process it is.
    assert 1.0 < second_wait <= 2.0


def test_pacing_state_survives_a_corrupt_file(monkeypatch):
    monkeypatch.setattr(letterboxd, "LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS", 1.0)
    monkeypatch.setattr(letterboxd, "LETTERBOXD_REQUEST_INTERVAL_JITTER_SECONDS", 0.0)
    with open(letterboxd.LETTERBOXD_PACING_STATE_FILE, "w", encoding="utf-8") as fp:
        fp.write("not-a-number")

    assert letterboxd._reserve_request_slot_across_processes() == 0.0


def test_pacing_ignores_an_absurd_future_reservation(monkeypatch):
    # A clock jump or a bad write must not park every Letterboxd request for
    # the rest of the day.
    monkeypatch.setattr(letterboxd, "LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS", 1.0)
    monkeypatch.setattr(letterboxd, "LETTERBOXD_REQUEST_INTERVAL_JITTER_SECONDS", 0.0)
    monkeypatch.setattr(letterboxd, "LETTERBOXD_CF_BLOCK_MAX_SECONDS", 3600.0)
    with open(letterboxd.LETTERBOXD_PACING_STATE_FILE, "w", encoding="utf-8") as fp:
        fp.write(str(time.time() + 86_400))

    assert letterboxd._reserve_request_slot_across_processes() == 0.0


def test_interval_jitter_varies_between_requests(monkeypatch):
    monkeypatch.setattr(letterboxd, "LETTERBOXD_MIN_REQUEST_INTERVAL_SECONDS", 1.0)
    monkeypatch.setattr(letterboxd, "LETTERBOXD_REQUEST_INTERVAL_JITTER_SECONDS", 0.5)

    intervals = {letterboxd._next_request_interval() for _ in range(20)}

    assert len(intervals) > 1, "exactly-spaced requests are a machine signature"
    assert all(1.0 <= interval <= 1.5 for interval in intervals)


def test_fetch_page_picks_up_a_cooldown_started_by_another_process(monkeypatch):
    # Simulate another worker writing the block file, then confirm this process
    # stops fetching without having to be 403'd itself.
    monkeypatch.setattr(letterboxd, "_consume_request_budget", lambda _url: True)
    monkeypatch.setattr(
        letterboxd,
        "_perform_rate_limited_sync_request",
        lambda *, url, transport: pytest.fail("should not reach the network"),
    )
    with open(letterboxd.LETTERBOXD_BLOCK_STATE_FILE, "w", encoding="utf-8") as fp:
        json.dump(
            {"block_until_unix": time.time() + 600, "reason": "http_403_block"}, fp
        )
    # Ensure the mtime is newer than the marker recorded at reset.
    os.utime(letterboxd.LETTERBOXD_BLOCK_STATE_FILE, None)

    result = letterboxd._fetch_page("https://letterboxd.com/u/films/")

    assert result.blocked is True
    assert result.response is None


def test_rss_style_fetches_may_ignore_the_cooldown(monkeypatch):
    # The member feed keeps answering 200 while the poster-grid pages 403, so
    # it is allowed through the cooldown that exists for those pages.
    monkeypatch.setattr(letterboxd, "_consume_request_budget", lambda _url: True)
    monkeypatch.setattr(
        letterboxd,
        "_perform_rate_limited_sync_request",
        lambda *, url, transport: letterboxd.CurlResponse(
            url=url, text="<rss/>", status_code=200, headers={}
        ),
    )
    letterboxd._set_challenge_block(reason="http_403_block")

    blocked = letterboxd._fetch_page("https://letterboxd.com/u/films/")
    allowed = letterboxd._fetch_page(
        "https://letterboxd.com/u/rss/", ignore_challenge_block=True
    )

    assert blocked.blocked is True
    assert allowed.status_code == 200


def test_retry_after_header_sets_the_cooldown_length(monkeypatch):
    monkeypatch.setattr(letterboxd, "LETTERBOXD_CF_BLOCK_SECONDS", 900.0)
    monkeypatch.setattr(letterboxd, "LETTERBOXD_CF_BLOCK_MAX_SECONDS", 3600.0)

    seconds = letterboxd._parse_retry_after_seconds(_response(429, {"retry-after": "45"}))

    assert seconds == 45.0


def test_retry_after_is_clamped_and_bad_values_ignored(monkeypatch):
    monkeypatch.setattr(letterboxd, "LETTERBOXD_CF_BLOCK_MAX_SECONDS", 3600.0)

    assert letterboxd._parse_retry_after_seconds(_response(429, {"retry-after": "99999"})) == 3600.0
    assert letterboxd._parse_retry_after_seconds(_response(429, {"retry-after": "soon"})) is None
    assert letterboxd._parse_retry_after_seconds(_response(429, {"retry-after": "0"})) is None
    assert letterboxd._parse_retry_after_seconds(_response(429)) is None


def test_repeated_blocks_escalate_then_reset_on_success(monkeypatch):
    monkeypatch.setattr(letterboxd, "LETTERBOXD_CF_BLOCK_SECONDS", 100.0)
    monkeypatch.setattr(letterboxd, "LETTERBOXD_CF_BLOCK_MAX_SECONDS", 300.0)

    assert letterboxd._block_duration_seconds(None) == 100.0
    assert letterboxd._block_duration_seconds(None) == 200.0
    # Capped, so a streak cannot park us indefinitely.
    assert letterboxd._block_duration_seconds(None) == 300.0
    assert letterboxd._block_duration_seconds(None) == 300.0

    # Letterboxd answering again restarts the escalation from the base value.
    letterboxd._record_real_outbound_request_success(
        url="https://letterboxd.com/u/rss/", transport="sync"
    )

    assert letterboxd._block_duration_seconds(None) == 100.0


def test_retry_after_wins_over_escalation(monkeypatch):
    monkeypatch.setattr(letterboxd, "LETTERBOXD_CF_BLOCK_SECONDS", 100.0)
    monkeypatch.setattr(letterboxd, "LETTERBOXD_CF_BLOCK_MAX_SECONDS", 3600.0)

    letterboxd._block_duration_seconds(None)
    letterboxd._block_duration_seconds(None)

    assert letterboxd._block_duration_seconds(30.0) == 30.0
