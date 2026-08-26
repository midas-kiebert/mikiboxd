"""Guards on `data/cinemas.yaml` itself, the file every cinema is seeded from.

A cinema's row is built with `CinemaCreate.model_validate`, which drops fields it
does not know instead of complaining. A single misspelled key therefore costs a
cinema whatever that field carried — `aliaes:` cost Botanique the alias Cineville
knows it by, and with it every one of its showtimes — while the seed output goes
on looking perfectly healthy. These tests fail on the typo instead.
"""

import importlib.util
from pathlib import Path
from types import ModuleType

import pytest
import yaml

BACKEND_ROOT = Path(__file__).resolve().parent.parent
CINEMAS_YAML = BACKEND_ROOT / "data" / "cinemas.yaml"
SEED_SCRIPT = BACKEND_ROOT / "scripts" / "seed-cities-and-cinemas.py"
SEAT_CAPACITY_OVERRIDES = (
    BACKEND_ROOT / "app" / "configs" / "seat_capacity_overrides.yaml"
)


def _load_seed_script() -> ModuleType:
    # The script's filename is not importable (dashes), so it is loaded by path.
    spec = importlib.util.spec_from_file_location("seed_cities_and_cinemas", SEED_SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_cinemas() -> list[dict]:
    return yaml.safe_load(CINEMAS_YAML.read_text(encoding="utf-8"))


def test_cinemas_yaml_has_no_unknown_fields():
    seed = _load_seed_script()
    seed.assert_known_fields(_load_cinemas())


def test_assert_known_fields_rejects_a_misspelled_field():
    seed = _load_seed_script()
    with pytest.raises(ValueError, match="aliaes"):
        seed.assert_known_fields(
            [{"key": "botanique", "name": "Botanique", "aliaes": ["Filmhuis Breda"]}]
        )


def test_cinemas_yaml_keys_are_unique():
    seed = _load_seed_script()
    seed.assert_unique_keys(_load_cinemas())


def test_seat_capacity_overrides_name_real_cinema_keys():
    """Every override is keyed by a `Cinema.key` that actually exists.

    `app/configs/cinemas.yaml` — which only says which scrapers run — keys the
    same cinemas by shorter names (`uitkijk`, `fchyena`), and reaching for one
    of those here is a silent no-op: `_capacity_override` looks the key up
    against `Cinema.key` and simply finds nothing, so the room quietly falls
    back to the running-max estimate. That is how De Uitkijk's Grote Zaal spent
    its life advertising a capacity of 57 in an 85-seat room.
    """
    overrides = (
        yaml.safe_load(SEAT_CAPACITY_OVERRIDES.read_text(encoding="utf-8")) or {}
    ).get("overrides") or {}
    known_keys = {cinema["key"] for cinema in _load_cinemas()}
    unknown = sorted(set(overrides) - known_keys)
    assert not unknown, (
        f"seat_capacity_overrides.yaml names cinemas that are not in "
        f"data/cinemas.yaml: {unknown}"
    )
