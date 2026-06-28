# Codebase Cleanup Checklist

Track progress through the full cleanup: understand, document, refactor, and test each module.
Check a box once you've read the file, understand what it does, and it has proper documentation.

Legend:
- [ ] = not started
- [~] = in progress
- [x] = documented, reviewed, cleaned up

---

## Backend — Core (`backend/app/core/`)

- [x] `config.py` — App settings (Pydantic Settings, env vars, DB/SMTP/auth config)
- [x] `db.py` — Engine creation, connection pool, `init_db` seeding
- [x] `security.py` — JWT creation, password hashing/verification, password reset tokens (moved from `utils.py`)
- [x] `enums.py` — App-wide enums (GoingStatus, TimeOfDay, etc.)

---

## Backend — Validators (`backend/app/validators/`)

- [x] `username.py` — Username validation rules and normalisation (moved from `core/`)
- [x] `cinema_seating.py` — Seating preset enum and seat input validation (moved from `core/`)

---

## Backend — Entry Points & App Setup

- [x] `main.py` — FastAPI app factory, middleware, Sentry, router mounting
- [x] `backend_pre_start.py` — Startup readiness check (waits for DB)
- [x] `initial_data.py` — Calls `init_db` to seed first superuser
- [x] `scheduler.py` — APScheduler setup, registers scraping jobs
- [x] `utils.py` — Generic helpers (`now_amsterdam_naive`, `to_amsterdam_time`, `clean_title`)
- [x] `mailer.py` — Email sending and template rendering (split out of `utils.py`; not named `email.py` because it would shadow stdlib `email`)
- ~~`logging_/logger.py`~~ — deleted (loguru removed, stdlib logging used throughout)

---

## Backend — API Layer (`backend/app/api/`)

- [x] `deps.py` — FastAPI dependencies (get_db, CurrentUser, SessionDep, etc.)
- [x] `main.py` — Router composition (mounts all route modules)
- [x] `routes/login.py` — Auth endpoints (access-token, password reset)
- [x] `routes/me.py` — Current user endpoints (profile, settings, presets, watchlist) ⚠️ Large (485 LOC)
- [x] `routes/movies.py` — Movie listing endpoints
- [x] `routes/showtimes.py` — Showtime endpoints (list, selection, visibility, pings)
- [x] `routes/friends.py` — Friend request and friendship endpoints
- [x] `routes/cinemas.py` — Cinema listing endpoints
- [x] `routes/users.py` — User lookup endpoints (admin + public profiles)
- [x] `routes/utils.py` — Utility endpoints (health check, TMDB cache override)
- [ ] `routes/admin.py` — Superuser-only endpoints (analytics overview, movie/showtime moderation, showtime reports)

---

## Backend — Models (`backend/app/models/`)

> Models are SQLModel classes — they define both the database table schema and
> the base data shape. Each model corresponds to one database table.

- [x] `auth_schemas.py` — Token and token-payload shapes (not a DB model)
- [x] `user.py` — User account (email, password hash, settings, flags)
- [x] `cinema.py` — Cinema venue (name, city, coords, seating preset)
- [x] `cinema_selection.py` — Which cinemas a user has selected
- [x] `cinema_preset.py` — Saved named sets of cinema selections
- [x] `movie.py` — Movie metadata (title, duration, genres, poster). Positive id = TMDB id; negative id = synthetic listing (e.g. sneak preview) via `sneak_preview_movie()` / `is_synthetic_movie_id`
- [x] `showtime.py` — Individual screening (datetime, cinema, movie, ticket link)
- [x] `showtime_selection.py` — User's going/interested status on a showtime
- [x] `showtime_ping.py` — Notification sent to a friend about a showtime
- [x] `notification.py` — Notification-centre entry (match / invite-response / request-accepted)
- [x] `showtime_visibility.py` — Per-showtime visibility mode + effective-visibility cache
- [x] `showtime_source_presence.py` — Tracks which scraper provided a showtime
- [x] `scrape_run.py` — Metadata about each scraping execution
- [x] `friendship.py` — Accepted friend relationships (+ per-friend `shares_status`)
- [x] `filter_preset.py` — Saved filter configurations (movies or showtimes scope)
- ~~`friend_group.py`~~ — deleted (friend groups retired in the visibility overhaul)
- [x] `letterboxd.py` — Cached Letterboxd watchlist data per user
- [x] `watchlist_selection.py` — Movies on a user's watchlist
- [x] `push_token.py` — FCM device tokens for push notifications
- [x] `tmdb_lookup_cache.py` — Cache of title → TMDB ID resolutions
- [x] `city.py` — City (currently Amsterdam only)
- [ ] `watchlist_digest_queue_entry.py` — Movies newly available for the watchlist digest (queued once, ever)
- [ ] `watchlist_digest_notified_movie.py` — Per-user record of movies already sent/seen in the digest
- [ ] `analytics_event.py` — Single usage-analytics event (name + free-form properties)
- [ ] `showtime_report.py` — User-submitted report that a showtime is wrong

---

## Backend — Schemas (`backend/app/schemas/`)

> Schemas are Pydantic models used as API response shapes. They are richer than
> raw models — they may include computed fields or join data from related tables.
> Converters (below) transform models into schemas.

- [ ] `user.py` — Public/private user representations
- [ ] `cinema.py` — Cinema response shape
- [ ] `movie.py` — Movie response shape (with watchlist status, friend data)
- [ ] `showtime.py` — Showtime response shape (with selections, visibility)
- [ ] `showtime_ping.py` — Ping response shape
- [x] `notification.py` — Merged notification-centre feed item shape
- [x] `showtime_visibility.py` — Per-showtime visibility mode response shape
- [ ] `cinema_preset.py` — Cinema preset response shape
- [ ] `filter_preset.py` — Filter preset response shape
- [x] `friendship.py` — Friend status-sharing toggle request shape
- [ ] `push_token.py` — Push token registration shape
- [ ] `city.py` — City response shape
- [ ] `analytics_event.py` — Event create/public response shapes
- [ ] `analytics_dashboard.py` — Admin analytics-overview response shape
- [ ] `showtime_report.py` — Showtime report create/update/admin-view shapes
- [ ] `admin.py` — Admin movie/showtime moderation request/response shapes

---

## Backend — CRUD Layer (`backend/app/crud/`)

> CRUD functions are the only place that touches the database directly.
> They return raw SQLModel objects (not schemas). No business logic here —
> just reads and writes.

- [ ] `user.py` — User queries, create, update, password check ⚠️ Large (652 LOC)
- [ ] `movie.py` — Movie queries with filtering ⚠️ Large (599 LOC)
- [ ] `showtime.py` — Showtime queries, upserts, reconciliation ⚠️ Large (518 LOC)
- [x] `showtime_visibility.py` — Effective-visibility cache from mode + status-sharing + pings (incl. co-invitees)
- [ ] `showtime_ping.py` — Ping queries and creation
- [x] `notification.py` — Notification-centre row queries (upsert, feed, decay)
- [ ] `friendship.py` — Friend request and friendship queries (+ status-sharing)
- ~~`friend_group.py`~~ — deleted (friend groups retired)
- [ ] `cinema.py` — Cinema queries
- [ ] `cinema_preset.py` — Cinema preset CRUD
- [ ] `filter_preset.py` — Filter preset CRUD
- [ ] `watchlist.py` — Watchlist selection CRUD
- [ ] `push_token.py` — Push token registration and lookup
- [ ] `city.py` — City queries
- [ ] `analytics_event.py` — Event creation and dashboard aggregation queries
- [ ] `showtime_report.py` — Report creation, listing (joined), status updates

---

## Backend — Services (`backend/app/services/`)

> Services contain business logic. They orchestrate CRUD calls, enforce rules,
> and raise domain exceptions. Routes call services — never CRUD directly.

- [ ] `me.py` — User profile, settings, presets, pins, watchlist sync ⚠️ Large (1058 LOC) — needs splitting
- [ ] `showtimes.py` — Showtime selection, visibility logic, pings ⚠️ Large (975 LOC)
- [ ] `push_notifications.py` — FCM push notification orchestration ⚠️ Large (578 LOC)
- [ ] `movies.py` — Movie listing and filtering
- [ ] `friends.py` — Friend requests, acceptance, removal
- [ ] `cinemas.py` — Cinema listing
- [ ] `users.py` — User management (admin operations)
- [ ] `watchlist.py` — Watchlist sync logic
- [ ] `scrape_sync.py` — Triggers scraping from the API layer
- [ ] `analytics_dashboard.py` — Aggregates AnalyticsEvent/Notification/ShowtimePing/User data for the admin overview

---

## Backend — Converters (`backend/app/converters/`)

> Converters transform a raw SQLModel model object into a rich schema object.
> They are the bridge between the database layer and the API response layer.

- [ ] `showtime.py` — Showtime → ShowtimeSchema (joins selections, visibility)
- [ ] `movie.py` — Movie → MovieSchema (joins watchlist status, friend data)
- [ ] `cinema.py` — Cinema → CinemaSchema
- [ ] `user.py` — User → UserPublic/UserPrivate
- [ ] `city.py` — City → CitySchema

---

## Backend — Exceptions (`backend/app/exceptions/`)

> Domain-specific exceptions with HTTP status code mappings.
> Services raise these; the global handler converts them to HTTP responses.

- [ ] `base.py` — Base exception class with HTTP status
- [ ] `user_exceptions.py` — User-related errors (not found, duplicate email, etc.)
- [ ] `movie_exceptions.py` — Movie-related errors
- [ ] `showtime_exceptions.py` — Showtime-related errors
- [ ] `friends_exceptions.py` — Friend request errors
- [ ] `watchlist_exceptions.py` — Watchlist-related errors
- [ ] `city_exceptions.py` — City-related errors
- [ ] `scraper_exceptions.py` — Scraping-specific errors

---

## Backend — Scraping (`backend/app/scraping/`)

- [ ] `runner.py` — Main scraping orchestrator ⚠️ Very large (2042 LOC) — needs splitting
- [ ] `scrape.py` — Executes a single scraper and stores results
- [ ] `base_cinema_scraper.py` — Abstract base class for cinema scrapers ⚠️ Too thin (18 LOC)
- [ ] `date_conversion.py` — Date/time parsing helpers for scrapers
- [ ] `get_movies.py` — Fetches movies from the DB for enrichment
- [ ] `get_showtimes.py` — Fetches showtimes from the DB for enrichment
- [ ] `logger.py` — Scraping-specific log configuration
- [x] `subtitles.py` — Parses cinema subtitle metadata (Dutch free text) into ISO-639-1 codes for `Showtime.subtitles`
- [ ] `title_hints.py` — Subtitle/year hints recoverable from a raw scraped title/slug
- [ ] `tmdb.py` — TMDB API client ⚠️ Large (1411 LOC)
- [ ] `tmdb_lookup.py` — TMDB movie resolution + fuzzy matching ⚠️ Large (1470 LOC)
- [ ] `tmdb_config.py` — TMDB configuration constants
- [ ] `tmdb_movie_details.py` — TMDB movie detail fetching
- [ ] `tmdb_normalization.py` — Title normalisation for matching
- [ ] `tmdb_parsing.py` — TMDB API response parsing
- [ ] `tmdb_runtime.py` — Runtime enrichment logic

**Cinema scrapers — Amsterdam:**
- [ ] `cinemas/amsterdam/eye.py` — Eye Film scraper ⚠️ Large (376 LOC)
- [ ] `cinemas/amsterdam/filmhallen.py` — Filmhallen scraper
- [ ] `cinemas/amsterdam/kriterion.py` — Kriterion scraper
- [ ] `cinemas/amsterdam/uitkijk.py` — Uitkijk scraper
- [ ] `cinemas/amsterdam/lab111.py` — Lab111 scraper
- [ ] `cinemas/amsterdam/themovies.py` — The Movies scraper
- [ ] `cinemas/amsterdam/fchyena.py` — FC Hyena scraper
- [ ] `cinemas/amsterdam/studiok.py` — Studio/K scraper
- [ ] `cinemas/amsterdam/rialto.py` — Rialto De Pijp + Rialto VU scraper

**Cinema scrapers — Rotterdam:**
- [ ] `cinemas/rotterdam/kinorotterdam.py` — KINO scraper (Eagerly)

**Cinema scrapers — Utrecht:**
- [ ] `cinemas/utrecht/hartlooper.py` — Louis Hartlooper Complex scraper (Eagerly)
- [ ] `cinemas/utrecht/slachtstraat.py` — Slachtstraat scraper (Eagerly)
- [ ] `cinemas/utrecht/springhaver.py` — Springhaver scraper (Eagerly)

**Cinema scrapers — Haarlem:**
- [ ] `cinemas/haarlem/filmkoepel.py` — Filmkoepel scraper (Eagerly)

**Cinema scrapers — Generic:**
- [ ] `cinemas/generic/eagerly.py` — Eagerly-based generic scraper

**Letterboxd integration:**
- [ ] `letterboxd/load_letterboxd_data.py` — Watchlist sync ⚠️ Large (1193 LOC) — needs splitting
- [ ] `letterboxd/watchlist.py` — Watchlist parsing
- [ ] `letterboxd/utils.py` — Letterboxd utilities

---

## Backend — Inputs (`backend/app/inputs/`)

- [ ] `movie.py` — Input validation models for movie-related endpoints

---

## Backend — Tests (`backend/tests/`)

> Current coverage: ~25%. Goal: 80%+. Prioritise services and large CRUD files.

- [ ] Review and understand existing test structure
- [ ] Check coverage report — identify untested services and CRUDs
- [ ] `tests/api/` — Route-level tests (are all endpoints covered?)
- [ ] `tests/crud/` — CRUD tests (are complex queries tested?)
- [ ] `tests/services/` — Service tests (most critical layer)
- [ ] `tests/converters/` — Converter tests
- [ ] `tests/scraping/` — Scraper tests
- [ ] `tests/fixtures/` — Test factories and shared fixtures
- [ ] Add tests for `services/me.py`
- [ ] Add tests for `services/showtimes.py` (visibility logic)
- [ ] Add tests for `crud/showtime_visibility.py`
- [ ] Add tests for `crud/user.py` (time-range filtering)
- [ ] `tests/api/test_admin.py` — Admin route gating, analytics overview, movie/showtime moderation, showtime reports

---

## Frontend — Entry & Config (`frontend/src/`)

- [ ] `main.tsx` — App entry point, React Query setup, Axios interceptors
- [ ] `theme.tsx` — Chakra UI theme customisation
- [ ] `constants.ts` — App-wide constants
- [ ] `types.ts` — Custom TypeScript types (beyond auto-generated API types)
- [ ] `utils.ts` — Frontend utility functions

---

## Frontend — Routes (`frontend/src/routes/`)

- [ ] `__root.tsx` — Root layout (wraps entire app, providers)
- [ ] `_layout.tsx` — Authenticated layout (redirects to login if no token)
- [ ] `_layout/index.tsx` — Home / dashboard
- [ ] `_layout/movies.tsx` — Movies listing page
- [ ] `_layout/pings.tsx` — Showtime pings page
- [ ] `_layout/friends.tsx` — Friends page
- [ ] `_layout/settings.tsx` — User settings page
- [ ] `_layout/me/showtimes.tsx` — Own showtimes page
- [ ] `_layout/$userId/showtimes.tsx` — Friend's showtimes page
- [ ] `login.tsx` — Login page
- [ ] `signup.tsx` — Signup page
- [ ] `recover-password.tsx` — Request password reset
- [ ] `reset-password.tsx` — Set new password (from email link)
- [ ] `movie.$movieId.tsx` — Movie detail page
- [ ] `beta.tsx` — Beta signup page
- [ ] `cinema-showtimes.tsx` — Cinema showtimes wrapper
- [ ] `cinema-showtimes.$cinemaId.tsx` — Showtimes for a specific cinema
- [ ] `friend-showtimes.tsx` — Friend showtimes wrapper
- [ ] `friend-showtimes.$friendId.tsx` — Showtimes for a specific friend
- ~~`friend-groups.tsx`~~ — deleted (friend groups retired; web parity pending)
- [ ] `add-friend.$receiverId.tsx` — Add a friend by ID (deep link)
- [ ] `ping.$showtimeId.$sender.tsx` — Ping deep link handler
- [ ] `forbidden.tsx` — 403 page
- [ ] `routeTree.gen.ts` — Auto-generated (do not edit manually)
- [ ] `_layout/admin/index.tsx` — Superuser analytics overview page
- [ ] `_layout/admin/movies.tsx` — Superuser movie-record / TMDB-cache editor page
- [ ] `_layout/admin/showtimes.tsx` — Superuser showtime moderation page
- [ ] `_layout/admin/reports.tsx` — Superuser showtime-report triage page

---

## Frontend — Components

**Common (shared UI):**
- [ ] `Layout.tsx` — Page layout wrapper
- [ ] `Navbar.tsx` — Top navigation bar
- [ ] `Sidebar.tsx` + `SidebarItems.tsx` — Desktop sidebar
- [ ] `BottomNavBar.tsx` — Mobile bottom navigation
- [ ] `TopBar.tsx` — Mobile top bar
- [ ] `UserMenu.tsx` — User avatar dropdown
- [ ] `Page.tsx` — Page container with consistent padding
- [ ] `SearchBar.tsx` — Reusable search input
- [ ] `Badge.tsx`, `CinemaBadge.tsx`, `FriendBadge.tsx` — Badge components
- [ ] `CinemaToggle.tsx` — Cinema selection toggle
- [ ] `DayFilter.tsx` — Day-of-week filter control
- [ ] `MyButton.tsx` — Styled button wrapper
- [ ] `NotFound.tsx` + `Forbidden.tsx` — Error pages

**Movies list:**
- [ ] `MoviesPage.tsx` — Top-level movies list page
- [ ] `MoviesContainer.tsx` — Data fetching + state wrapper
- [ ] `Movies.tsx` — Movies grid/list rendering
- [ ] `MoviesTopBar.tsx` — Search and filter bar
- [ ] `MovieCard.tsx` — Individual movie card
- [ ] `MovieInfoBox.tsx` — Movie metadata summary
- [ ] `MoviePoster.tsx` — Poster image with fallback
- [ ] `MovieTitle.tsx` + `OriginalTitle.tsx` — Title display
- [ ] `ShowtimeList.tsx` + `ShowtimeInfo.tsx` — Showtimes on a movie card
- [ ] `MoreShowtimes.tsx` + `MoreCinemas.tsx` — Overflow indicators
- [ ] `Filters.tsx` + `FilterButton.tsx` — Filter panel
- [ ] `CityCinemas.tsx` + `CinemaBadges.tsx` + `FriendBadges.tsx` — Filter chips
- [ ] `WatchlistToggle.tsx` — Add/remove from watchlist
- [ ] `FetchWatchlistButton.tsx` — Sync Letterboxd watchlist

**Movie detail:**
- [ ] `MoviePage.tsx` — Full movie detail ⚠️ Large (502 LOC) — needs splitting
- [ ] `Showtimes.tsx` + `ShowtimeRow.tsx` — Showtime list in detail view
- [ ] `Day.tsx` — Day grouping header
- [ ] `Directors.tsx` — Director names
- [ ] `MovieLinks.tsx` — External links (TMDB, Letterboxd, etc.)
- [ ] `MoviePoster.tsx` — Large poster
- [ ] `MovieTitle.tsx` + `OriginalTitle.tsx` + `ReleaseYear.tsx` — Title block
- [ ] `ReportShowtimeButton.tsx` — "Report an issue" dialog (incorrect movie/time, etc.)

**Showtimes:**
- [ ] `ShowtimesPage.tsx` — Showtimes list page
- [ ] `MainShowtimesPage.tsx` — Main (all-cinemas) showtimes view
- [ ] `MyShowtimesPage.tsx` — User's own upcoming showtimes
- [ ] `Showtimes.tsx` — Showtime list rendering
- [ ] `ShowtimeCard.tsx` — Individual showtime card
- [ ] `ShowtimeInfoBox.tsx` — Showtime metadata
- [ ] `DatetimeCard.tsx` — Date/time display

**Friends:**
- [ ] `FriendsPage.tsx` — Friends list page
- [ ] `Friends.tsx` — Friends grid
- [ ] `FriendsTopBar.tsx` — Search and tab bar
- [ ] `UserCard.tsx` — Friend card ⚠️ Large (246 LOC)
- [ ] `SearchUsers.tsx` — User search for adding friends
- [ ] `ReceivedRequests.tsx` + `SentRequests.tsx` — Pending requests

**Pings:**
- [ ] `PingsPage.tsx` — Showtime pings list ⚠️ Large (259 LOC)

**Settings:**
- [ ] `UserInformation.tsx` — Profile form ⚠️ Large (195 LOC)
- [ ] `ChangePassword.tsx` — Password change form
- [ ] `Notifications.tsx` — Notification preferences
- [ ] `Appearance.tsx` — Theme preference
- [ ] `DeleteAccount.tsx` + `DeleteConfirmation.tsx` — Account deletion

**UI primitives (`components/ui/`):**
- [ ] Review generated Chakra UI wrappers — understand what each one does

**Admin (`components/Admin/`):**
- [ ] `AdminGuard.tsx` — Renders Forbidden for non-superusers
- [ ] `AdminOverview.tsx` — Analytics overview (logins, feature usage, invite/notification rates)
- [ ] `AdminMovies.tsx` — Movie-record edit form + TMDB lookup-cache override form
- [ ] `AdminShowtimes.tsx` — Showtime search, inline edit, delete
- [ ] `AdminReports.tsx` — Showtime-report triage (resolve/dismiss)

---

## Frontend — Hooks

**Frontend-only hooks (`frontend/src/hooks/`):**
- [ ] `useCustomToast.ts` — Toast notification helper
- [ ] `useInfiniteScroll.ts` — Infinite scroll detection
- [ ] `useIsMobile.ts` — Responsive breakpoint detection

**Shared data hooks (`shared/hooks/`):**
- [ ] `useAuth.ts` — Login, logout, token management
- [ ] `useGetUser.ts` — Fetch current user
- [ ] `useFetchMovies.ts` — Movie list with filters
- [ ] `useFetchMovieShowtimes.ts` — Showtimes for a single movie
- [ ] `useFetchMainPageShowtimes.tsx` — All showtimes for the main view
- [ ] `useFetchMyShowtimes.ts` — Current user's selected showtimes (mobile now uses `useFetchAgenda.ts` instead; web may still use this)
- [ ] `useFetchAgenda.ts` — Mobile agenda feed: going + interested + invited showtimes (GET /me/agenda)
- [ ] `useFetchUserShowtimes.tsx` — Another user's showtimes
- [ ] `useFetchCinemas.ts` — Cinema list
- [ ] `useFetchSelectedCinemas.ts` — User's selected cinemas
- [ ] `useFetchFriends.ts` — Friend list
- [ ] `useFetchUsers.ts` — User search results
- [ ] `useFetchReceivedRequests.ts` + `useFetchSentRequests.ts` — Pending requests
- [ ] `useFetchShowtimePings.ts` + `useFetchUnseenShowtimePingCount.ts` — Pings
- [ ] `useFetchFavoriteFilterPreset.ts` — Saved filter preset
- [ ] `useSessionCinemaSelections.ts` — Session-level cinema filter state
- [ ] `useSessionDaySelections.ts` — Session-level day filter state
- [ ] `useSessionTimeRangeSelections.ts` — Session-level time range state
- [ ] `useSessionRuntimeRangeSelections.ts` — Session-level runtime range state
- [ ] `useSessionShowtimeAudience.ts` — Session-level audience filter (mobile no longer uses the Only You / Including Friends distinction; web may still use this)
- [ ] `useSessionShowtimeFilter.ts` — Combined session filter state
- [ ] `useSessionWatchlistOnly.ts` — Session-level watchlist toggle
- [ ] `useTrackEvent.ts` — Fire-and-forget POST /me/events for usage analytics (web + mobile)

---

## Shared (`shared/`)

- [ ] `storage.ts` — Async storage abstraction (localStorage web / AsyncStorage mobile)
- [ ] `types.ts` — Shared TypeScript types across web and mobile
- [ ] `utils.ts` — Shared utility functions
- [ ] `client/` — Auto-generated OpenAPI client (do not edit manually)
- [ ] `authRefresh.ts` — Axios interceptor: transparently refreshes the access token on 401 (moved from `mobile/utils/auth-refresh.ts` so web shares it too)

---

## CI/CD (`.github/workflows/`)

- [ ] `test-backend.yml` — When does this run? What does it test?
- [ ] `lint-backend.yml` — Ruff + mypy linting
- [ ] `generate-client.yml` — When is the TS client regenerated?
- [ ] `deploy-staging.yml` — Staging deployment trigger and process
- [ ] `deploy-production.yml` — Production deployment (manual trigger)
- [ ] `test-docker-compose.yml` — Full-stack compose smoke test
- [ ] `smokeshow.yml` — Coverage report upload
- [ ] `latest-changes.yml` — Changelog generation
- [ ] `issue-manager.yml` — Issue triage automation

---

## Configuration & Infrastructure

- [ ] `docker-compose.yml` — Full local stack (backend, frontend, db, adminer)
- [ ] `docker-compose.traefik.yml` — Production stack with reverse proxy
- [ ] `backend/Dockerfile` — Backend image (multi-stage, uv, uvicorn)
- [ ] `frontend/Dockerfile` — Frontend image (Vite build + Nginx)
- [ ] `.env` structure — What variables are required? What are the defaults?
- [ ] `alembic/versions/` — 73 migrations: understand the schema evolution
- [ ] `.pre-commit-config.yaml` — What hooks run on commit?

---

## Cross-cutting Concerns (review after individual files)

- [ ] Error handling: are all services using domain exceptions consistently?
- [ ] Logging: is Loguru used consistently throughout?
- [x] Auth: refresh tokens implemented (30 min access / 90 day refresh); both web and mobile now auto-refresh via `shared/authRefresh.ts`
- [ ] Test coverage: reach 80%+ on services and CRUD
- [ ] Frontend tests: set up Vitest + React Testing Library
- [ ] API rate limiting: evaluate adding slowapi
- [ ] Duplicate code in scrapers: strengthen base_cinema_scraper.py
