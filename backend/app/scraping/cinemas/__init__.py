from typing import Type, Dict
from app.scraping import BaseCinemaScraper


from .amsterdam.eye import EyeScraper
from .amsterdam.kriterion import KriterionScraper
from .amsterdam.lab111 import LAB111Scraper
from .amsterdam.filmhallen import FilmHallenScraper
from .amsterdam.themovies import TheMoviesScraper
from .amsterdam.uitkijk import UitkijkScraper
from .amsterdam.fchyena import FCHyenaScraper

from .utrecht.louishartloopercomplex import LouisHartlooperComplexScraper
from .utrecht.slachtstraat import SlachtstraatScraper
from .utrecht.springhaver import SpringhaverScraper

from .rotterdam.kino import KinoScraper

from .leiden.trianon import TrianonScraper
from .leiden.lido import LidoScraper
from .leiden.kijkhuis import KijkhuisScraper

from .haarlem.filmkoepel import FilmkoepelScraper



SCRAPER_REGISTRY: Dict[str, Type[BaseCinemaScraper]] = {
    "kino": KinoScraper,
    "filmhallen": FilmHallenScraper,
    "themovies": TheMoviesScraper,
    "eye": EyeScraper,
    "kriterion": KriterionScraper,
    "lab111": LAB111Scraper,
    "uitkijk": UitkijkScraper,
    "filmkoepel": FilmkoepelScraper, #TODO bijspijkeren probleem
    "louishartloopercomplex": LouisHartlooperComplexScraper,
    "slachtstraat": SlachtstraatScraper,
    "springhaver": SpringhaverScraper,
    "trianon": TrianonScraper,
    "lido": LidoScraper,
    "kijkhuis": KijkhuisScraper,
    "fchyena": FCHyenaScraper,
}