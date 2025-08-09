import requests

from app.scraping.logger import logger


def get_letterboxd_slug(tmdb_id: int) -> str | None:
    url = f"https://letterboxd.com/tmdb/{tmdb_id}/"
    headers = {
        "referer": "https://letterboxd.com",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "allow-redirects": "true",
    }
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
    except requests.RequestException as e:
        logger.warning(
            f"Failed to fetch Letterboxd slug for TMDB ID {tmdb_id}. Error: {e}"
        )
        return None
    if response.status_code != 200:
        logger.warning(
            "Failed to fetch page for TMDB ID:",
            tmdb_id,
            "Status code:",
            response.status_code,
        )
        return None
    final_url = response.url
    slug = final_url.split("/")[-2]
    return slug
