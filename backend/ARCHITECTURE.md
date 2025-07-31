# Architecture Overview

This project uses multiple layers between the database and api endpoints,
each with separate responsibilites and guidelines.

- `app/models`: simple sqlmodel classes for direct use with database
- `app/schemas`: more complicated sqlmodel classes that will be exposed to the API.
- `app/crud`: all direct database communication, only simple functions, returns models or primitives, not schemas. Should do ALL the flushes to the database, but should never commit. These flushes are to raise IntegrityErrors, no further error handling should be done in crud.
- `app/converters`: convert models to schemas, potentially enriching them with more information by using crud functions.
- `app/services`: logic behind the api endpoints, should call crud functions and converters. All error handling should be done here.
- `app/api`: API endpoints, ideally should contain no logic, only setting default parameters and calling a service function. HTTP exceptions should not be defined here.
- `app/exceptions`: Define exceptions that you can raise in services, assigned with HTTP status codes that the api layer will automatically pick up on.
