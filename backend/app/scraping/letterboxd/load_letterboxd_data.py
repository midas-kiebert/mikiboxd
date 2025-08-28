import requests
from bs4 import BeautifulSoup, Tag
from pydantic import BaseModel
from requests import Response

from app.exceptions import scraper_exceptions
from app.scraping.logger import logger


class LetterboxdMovieData(BaseModel):
    slug: str
    poster_url: str | None
    title: str
    original_title: str | None
    release_year: int | None
    directors: list[str]
    rating: float | None = None
    top250: int | None = None


def get_page(url: str) -> Response | None:
    headers = {
        "referer": "https://letterboxd.com",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "allow-redirects": "true",
    }
    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
    except requests.RequestException as e:
        logger.warning(f"Failed to load page {url}. Error: {e}")
        return None
    if response.status_code != 200:
        logger.warning(
            "Failed to fetch page:",
            url,
            "Status code:",
            response.status_code,
        )
        return None
    return response


def get_letterboxd_page(tmdb_id: int) -> Response | None:
    url = f"https://letterboxd.com/tmdb/{tmdb_id}/"
    return get_page(url)


def parse_page(response: Response) -> BeautifulSoup:
    return BeautifulSoup(response.text, "lxml")


def get_slug(response: Response) -> str:
    final_url = response.url
    slug = final_url.split("/")[-2]
    return slug


def get_poster_url(slug: str) -> str | None:
    url = f"https://letterboxd.com/film/{slug}/poster/std/230/"
    response = get_page(url)
    if response is None:
        return None
    json = response.json()
    if not isinstance(json, dict):
        raise scraper_exceptions.ScraperStructureError()
    return json.get("url")


def get_english_title(page: BeautifulSoup) -> str:
    title_tag = page.find("h1", class_="primaryname")
    if not isinstance(title_tag, Tag):
        raise scraper_exceptions.ScraperStructureError()
    span = title_tag.find("span", class_="name")
    if not isinstance(span, Tag):
        raise scraper_exceptions.ScraperStructureError()
    title_text = span.text
    if not isinstance(title_text, str):
        raise scraper_exceptions.ScraperStructureError()
    return title_text.strip()


def get_original_title(page: BeautifulSoup) -> str | None:
    original_title_tag = page.find("h2", class_="originalname")
    if not original_title_tag:
        return None
    if not isinstance(original_title_tag, Tag):
        raise scraper_exceptions.ScraperStructureError()
    em = original_title_tag.find("em")
    if not isinstance(em, Tag):
        raise scraper_exceptions.ScraperStructureError()
    original_title_text = em.text
    if not isinstance(original_title_text, str):
        raise scraper_exceptions.ScraperStructureError()
    return original_title_text.strip()


def get_year(page: BeautifulSoup) -> int | None:
    year_tag = page.find("span", class_="releasedate")
    if year_tag is None:
        return None
    if not isinstance(year_tag, Tag):
        raise scraper_exceptions.ScraperStructureError()
    a = year_tag.find("a")
    if not isinstance(a, Tag):
        raise scraper_exceptions.ScraperStructureError()
    year_text = a.text
    if not isinstance(year_text, str):
        raise scraper_exceptions.ScraperStructureError()
    year = int(year_text.strip())
    return year


def get_directors(page: BeautifulSoup) -> list[str]:
    creator_list = page.find("span", class_="creatorlist")
    if not creator_list:
        return []
    if not isinstance(creator_list, Tag):
        raise scraper_exceptions.ScraperStructureError()
    contributors = creator_list.find_all("a", class_="contributor")
    directors = []
    for contributor in contributors:
        if not isinstance(contributor, Tag):
            raise scraper_exceptions.ScraperStructureError()
        span = contributor.find("span")
        if not isinstance(span, Tag):
            raise scraper_exceptions.ScraperStructureError()
        name = span.text
        if not isinstance(name, str):
            raise scraper_exceptions.ScraperStructureError()
        directors.append(name.strip())
    return directors


def get_rating(slug: str) -> float | None:
    url = f"https://letterboxd.com/csi/film/{slug}/ratings-summary/"
    response = get_page(url)
    if response is None:
        return None
    page = BeautifulSoup(response.text, "lxml")
    rating_tag = page.find("a", class_="display-rating")
    if not isinstance(rating_tag, Tag):
        return None
    rating_text = rating_tag.text
    if not isinstance(rating_text, str):
        raise scraper_exceptions.ScraperStructureError()
    rating = float(rating_text.strip())
    return rating


def get_top250_position(slug: str) -> int | None:
    url = f"https://letterboxd.com/csi/film/{slug}/stats/"
    response = get_page(url)
    if response is None:
        return None
    page = BeautifulSoup(response.text, "lxml")
    position_tag = page.find("div", class_="-top250")
    if not isinstance(position_tag, Tag):
        return None
    a = position_tag.find("a")
    if not isinstance(a, Tag):
        raise scraper_exceptions.ScraperStructureError()
    span = a.find("span")
    if not isinstance(span, Tag):
        raise scraper_exceptions.ScraperStructureError()
    position_text = span.text
    if not isinstance(position_text, str):
        raise scraper_exceptions.ScraperStructureError()
    position = int(position_text.strip())
    return position


def scrape_letterboxd(tmdb_id: int) -> LetterboxdMovieData | None:
    response = get_letterboxd_page(tmdb_id)
    if response is None:
        return None

    slug = get_slug(response)
    if slug is None:
        return None

    parsed_page = parse_page(response)
    poster_url = get_poster_url(slug)
    title = get_english_title(parsed_page)
    original_title = get_original_title(parsed_page)
    release_year = get_year(parsed_page)
    directors = get_directors(parsed_page)
    rating = get_rating(slug)
    top250 = get_top250_position(slug)

    return LetterboxdMovieData(
        slug=slug,
        poster_url=poster_url,
        title=title,
        original_title=original_title,
        release_year=release_year,
        directors=directors,
        rating=rating,
        top250=top250,
    )


if __name__ == "__main__":
    tmdb_id = 12477
    logger.info(f"Scraping Letterboxd data for TMDB ID {tmdb_id}")
    data = scrape_letterboxd(tmdb_id)
    logger.info(f"Data: {data}")
