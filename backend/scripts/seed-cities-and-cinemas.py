import yaml
from pathlib import Path
from app import crud
from app.api.deps import get_db_context


backend_root = Path(__file__).parent.parent

cities_yaml_path = backend_root / "data" / "cities.yaml"
cinemas_yaml_path = backend_root / "data" / "cinemas.yaml"

def load_yaml_data(file_path: Path) -> list[dict]:
    with open(file_path, 'r', encoding='utf-8') as file:
        return yaml.safe_load(file)

def seed_cities_and_cinemas():
    cities = load_yaml_data(cities_yaml_path)
    for city in cities:
        city_create = crud.CityCreate.model_validate(city)
        with get_db_context() as session:
            print(f"Seeding city: {city_create.name}")
            crud.upsert_city(session=session, city=city_create)

    city_name_to_id = {city['name']: city['id'] for city in cities}
    cinemas = load_yaml_data(cinemas_yaml_path)
    for cinema in cinemas:
        city_name = cinema.pop('city')
        cinema['city_id'] = city_name_to_id.get(city_name)
        cinema_create = crud.CinemaCreate.model_validate(cinema)
        with get_db_context() as session:
            print(f"Seeding cinema: {cinema_create.name} in city: {city_name}")
            crud.upsert_cinema(session=session, cinema=cinema_create)


if __name__ == '__main__':
    seed_cities_and_cinemas()