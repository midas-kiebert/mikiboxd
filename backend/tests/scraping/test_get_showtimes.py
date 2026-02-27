from app.scraping import get_showtimes


def test_parse_showtimes_response_reads_end_date_and_subtitles_from_attributes() -> None:
    response_json = {
        "_embedded": {
            "events": [
                {
                    "id": "event-1",
                    "startDate": "2026-03-02T18:00:00.000Z",
                    "endDate": "2026-03-02T19:58:00.000Z",
                    "ticketingUrl": "https://tickets.example.com/abc?utm_source=x",
                    "_embedded": {"venue": {"name": "Filmhuis Den Haag"}},
                    "attributes": {"subtitles": ["en"]},
                }
            ]
        }
    }

    parsed = get_showtimes._parse_showtimes_response(
        response_json=response_json,
        productionId="prod-1",
    )

    assert len(parsed) == 1
    assert parsed[0].id == "event-1"
    assert parsed[0].endDate == "2026-03-02T19:58:00.000Z"
    assert parsed[0].subtitles == ["en"]
    assert parsed[0].ticketUrl == "https://tickets.example.com/abc"


def test_parse_showtimes_response_prefers_top_level_subtitles_when_present() -> None:
    response_json = {
        "_embedded": {
            "events": [
                {
                    "id": "event-2",
                    "startDate": "2026-03-03T18:00:00.000Z",
                    "endDate": None,
                    "ticketingUrl": None,
                    "_embedded": {"venue": {"name": "Eye"}},
                    "attributes": {"subtitles": ["nl"]},
                    "subtitles": ["en"],
                }
            ]
        }
    }

    parsed = get_showtimes._parse_showtimes_response(
        response_json=response_json,
        productionId="prod-2",
    )

    assert len(parsed) == 1
    assert parsed[0].subtitles == ["en"]
