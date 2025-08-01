from pathlib import Path

import yaml

from app.api.deps import get_db_context
from app.crud import cinema as cinema_crud
from app.crud import city as city_crud
from app.models.cinema import CinemaCreate
from app.models.city import CityCreate

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
    with get_db_context() as session:
        for city in cities:
            city_create = CityCreate.model_validate(city)
            print(f"Seeding city: {city_create.name}")
            city_crud.create_city(session=session, city=city_create)
        session.commit()

    city_name_to_id = {city['name']: city['id'] for city in cities}
    cinemas = load_yaml_data(cinemas_yaml_path)
    with get_db_context() as session:
        for cinema in cinemas:
            city_name = cinema.pop('city')
            cinema['city_id'] = city_name_to_id.get(city_name)
            cinema_create = CinemaCreate.model_validate(cinema)
            print(f"Seeding cinema: {cinema_create.name} in city: {city_name}")
            cinema_crud.upsert_cinema(session=session, cinema=cinema_create)
        session.commit()


if __name__ == '__main__':
    seed_cities_and_cinemas()
