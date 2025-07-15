from app.scraping import BaseCinemaScraper

from .amsterdam.eye import EyeScraper
from .amsterdam.fchyena import FCHyenaScraper
from .amsterdam.filmhallen import FilmHallenScraper
from .amsterdam.kriterion import KriterionScraper
from .amsterdam.lab111 import LAB111Scraper
from .amsterdam.themovies import TheMoviesScraper
from .amsterdam.uitkijk import UitkijkScraper
from .haarlem.filmkoepel import FilmkoepelScraper
from .leiden.kijkhuis import KijkhuisScraper
from .leiden.lido import LidoScraper
from .leiden.trianon import TrianonScraper
from .rotterdam.kino import KinoScraper
from .utrecht.louishartloopercomplex import LouisHartlooperComplexScraper
from .utrecht.slachtstraat import SlachtstraatScraper
from .utrecht.springhaver import SpringhaverScraper

SCRAPER_REGISTRY: dict[str, type[BaseCinemaScraper]] = {
    "kino": KinoScraper,
    "filmhallen": FilmHallenScraper,
    "themovies": TheMoviesScraper,
    "eye": EyeScraper,
    "kriterion": KriterionScraper,
    "lab111": LAB111Scraper,
    "uitkijk": UitkijkScraper,
    "filmkoepel": FilmkoepelScraper,  # TODO bijspijkeren probleem
    "louishartloopercomplex": LouisHartlooperComplexScraper,
    "slachtstraat": SlachtstraatScraper,
    "springhaver": SpringhaverScraper,
    "trianon": TrianonScraper,
    "lido": LidoScraper,
    "kijkhuis": KijkhuisScraper,
    "fchyena": FCHyenaScraper,
}
