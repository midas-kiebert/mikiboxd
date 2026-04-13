# Project Guidelines

This document captures all architectural decisions, code conventions, and design
principles used in this project. It is the reference point for any new development
or refactoring decision. When in doubt, consult this file first — and update it
when a new principle is established.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Repository Structure](#repository-structure)
3. [Technology Stack](#technology-stack)
4. [Backend Architecture](#backend-architecture)
5. [Backend Conventions](#backend-conventions)
6. [Frontend Architecture](#frontend-architecture)
7. [Mobile Architecture](#mobile-architecture)
8. [Shared Package](#shared-package)
9. [API Design](#api-design)
10. [Authentication & Security](#authentication--security)
11. [Error Handling](#error-handling)
12. [Email](#email)
13. [Background Jobs](#background-jobs)
14. [Scraping](#scraping)
15. [Validation](#validation)
16. [Logging](#logging)
17. [Infrastructure & Docker](#infrastructure--docker)
18. [Git & CI/CD](#git--cicd)
19. [Testing](#testing)
20. [Tooling](#tooling)

---

## Project Overview

**MiKiNO** is a cinema agenda app for the Netherlands. Users can browse showtimes across
multiple cinemas, track which movies they're going to or interested in, see what
their friends are watching, sync their Letterboxd watchlist, and receive push
notifications when showtimes they care about are upcoming.

The project consists of:
- A **Python REST API** (FastAPI)
- A **React web app** (Vite + TanStack Router)
- A **React Native mobile app** (Expo)
- A **shared package** with hooks and API client code used by both web and mobile

---

## Repository Structure

```
cinema-agenda-fastapi/
├── backend/                     # Python FastAPI backend
│   ├── app/                     # Application source
│   │   ├── api/                 # Routes and FastAPI dependencies
│   │   ├── core/                # Config, DB engine, security primitives, enums
│   │   ├── validators/          # Domain-specific validation logic
│   │   ├── models/              # SQLModel DB table definitions
│   │   ├── schemas/             # Pydantic API response shapes
│   │   ├── crud/                # Database reads and writes
│   │   ├── services/            # Business logic
│   │   ├── converters/          # Model → Schema transformations
│   │   ├── exceptions/          # Domain exceptions with HTTP status codes
│   │   ├── scraping/            # Cinema and TMDB data scrapers
│   │   ├── inputs/              # Complex query parameter models
│   │   ├── email.py             # Email sending and Jinja2 template rendering
│   │   ├── utils.py             # Generic helpers (datetime, string)
│   │   ├── main.py              # FastAPI app factory
│   │   ├── scheduler.py         # APScheduler background jobs (standalone process)
│   │   ├── backend_pre_start.py # Startup DB readiness check
│   │   └── initial_data.py      # First-run data seeding
│   ├── scripts/
│   │   ├── prestart.sh          # Runs before the app server
│   │   └── test.sh              # Runs the test suite
│   ├── data/
│   │   └── cinemas.yaml         # Static cinema configuration
│   └── pyproject.toml
├── frontend/                    # React web app
│   └── src/
│       ├── components/          # UI components
│       ├── hooks/               # Web-only hooks
│       ├── routes/              # TanStack Router file-based routes
│       ├── main.tsx             # App entry point
│       └── theme.tsx            # Chakra UI theme
├── mobile/                      # React Native (Expo) app
│   ├── app/                     # Expo Router file-based routes
│   ├── components/              # Native UI components
│   └── hooks/                   # Mobile-only hooks
├── shared/                      # Code shared between web and mobile
│   ├── client/                  # Auto-generated OpenAPI TypeScript client
│   ├── hooks/                   # Shared data-fetching hooks (TanStack Query)
│   ├── storage.ts               # Storage abstraction (localStorage / SecureStore)
│   ├── types.ts                 # Shared TypeScript types
│   └── utils.ts                 # Shared utility functions
├── CLEANUP.md                   # Cleanup progress tracker
└── GUIDELINES.md                # This file
```

---

## Technology Stack

### Backend

| Technology | Purpose | Docs |
|---|---|---|
| [FastAPI](https://fastapi.tiangolo.com/) | Web framework | Routing, DI, OpenAPI |
| [SQLModel](https://sqlmodel.tiangolo.com/) | ORM | Combines SQLAlchemy + Pydantic |
| [Pydantic v2](https://docs.pydantic.dev/latest/) | Validation & settings | Models, schemas, config |
| [Pydantic Settings](https://docs.pydantic.dev/latest/concepts/pydantic_settings/) | Environment config | `core/config.py` |
| [Alembic](https://alembic.sqlalchemy.org/) | Database migrations | `app/alembic/versions/` |
| [PostgreSQL 17](https://www.postgresql.org/) | Database | Via `psycopg` v3 |
| [PyJWT](https://pyjwt.readthedocs.io/) | JWT tokens | Access tokens, password reset |
| [passlib + bcrypt](https://passlib.readthedocs.io/) | Password hashing | `core/security.py` |
| [APScheduler](https://apscheduler.readthedocs.io/) | Background job scheduling | `app/scheduler.py` |
| [Tenacity](https://tenacity.readthedocs.io/) | Retry logic | DB readiness check |
| [Jinja2](https://jinja.palletsprojects.com/) | Email templating | `app/email-templates/` |
| [emails](https://github.com/lavr/python-emails) | SMTP email delivery | `app/email.py` |
| [httpx](https://www.python-httpx.org/) | HTTP client | TMDB API, push notifications |
| [BeautifulSoup4](https://www.crummy.com/software/BeautifulSoup/) | HTML scraping | Cinema website scrapers |
| [rapidfuzz](https://github.com/rapidfuzz/RapidFuzz) | Fuzzy string matching | TMDB title resolution |
| [Sentry](https://sentry.io/) | Error monitoring | Integrated in `app/main.py` |
| [uv](https://github.com/astral-sh/uv) | Package management | Replaces pip/poetry |
| [Ruff](https://docs.astral.sh/ruff/) | Linting & formatting | `pyproject.toml` |
| [mypy](https://mypy-lang.org/) | Static type checking | `pyproject.toml` |
| [pytest](https://docs.pytest.org/) | Testing | `backend/tests/` |

### Frontend

| Technology | Purpose | Docs |
|---|---|---|
| [React 19](https://react.dev/) | UI framework | |
| [TanStack Router](https://tanstack.com/router) | File-based routing | |
| [TanStack Query](https://tanstack.com/query) | Server state management | |
| [Chakra UI v3](https://chakra-ui.com/) | Component library | |
| [Vite](https://vitejs.dev/) | Build tool | |
| [TypeScript](https://www.typescriptlang.org/) | Type safety | |
| [Biome](https://biomejs.dev/) | Linting & formatting | Replaces ESLint + Prettier |
| [Axios](https://axios-http.com/) | HTTP client | Configured in `main.tsx` |
| [Playwright](https://playwright.dev/) | E2E testing | |

### Mobile

| Technology | Purpose | Docs |
|---|---|---|
| [React Native](https://reactnative.dev/) | Native UI framework | |
| [Expo](https://expo.dev/) | Development platform & build system | |
| [Expo Router](https://expo.github.io/router) | File-based navigation | |
| [TanStack Query](https://tanstack.com/query) | Server state management | |
| [expo-notifications](https://docs.expo.dev/versions/latest/sdk/notifications/) | Push notifications | |
| [expo-secure-store](https://docs.expo.dev/versions/latest/sdk/securestore/) | Secure token storage | |
| [EAS Build](https://docs.expo.dev/build/introduction/) | Cloud builds (APK/AAB/IPA) | `eas.json` |

### Package Management (JS/TS)

[pnpm](https://pnpm.io/) with workspaces (`pnpm-workspace.yaml`). All three JS
packages (`frontend`, `mobile`, `shared`) are managed as a monorepo from the root.

---

## Backend Architecture

### Layered Architecture

The backend follows a strict layered architecture. Data flows in one direction:

```
HTTP Request
    ↓
Routes  (api/routes/)       — receive request, validate input, call service
    ↓
Services  (services/)       — business logic, orchestrate CRUD calls, raise exceptions
    ↓
CRUD  (crud/)               — database reads and writes, no business logic
    ↓
Models  (models/)           — SQLModel table definitions
    ↓
Database (PostgreSQL)
```

On the response path:

```
Database → Models → Converters → Schemas → HTTP Response
```

**Converters** (`converters/`) are pure functions that transform a raw model (plus any
joined data) into a rich schema. They never access the database.

**Schemas** (`schemas/`) are Pydantic models used as API response shapes. They may
include computed fields or data joined from related tables.

### Layer rules

- **Routes never call CRUD directly.** Routes call services; services call CRUD.
- **CRUD has no business logic.** No permission checks, no domain rules — just SQL.
- **Services raise domain exceptions.** Never `HTTPException` from a service.
- **Routes raise `HTTPException`.** For HTTP-layer concerns (resource not found after
  a service returns `None`, input validation beyond Pydantic).
- **Converters are pure.** No DB access, no side effects.
- **Routes are thin.** Call a service, return the result. Business logic does not
  belong in routes.

### When to split a file

Only split a file when it has genuinely different responsibilities mixed together,
not just because it's long. A 485-line route file containing 20 thin handlers does
not need splitting — the length comes from repetition of a simple pattern, not
from complexity. Splitting creates more files without reducing complexity.

A service file that mixes unrelated concerns (e.g. profile management and push
notification logic) is a candidate for splitting.

---

## Backend Conventions

### Python naming

- **Public names** — can be imported by other modules: `USERNAME_MIN_LENGTH`, `is_valid_username`
- **Private (module-internal) names** — prefixed with `_`: `_pwd_context`, `_parse_cors`
- **Rule:** if a name is never imported by another module, prefix it with `_`.
  If it is imported (even once), keep it public.
- **Never import private names from another module.** If a private name is needed
  elsewhere, either make it public or redesign.

### Model base classes

SQLModel base classes used only for inheritance within their own file are prefixed
with `_` (e.g. `_UserBase`). Base classes imported by schemas (e.g. `MovieBase`,
`ShowtimeBase`) remain public.

`models/__init__.py` auto-discovers public names by checking `obj.__module__` — no
`__all__` is needed in individual model files. Names starting with `_` are never
re-exported.

### Type annotations

- All functions must have return type annotations.
- Use `str | None` not `Optional[str]`.
- Use `Annotated[X, Depends(...)]` type aliases (`SessionDep`, `CurrentUser`) instead
  of repeating the full form in every route.
- Route handler return types must match `response_model`. Never use `Any`.

### Magic values

- HTTP status codes: always use `fastapi.status.HTTP_*` constants, never raw integers.
- Retry counts, wait times: named constants with comments explaining the unit.
- Regex patterns: compile once as module-level constants, prefix private with `_`.

### `elif` after `raise` or `return`

Do not use `elif` after a branch that always exits:
```python
# Bad
if not user:
    raise HTTPException(...)
elif not user.is_active:
    ...

# Good
if not user:
    raise HTTPException(...)
if not user.is_active:
    ...
```

### Docstrings

- Module docstrings on every file: what it does, how to run it (if entrypoint),
  and what it does NOT do.
- Function docstrings on any non-trivial function.
- Route handlers always get a docstring explaining what the endpoint does, including
  any security behaviour.
- Do not add docstrings to trivial one-liner wrappers.

### Comments

Only add comments where the logic is not self-evident. A comment explains *why*, not
*what*. Do not comment code that re-states the code itself.

### `assert` vs explicit checks

Never use `assert` for runtime validation — asserts can be disabled with `-O`.
Use `if not ... raise` instead.

---

## Frontend Architecture

The web frontend is a React SPA using [TanStack Router](https://tanstack.com/router)
for file-based routing and [TanStack Query](https://tanstack.com/query) for server
state.

### Data fetching

All API data fetching goes through custom hooks in `shared/hooks/`. These wrap
TanStack Query's `useQuery` and `useMutation`. Route components do not call the API
client directly.

### API client

The TypeScript API client in `shared/client/` is **auto-generated** from the
backend's OpenAPI spec. Do not edit it manually. Regenerate it when the backend
API changes:
```bash
# From the root
pnpm run generate-client
```

### Component structure

- `components/` — reusable UI components
- `routes/` — page-level components, one file per route (TanStack Router convention)
- Page components are thin — they delegate to container components or hooks

### Linting & formatting

[Biome](https://biomejs.dev/) handles both linting and formatting for the frontend.
It replaces ESLint + Prettier. Run via:
```bash
cd frontend && pnpm run lint
```

---

## Mobile Architecture

The mobile app is built with [Expo](https://expo.dev/) and [Expo Router](https://expo.github.io/router)
for file-based navigation, closely mirroring the web app structure.

### Shared code

The mobile app consumes the `shared` workspace package for data hooks and the API
client. Platform-specific UI code lives in `mobile/components/` and `mobile/hooks/`.

### Storage

Token storage on mobile uses `expo-secure-store` (encrypted native storage).
On web, `localStorage` is used. Both are abstracted behind the `storage` interface
in `shared/storage.ts` — set the implementation at app startup with `setStorage()`.

### Push notifications

Push tokens are registered via `expo-notifications` and stored in the backend's
`push_token` table. The backend sends notifications via the Expo Push API
(`https://exp.host/--/api/v2/push/send`).

### Building & releasing

Builds use [EAS Build](https://docs.expo.dev/build/introduction/) (`eas.json`).
- Android APK/AAB: `bash mobile/scripts/build-android.sh`
- See `mobile/RELEASE_ANDROID.md` and `mobile/RELEASE_IOS.md` for release procedures.

---

## Shared Package

`shared/` is a pnpm workspace package consumed by both `frontend` and `mobile`.

Contents:
- `client/` — auto-generated OpenAPI TypeScript client (do not edit)
- `hooks/` — TanStack Query data-fetching hooks shared by web and mobile
- `storage.ts` — async storage abstraction (web: `localStorage`, mobile: `SecureStore`)
- `types.ts` — shared TypeScript types
- `utils.ts` — shared utility functions

**Rule:** code goes in `shared/` only if it is actually used by both web and mobile.
Platform-specific code stays in `frontend/` or `mobile/`.

---

## API Design

### Thin routes

Route handlers should:
1. Extract and validate inputs (Pydantic handles most of this automatically)
2. Call a service function
3. Return the result or raise `HTTPException` if needed

### HTTP status codes

Always use `fastapi.status` constants (`HTTP_200_OK`, `HTTP_404_NOT_FOUND`, etc.).
Never use raw integers.

### Security: user enumeration

Password recovery must not reveal whether an email is registered. Always return a
generic message regardless of whether the account exists:
```python
return Message(message="If that email is registered, a recovery link has been sent.")
```

### Pagination

Use `limit` and `offset` query parameters. Constraints (`ge`, `le`) are set per-
endpoint because different resources have different appropriate maximums. Do not
centralize these — they are documented inline where they appear.

### File splitting

A route file does not need splitting purely because of line count. Split only when
a file contains genuinely different concerns. Since URLs are defined by the router
prefix and path decorators (not the Python file name), splitting is safe from an
API compatibility standpoint but should only be done when it adds clarity.

---

## Authentication & Security

### JWT access tokens

JWT with HMAC-SHA256 (`HS256`). Issued at `/login/access-token`, sent as:
```
Authorization: Bearer <token>
```
Token logic lives in `core/security.py`. The `SECRET_KEY` comes from the environment.

**TODO:** Access tokens currently expire after 90 days. Reduce once refresh tokens
are implemented.

### Password hashing

Passwords hashed with bcrypt via `passlib`. `get_password_hash` and `verify_password`
are in `core/security.py`.

### Password reset tokens

Short-lived JWTs encoding the user's email. `generate_password_reset_token` and
`verify_password_reset_token` live in `core/security.py`.

### FastAPI DI for auth

- `CurrentUser` — injects the authenticated user (raises 401 if invalid)
- `get_current_active_superuser` — additionally requires superuser (raises 403)

---

## Error Handling

### Domain exceptions

Business logic errors are `AppError` subclasses in `exceptions/`. Each exception
owns its HTTP status code and its message — callers raise them with no arguments
(or minimal identifying data):

```python
class UserNotFound(AppError):
    status_code = status.HTTP_404_NOT_FOUND
    def __init__(self, user_id: UUID):
        super().__init__(f"User with id {user_id} not found.")
```

Exceptions never accept arbitrary `detail: str` — the message is the exception's
responsibility.

### Global handler

`AppError` subclasses are caught by a global handler in `main.py` and converted to
JSON responses. Services raise domain exceptions; routes do not catch `AppError`.

---

## Email

Email logic lives in `app/email.py`.

- Templates: `app/email-templates/build/` (Jinja2 HTML)
- `_render_email_template` is private
- `EmailDeliveryError` raised on 4xx/5xx SMTP responses
- `EmailData` dataclass returned by generators — caller decides when to send
- SMTP configuration from environment variables (see `core/config.py`)

---

## Background Jobs

`app/scheduler.py` runs as a **standalone blocking process**, separate from the API
server. It uses [APScheduler](https://apscheduler.readthedocs.io/) `BlockingScheduler`.

Docker runs it as its own service (`scheduler` in `docker-compose.yml`).

Current jobs:
- **Nightly scrape** — 03:00 Amsterdam time, fetches all cinema showtimes
- **Interested-showtime reminders** — every 15 minutes, sends push notifications

All job functions are private (prefixed `_`) since they are only used internally.
All jobs catch and log exceptions so a single failure does not crash the process.

```bash
uv run python -m app.scheduler
```

---

## Scraping

The scraping system fetches showtime data from cinema websites and enriches movies
via the TMDB API.

- `scraping/runner.py` — main orchestrator
- `scraping/scrape.py` — executes one scraper and stores results
- `scraping/base_cinema_scraper.py` — abstract base class for cinema scrapers
- `scraping/cinemas/amsterdam/` — one file per cinema
- `scraping/tmdb*.py` — TMDB API client, title matching, enrichment

### Cinema configuration

Cinema metadata (name, city, seating preset, URL) is defined in `backend/data/cinemas.yaml`.
This is the source of truth for which cinemas the scraper targets.

### Seating presets

Cinema seating layouts are typed as the `CinemaSeatingPreset` enum (in
`validators/cinema_seating.py`). Values follow `row_type-seat_type` where each type
is `number` (1-2 digits) or `letter` (a single letter). Examples: `number-number`,
`letter-number`.

---

## Validation

Domain-specific validation lives in `app/validators/`:
- `validators/username.py` — character rules and length limits
- `validators/cinema_seating.py` — seating preset enum and seat format validation

**Rules:**
- Validators contain pure functions and constants — no DB access, no HTTP concerns.
- Return `bool` or raise nothing — callers decide what to do with the result.
- Public constants may be imported by exception classes to build messages.
- Private helpers (`_USERNAME_PATTERN`) are never imported outside the module.

### Enum coercion

SQLModel/Pydantic v2 automatically coerces string values to `str`-based enums.
Fields typed as `CinemaSeatingPreset` do not need `@field_validator`.

---

## Logging

Standard library `logging` throughout. No third-party logging library.

### Setup

Each module gets its own named logger:
```python
import logging
logger = logging.getLogger(__name__)
```

Entrypoint scripts call `logging.basicConfig(level=logging.INFO)` once at startup.

### Log levels

- `logger.info` — normal operational events
- `logger.warning` — unexpected but recoverable
- `logger.error` / `logger.exception` — failures that need attention

### Do not use

- `print()` — use `logger.info` instead
- `logging.WARN` — deprecated alias, use `logging.WARNING`
- `assert` for runtime validation

---

## Infrastructure & Docker

### Services

The app runs as multiple Docker containers defined in `docker-compose.yml`:

| Service | Description |
|---|---|
| `db` | PostgreSQL 17 |
| `prestart` | Runs migrations and seeds initial data before the backend starts |
| `backend` | FastAPI app served by uvicorn on port 8000 |
| `scheduler` | APScheduler process for background jobs |
| `frontend` | Vite-built React app served by Nginx on port 80 |
| `adminer` | Database admin UI |

The `backend` service depends on `prestart` completing successfully before starting.
The `prestart` service depends on the `db` healthcheck passing.

### Reverse proxy

[Traefik](https://traefik.io/) is used as the reverse proxy in production
(`docker-compose.traefik.yml`). It handles TLS termination via Let's Encrypt.

- API: `api.<DOMAIN>`
- Frontend: `dashboard.<DOMAIN>` and `<DOMAIN>`
- Adminer: `adminer.<DOMAIN>`

### Environment variables

All configuration comes from a `.env` file in the project root. Required variables
are documented in `core/config.py`. Variables marked `?Variable not set` in
`docker-compose.yml` are required — the stack will not start without them.

### Local development

```bash
docker compose up
```

Uses `docker-compose.override.yml` for local overrides (e.g. volume mounts for
hot-reload).

---

## Git & CI/CD

### Branching

- `master` — production branch
- Feature branches merged via pull request

### CI/CD (GitHub Actions)

| Workflow | Trigger | What it does |
|---|---|---|
| `test-backend.yml` | Push/PR | Runs `pytest` |
| `lint-backend.yml` | Push/PR | Runs Ruff and mypy |
| `generate-client.yml` | Push to master | Regenerates the TypeScript API client |
| `deploy-staging.yml` | Push to master | Deploys to staging |
| `deploy-production.yml` | Manual trigger | Deploys to production |

### Pre-commit hooks

Ruff runs on every commit. Install:
```bash
pre-commit install
```

### Commit messages

Describe *what changed and why*, not just what files were touched.

---

## Testing

Tests live in `backend/tests/`. Runner: `pytest` with `pytest-cov`.

### Running tests

```bash
bash backend/scripts/test.sh
```

The script waits for DB readiness using `backend_pre_start.py` (same script as
production). Migrations for the test DB are applied in `tests/conftest.py`.

### Principles

- Tests hit a real (test) database — do not mock the DB layer. Mocking risks masking
  real migration failures.
- Services are the most critical layer to test — they contain business logic.
- CRUD tests cover complex queries, filtering, and edge cases.
- Route tests cover auth and input validation.

### Current state

Target: 80%+ on services and CRUD. Current coverage is approximately 25%.

---

## Tooling

### Backend

| Tool | Purpose | Config |
|---|---|---|
| [uv](https://github.com/astral-sh/uv) | Python package management | `pyproject.toml` |
| [Ruff](https://docs.astral.sh/ruff/) | Linting + formatting | `pyproject.toml` |
| [mypy](https://mypy-lang.org/) | Static type checking | `pyproject.toml` |
| [pytest](https://docs.pytest.org/) | Testing | `pyproject.toml` |
| [pre-commit](https://pre-commit.com/) | Git hooks | `.pre-commit-config.yaml` |

### Frontend / Mobile

| Tool | Purpose | Config |
|---|---|---|
| [pnpm](https://pnpm.io/) | JS package management | `pnpm-workspace.yaml` |
| [Biome](https://biomejs.dev/) | Linting + formatting (frontend) | `biome.json` |
| [ESLint](https://eslint.org/) | Linting (mobile) | `mobile/eslint.config.js` |
| [TypeScript](https://www.typescriptlang.org/) | Type checking | `tsconfig.json` |
| [Vite](https://vitejs.dev/) | Frontend build | `frontend/vite.config.ts` |
| [EAS](https://docs.expo.dev/build/introduction/) | Mobile cloud builds | `eas.json` |
| [hey-api/openapi-ts](https://heyapi.dev/) | OpenAPI client generation | `frontend/package.json` |
