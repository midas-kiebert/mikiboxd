from app.scraping.cinemas.amsterdam.fchyena import clean_title as clean_title_fchyena
from app.utils import clean_title as clean_title_utils


def test_clean_title_utils_keeps_in_word_hyphens() -> None:
    assert clean_title_utils("Blow-Up") == "blow-up"
    assert clean_title_utils("Ben-Hur") == "ben-hur"


def test_clean_title_utils_trims_dash_separated_suffix() -> None:
    assert clean_title_utils("The Virgin Suicides - 35mm") == "the virgin suicides"


def test_clean_title_fchyena_keeps_in_word_hyphens() -> None:
    assert clean_title_fchyena("Blow-Up") == "blow-up"
    assert clean_title_fchyena("Ben-Hur") == "ben-hur"


def test_clean_title_fchyena_trims_dash_separated_suffix() -> None:
    assert clean_title_fchyena("The Virgin Suicides - 35mm") == "the virgin suicides"
