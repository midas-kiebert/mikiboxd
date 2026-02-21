from app.scraping.letterboxd import load_letterboxd_data as letterboxd


def _clear_letterboxd_runtime_state() -> None:
    letterboxd.reset_letterboxd_request_budget()
    with letterboxd._letterboxd_failure_audit_lock:
        letterboxd._letterboxd_failure_audit_events.clear()
    with letterboxd._letterboxd_challenge_block_lock:
        letterboxd._letterboxd_challenge_block_until = 0.0
        letterboxd._letterboxd_challenge_logged_until = 0.0
        letterboxd._letterboxd_challenge_reason = None


def test_fetch_page_retries_403_with_session_refresh(monkeypatch) -> None:
    _clear_letterboxd_runtime_state()

    url = "https://letterboxd.com/tmdb/655424/"
    responses = iter(
        [
            letterboxd.CurlResponse(
                url=url,
                text="Access denied",
                status_code=403,
                headers={
                    "server": "cloudflare",
                    "cf-ray": "abc123",
                },
            ),
            letterboxd.CurlResponse(
                url="https://letterboxd.com/",
                text="<html>ok</html>",
                status_code=200,
                headers={"server": "cloudflare"},
            ),
            letterboxd.CurlResponse(
                url="https://letterboxd.com/film/the-snail-and-the-whale/",
                text="<html>ok</html>",
                status_code=200,
                headers={"server": "cloudflare"},
            ),
        ]
    )

    monkeypatch.setattr(letterboxd, "LETTERBOXD_HTTP_RETRIES", 1)
    monkeypatch.setattr(letterboxd, "LETTERBOXD_HTTP_403_RETRY_ATTEMPTS", 1)
    monkeypatch.setattr(letterboxd, "_retry_delay", lambda _attempt: 0.0)
    monkeypatch.setattr(letterboxd.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(letterboxd, "_consume_request_budget", lambda _url: True)
    monkeypatch.setattr(letterboxd, "_persist_challenge_block_state", lambda **_kwargs: None)
    monkeypatch.setattr(
        letterboxd,
        "_perform_rate_limited_sync_request",
        lambda *, url, transport: next(responses),
    )

    result = letterboxd._fetch_page(url)

    assert result.response is not None
    assert result.status_code == 200

    failures = letterboxd.consume_letterboxd_failure_events()
    assert any(failure["event_type"] == "http_403_observed" for failure in failures)
    assert not any(failure["event_type"] == "http_403_streak_block" for failure in failures)


def test_fetch_page_blocks_after_repeated_403(monkeypatch) -> None:
    _clear_letterboxd_runtime_state()

    url = "https://letterboxd.com/tmdb/697064/"
    responses = iter(
        [
            letterboxd.CurlResponse(
                url=url,
                text="Access denied",
                status_code=403,
                headers={
                    "server": "cloudflare",
                    "cf-ray": "first-ray",
                },
            ),
            letterboxd.CurlResponse(
                url="https://letterboxd.com/",
                text="<html>ok</html>",
                status_code=200,
                headers={"server": "cloudflare"},
            ),
            letterboxd.CurlResponse(
                url=url,
                text="Access denied",
                status_code=403,
                headers={
                    "server": "cloudflare",
                    "cf-ray": "second-ray",
                },
            ),
        ]
    )

    monkeypatch.setattr(letterboxd, "LETTERBOXD_HTTP_RETRIES", 1)
    monkeypatch.setattr(letterboxd, "LETTERBOXD_HTTP_403_RETRY_ATTEMPTS", 1)
    monkeypatch.setattr(letterboxd, "LETTERBOXD_HTTP_403_STREAK_BLOCK_THRESHOLD", 2)
    monkeypatch.setattr(letterboxd, "_retry_delay", lambda _attempt: 0.0)
    monkeypatch.setattr(letterboxd.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(letterboxd, "_consume_request_budget", lambda _url: True)
    monkeypatch.setattr(letterboxd, "_persist_challenge_block_state", lambda **_kwargs: None)
    monkeypatch.setattr(
        letterboxd,
        "_perform_rate_limited_sync_request",
        lambda *, url, transport: next(responses),
    )

    result = letterboxd._fetch_page(url)

    assert result.response is None
    assert result.status_code == 403
    assert result.blocked is True

    failures = letterboxd.consume_letterboxd_failure_events()
    assert any(failure["event_type"] == "http_403_observed" for failure in failures)
    assert any(failure["event_type"] == "http_403_streak_block" for failure in failures)
