from pathlib import Path

import yaml

from app import crud
from app.api.deps import get_db_context
from app.models import CinemaCreate, CityCreate

script_dir = Path(__file__).resolve().parent
data_dir = script_dir.parent / "data"
print(f"Backend root path: {data_dir}")

cities_yaml_path = data_dir / "cities.yaml"
cinemas_yaml_path = data_dir / "cinemas.yaml"

def load_yaml_data(file_path: Path) -> list[dict]:
    with open(file_path, encoding='utf-8') as file:
        return yaml.safe_load(file)

def seed_cities_and_cinemas():
    cities = load_yaml_data(cities_yaml_path)
    for city in cities:
        city_create = CityCreate.model_validate(city)
        with get_db_context() as session:
            print(f"Seeding city: {city_create.name}")
            crud.upsert_city(session=session, city=city_create)

    city_name_to_id = {city['name']: city['id'] for city in cities}
    cinemas = load_yaml_data(cinemas_yaml_path)
    for cinema in cinemas:
        city_name = cinema.pop('city')
        cinema['city_id'] = city_name_to_id.get(city_name)
        cinema_create = CinemaCreate.model_validate(cinema)
        with get_db_context() as session:
            print(f"Seeding cinema: {cinema_create.name} in city: {city_name}")
            crud.upsert_cinema(session=session, cinema=cinema_create)


if __name__ == '__main__':
    seed_cities_and_cinemas()
