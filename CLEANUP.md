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
- [x] `client_version.py` — Dotted-integer version parsing/comparison for the mobile update gate
- [x] `middleware.py` — `ClientVersionGateMiddleware`: 426s requests from mobile builds older than `MIN_SUPPORTED_CLIENT_VERSION`

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
- [x] `scrape_recap.py` — Stored per-run scrape recap (stitched into one daily email)
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
- [x] `scrape_monitor.py` — Admin scrape-run/recap response shapes (deltas + anomaly flags)
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
- [x] `scrape_monitor.py` — Read-only aggregation of ScrapeRun/ScrapeRecap for the admin scrape monitor (deltas + anomaly flags)

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
- [x] `cineville_client.py` — Shared Cineville POST helper with 429/5xx retry + backoff
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
- [ ] Add tests for `crud/showtime_visibility.py` (default-mode resolution covered by `tests/crud/test_showtime_visibility_defaults.py`)
- [ ] Add tests for `crud/user.py` (time-range filtering)
- [ ] `tests/api/test_admin.py` — Admin route gating, analytics overview, movie/showtime moderation, showtime reports

---

## Frontend — Entry & Config (`frontend/src/`)

- [ ] `main.tsx` — App entry point, React Query setup, Axios interceptors
- [x] `theme.tsx` — Chakra UI theme: app `semanticTokens` (light+dark) from `theme/tokens.ts`, plus `ui.main` + button recipe
- [x] `theme/tokens.ts` — Generates Chakra `app.*` semantic color tokens from `shared/theme/colors.ts` (matches the mobile palette, no drift)
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
- [ ] `Sidebar.tsx` + `SidebarItems.tsx` — Desktop sidebar (legacy; still used by standalone MoviePage, replaced by NavRail elsewhere)
- [x] `NavRail.tsx` — Slim desktop icon nav rail (app-parity rebuild); replaces Sidebar in `_layout`
- [x] `nav-items.ts` — Shared nav entry list used by NavRail + BottomNavBar
- [x] `BottomNavBar.tsx` — Mobile-web bottom navigation (now app-token themed, shares nav-items.ts)
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

**Showtimes (app-parity rebuild):**
- [ ] `ShowtimesPage.tsx` — Per-user showtimes list page
- [x] `MainShowtimesPage.tsx` — Main showtimes view: 3-zone master-detail (filters | list | detail drawer)
- [ ] `MyShowtimesPage.tsx` — User's own upcoming showtimes
- [x] `Showtimes.tsx` — Showtime card list (optional select/onSelect for the detail drawer)
- [x] `ShowtimeCard.tsx` — Showtime card redesigned to match the app (date column, badges, status tint, selected ring)
- [x] `ShowtimeDetailDrawer.tsx` — Right slide-over: set status, audience, invite banner, movie link
- [x] `useUpdateShowtimeStatus.ts` — Going-status mutation with optimistic list patch (candidate to share with mobile)
- [x] `badges/CinemaPill.tsx` + `badges/FriendBadges.tsx` + `badges/SubtitlesBadges.tsx` — Card badges ported from the app
- ~~`ShowtimeInfoBox.tsx`~~ + ~~`DatetimeCard.tsx`~~ — deleted (folded into the new ShowtimeCard)

**Filters (`components/Filters/`, app-parity rebuild):**
- [x] `FiltersSidebar.tsx` — Always-open desktop filters panel (status, days, subtitles/language, group-by, watchlist, cinemas; time/runtime/lists/presets to come)
- [x] `useShowtimeFilters.ts` — Showtimes-filter state over the shared `useSession*` hooks + derived query filters
- [x] `cinema-grouping.ts` — Group cinemas by city (≥3 → own section, else "Other cinemas"), ported from the app's CinemaFilterModal
- [x] `CinemaFilterSection.tsx` — Grouped cinema chips with per-city + global select-all

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
- [x] `useThemeColors.ts` — Raw app palette for the active light/dark mode (web mirror of the mobile hook), for dynamic colors that aren't static tokens

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
- [x] `useShowtimeVisibility.ts` — Showtime visibility mode: per-showtime read plus a coalesced batch prefetch that seeds the cache so the showtime sheet opens without a loading state
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
- [x] `updateRequired.ts` — Axios interceptor: surfaces the backend's 426 Upgrade Required (client-version gate) to the app as a callback
- [x] `theme/colors.ts` — Single source for the app color palette, light + dark (moved out of `mobile/constants/theme.ts`; mobile re-exports it, web builds Chakra tokens from it)
- [x] `filters/day-filter-utils.ts` — Day-selection token model + API resolution, shared by web + mobile (moved out of `mobile/components/filters/`, which now re-exports it)

---

## Mobile — Components (`mobile/components/`)

Only components created or reworked during the cleanup are listed here; the rest of
`mobile/components/` predates this checklist.

- [x] `ui/ConfirmDialog.tsx` — Reusable themed confirm dialog (fade + scale over a dimmed backdrop); the app-wide replacement for `Alert.alert` whenever the user is asked to decide something
- [x] `ui/AnimatedHeight.tsx` — Measures its children and tweens its own height to match, for content that grows and shrinks under the user (search results arriving, an empty state replacing a list). Used instead of `LayoutAnimation` where the change comes from a query resolving rather than a tap, since `configureNext` has to be armed before the update that moves things
- [x] `ui/LoadMoreFooter.tsx` — The spinner at the bottom of a paginated list, tweening its own height and opacity so a loaded page glides in instead of snapping up a whole row the instant the spinner unmounts. Shared by every infinite list (showtimes, movies, friends, cinema/friend/movie detail). Not `AnimatedHeight`: there is nothing to measure, and the fade has to run *with* the collapse rather than after it
- [x] `auth/AuthScreenShell.tsx` — The frame every auth screen sits in (brand mark, title, subtitle, keyboard handling, and the error banner, which is tweened in rather than inserted under the user). Exists so log in / sign up / pick a username / recover password cannot drift apart — this is the first thing anyone sees of the app
- [x] `auth/AuthTextField.tsx` — Labelled auth input: focus recolours a border that is always there (so focusing cannot reflow the form), validation messages are tweened in, and a password field gets a reveal toggle
- [x] `auth/AuthPrimaryButton.tsx` — The one call to action on an auth screen; keeps the label mounted under the spinner so a button that starts working does not resize
- [x] `auth/SocialSignInSection.tsx` — "Continue with Apple / Google" plus the divider above the email form, shared by log in and sign up, which used to carry a verbatim copy of both handlers each. Both buttons commit to a busy state on tap, and the Apple button follows the colour scheme (a black button on the dark theme was a rectangle you could only find by its text)
- [x] `auth/GoogleMark.tsx` — Google's four-colour "G", drawn with `react-native-svg` as their sign-in branding guidelines require
- [x] `friends/UserSearchResults.tsx` — The results under a "find a friend" search box, shared by the intro's friends page and the add-friends tip. Debounced, keeps the previous results up while the next load, and tweens its height, so typing does not kick the invite card below it down the page
- [x] `friends/FriendVisibilityControl.tsx` — Per-friend "Can see your showtimes: Always / Only when invited" segmented control (writes `shares_status`)
- [x] `friends/FriendCard.tsx` — Friends-tab row: initial avatar, relationship-aware primary/ghost actions, remove-friend confirm, inline visibility control
- [x] `friends/InlineFriendRequestButtons.tsx` — Icon-only request controls for invite lists; now shares `useFriendActions` with `FriendCard`
- [x] `friends/FriendListRow.tsx` — One person in a friend list: colored initial avatar, name, optional watch marker, and either a labelled "Invite" button (only the button invites, so a stray tap can't) or static/tappable display (renamed from `FriendInviteRow.tsx`, which invited on a whole-row tap behind a bare `+`)
- [x] `friends/FriendWatchListModal.tsx` — Shared "Watchlisted" / "Watched" popup listing the friends behind the small markers; static on a movie page, with invite buttons when opened from a showtime
- [x] `friends/friend-watch-kind.ts` — Icon/color/wording for the two Letterboxd relationships, so every screen marks watchlisted/watched identically
- [x] `utils/avatar-color.ts` — Deterministic avatar tint + initial for a user id, shared by every list that draws a person as a colored circle
- [x] `hooks/useFriendActions.ts` — The five friendship mutations (send/accept/decline/cancel/remove) with shared invalidation + error handling
- [x] `hooks/useFriendStatusSharing.ts` — Debounced, serialized writes for the per-friend visibility setting; local intent wins over query data until the server agrees (the backend rebuilds all effective-visibility rows per write, so overlapping requests collide)
- [x] `tips/FeatureTipsHost.tsx` — Renders at most one feature tip: computes each tip's eligibility and lets `useFirstVisibleTip` pick the winner, so the user never faces a stack of nags. Gated on screen focus, since the tip is a blocking dialog and the host's tab screen stays mounted
- [x] `tips/FeatureTipModal.tsx` — Shared shell for every feature tip: a blocking dialog with icon/title/optional message, an optional inline control, an optional collapsible help section, the action button, and a quiet "Don't show this again" checkbox (pinned below the action, no section of its own) read on whichever way the dialog closes. `density="compact"` shrinks the header for a tip whose own content needs the room, and exports its padding so a child can run full width
- [x] `tips/LetterboxdUsernameTip.tsx` — Tip shown when no Letterboxd username is set; takes the username inline rather than sending the user to Settings
- [x] `utils/feature-tips.ts` — Feature-tip store: master switch + permanent dismissals in SecureStore, session snoozes and their notification-centre reminders in memory; subscriber model copied from `theme-preference.ts`. Holds `FORCED_TIP_ID`, the dev override that pins one tip on screen while it's being designed
- [x] `notifications/NotificationRowLayout.tsx` — Shared visual shell for a notification row (accent icon circle, title/subtitle, relative time, unseen dot, dismiss ✕), extracted from `NotificationRow` so backend feed items and local feature-tip reminders cannot drift apart
- [x] `notifications/FeatureTipNotificationRow.tsx` — A snoozed feature tip in the notification centre; tapping it reopens the tip dialog, so a suggestion the user closed is recoverable rather than gone
- [x] `notifications/NotificationPreferenceList.tsx` — The four notification preferences, one line each, as a single Off/Push/Email segmented control per row (replacing a switch plus a second delivery row); shared by the Settings screen and the notification-permission tip
- [x] `hooks/useNotificationPreferences.ts` — Preferences state, delivery channels, OS permission and the optimistic writes behind them, lifted out of `settings.tsx` so the tip drives the same logic. Also exports `useSystemNotificationPermission` (permission state alone, for tip eligibility; re-reads on foreground so a change made in system settings lands), `wantsPushNotifications`, and `openSystemSettings` (the never-rejecting settings hand-off every caller uses). `requestSystemPermission` never rejects either — token registration throws for reasons unrelated to the user's answer
- [x] `tips/NotificationPermissionTip.tsx` — Tip shown when the OS blocks notifications while the user still wants pushes; offers the prompt (or system settings once the OS stops asking) alongside the full preference list
- [x] `tips/CinemaPresetTip.tsx` — Tip shown when the user still browses every cinema and has saved no preset; opens straight onto the cinema picker (seeded from the current selection, full-bleed and sized to every pixel the dialog chrome is not using, so the save button and dismissal controls never move off screen), then asks for a name in a second dialog and saves it as the favorite
- [x] `filters/CinemaPickerList.tsx` — Compact grouped cinema picker (per-city sections with a select-all shortcut, wrapping outline checkbox chips), shared by the cinema-preset tip and the `CinemaFilterModal` sheet so cinemas are picked identically in both. Per-city deselecting is opt-in (`onDeselectCinemas`): a dialog gets one global clear, the sheet is long enough to want it per section. Chips are outlines so the list suits either surface; presentational, the caller owns the selection
- [x] `tips/FilterPresetTip.tsx` — Tip shown when the user filters showtimes but has saved no preset; offers their current selection plus a catalogue of ready-made presets, each added with its own labelled button, and its action opens the filters modal (deferred to the dismissal so it does not race the fade)
- [x] `filters/premade-filter-presets.ts` — The five suggested presets and the builder that turns one into a `SavedPresetCreate`. Partial presets ("Hide Watched", "Short") name every other dimension, including each Letterboxd list, as untouched so applying them cannot clear filters they never mentioned
- [x] `ui/NamePromptDialog.tsx` — The input-bearing sibling of `ConfirmDialog`: one short string, same fade/scale timing, hands the caller a trimmed name so no flow has to hold draft text of its own
- [x] `filters/cinema-grouping.ts` — City grouping + canonical `sortCinemaIds`/`serializeCinemaIds` for a selection, extracted from `CinemaFilterModal` so the sheet and the preset tip group and compare selections identically (mobile twin of the web `Filters/cinema-grouping.ts`)
- [x] `filters/cinema-presets.ts` — Shared cinema-preset data access: one query key, `useCinemaPresets`, and `invalidateCinemaPresets` (presets + cinema selections), so the sheet, the tip and tip-eligibility all read and invalidate the same cache entry
- [x] `filters/FilterSection.tsx` — The two shapes a Filters-modal section can take, together so their heading metrics cannot drift. `FilterSection` is collapsible: uppercase heading, caret that spins 180° on the native thread, children unmounted while collapsed, every section closed by default so opening the modal costs almost nothing. Only the collapse gets the height tween — expanding mounts the content in the same frame and animating that janks. `FilterInlineRow` is the one-control section (Group By, Marked by Friends as, Language): a caret there would cost a tap and save no space, so label and control share a line, and the label wraps rather than squeezing the control. `FilterSubLabel` is the heading one step down, for a block inside a section (Movie Length, Curated lists), shared with `FilterMoviesSection`. An optional `summary` shows what a collapsed section is filtering on next to its caret
- [x] `filters/LetterboxdUsernamePrompt.tsx` — Takes the place of the watchlist/watched filters when no Letterboxd username is set: a muted card naming what those filters would do, plus the field that switches them on. Saving invalidates `currentUser`, which flips `canUseWatchlistFilter` and swaps the card for the real controls
- [x] `hooks/useSaveLetterboxdUsername.ts` — The save-username mutation shared by the feature tip and the filters-modal prompt, so both invalidate the same cache entry and report failure identically
- [x] `ui/SegmentedControl.tsx` — Compact pill track with the selected option as a filled thumb, for an either/or choice that should cost one line rather than a wrapping row of loose pills. Per-option thumb colors let a neutral default ("Any") avoid reading as switched on while the real options keep the app's status colors. A `stretch` + `size="large"` pair widens it into screen-level navigation (the Friends tab's Friends / Find people header) without disturbing the compact settings-row default
- [x] `utils/expand-animation.ts` — Shared caret-spin duration + `LayoutAnimation` config for disclosure toggles (and Android's `setLayoutAnimationEnabledExperimental` opt-in), so `FilterSection` and `ShowtimeActionModal`'s invite/visibility toggles open and close at the same speed
- [x] `filters/DaysFilterSection.tsx` — The Filters modal's Days section: the three relative days as cards labelled with the date they resolve to, the seven weekdays as one chip row, a summary line naming every selection (with Clear), and the row that opens the calendar. Every token the section can produce is reachable without opening a sheet; selections are canonicalized first so an ISO date for today lights up the Today card instead of hiding in the calendar row
- [x] `filters/SpecificDatesModal.tsx` — Calendar sheet behind that row (six months of month grids, applied on close). Draws today/tomorrow/day-after as selected even though they are relative tokens — and clears the token when such a day is tapped — so no day is shown unselected while it is being filtered on. Weekday tokens are left alone, including by "Clear dates"
- [x] `utils/auth-session.ts` — Whether there is a signed-in session, as the app's navigation sees it. The stored token is read exactly once, at startup; every transition after that is announced synchronously by whoever caused it (`completeLogin` in, logout/401 out). Re-deriving it from SecureStore on every route change made the guard disagree with the navigation it was guarding for a frame or two, which showed up as a login that hung and then flicked through the wrong screen on its way to the right one
- [x] `hooks/useDebouncedValue.ts` — Settles on a value once it stops changing, so a search field is one request per word rather than one per keystroke
- [x] `hooks/useLayoutAnimatedValue.ts` — Mirrors a value one frame late so the layout change it causes is tweened, for values arriving as props (a form error, a server error) where `LayoutAnimation.configureNext` cannot be armed in time
- [x] `constants/auth.ts` — Email pattern + password minimum, shared by the auth screens that were each carrying their own copy
- [x] `utils/intro.ts` — First-run intro store: the pending flag (set when an account is created, so existing users updating the app never get an intro) in SecureStore, the current phase in memory, same subscriber model as `feature-tips.ts`. Cleared on finish/skip rather than on start, so an app killed halfway through gets another go
- [x] `intro/IntroHost.tsx` — Mounts the walkthrough once the user is in the tabs (a social sign-in is authenticated while still picking a username, and an intro over that form would cover it). Only the start is gated; once running the intro stays put. No longer waits for the splash: the intro is a Modal, so it draws *above* the splash overlay, which is exactly what stops the app being revealed for a beat before the walkthrough covers it back up
- [x] `intro/IntroFlow.tsx` — The four pages, the progress row and the always-reachable "Skip tutorial". One Modal for all of them: opaque for the three that own the screen, see-through for the showtime tour, whose sheet is rendered as a sibling of the Modal so it shows behind it rather than under it. Takes the screen instantly and animates its *contents* in (fading the window itself showed whatever it was covering through the fade); leaving does fade, since by then the app underneath is the point. Pages crossfade into each other rather than hard-cutting
- [x] `intro/IntroPageShell.tsx` — Shared shell for a full-screen intro page (icon, title, message, the page's own content, primary button and a quiet escape hatch), the intro's counterpart to `FeatureTipModal`
- [x] `intro/IntroCinemasPage.tsx` — Page 1: the cinema picker, saved as the favorite preset under a fixed name ("Favorites" — a ten-second-old account should not be asked to name anything) and applied to the session; retires the cinema-preset tip
- [x] `intro/IntroLetterboxdPage.tsx` — Page 2: the username, inline, with "I don't use Letterboxd" — which retires that tip for good, so the app never asks again about a service the user has said they don't have
- [x] `intro/IntroShowtimeSheet.tsx` — Page 3's subject: the real `ShowtimeActionModal` over invented data, mounted outside the intro's Modal on purpose (the sheet portals into the app root, and a Modal is a window above it)
- [x] `intro/IntroShowtimeTour.tsx` — Page 3's script and overlay: three steps walking a spotlight across Interested, Going and Invite friends
- [x] `intro/demo-showtime.ts` — The showtime the tour points at: the first real one the list would show (real film, poster, cinema, time), dressed with invented friends and a sentinel id that matches no real showtime
- [x] `intro/SpotlightOverlay.tsx` — Dim-with-a-hole overlay: four panes around a measured rect, a pulsing ring, and a caption card in whichever gap is bigger. Four panes rather than an SVG mask, so the hole is genuinely untouched and a caller can let the real control be tapped through it (`onPressTarget`)
- [x] `intro/IntroFiltersSpotlight.tsx` — The intro's last step, owned by the showtimes screen rather than the flow because it waits for that screen's list to load, its tab to be focused, and nothing else to be open. The highlighted button is real: tapping it opens the filters. Renders nothing until the button has actually been measured — presenting first and measuring after showed the caption in its unmeasured fallback position and then jumped it down to the button. If the measurement never lands it ends the intro rather than leaving the phase parked forever
- [x] `sheets/SheetBackdrop.tsx` — The dimmed backdrop behind every sheet (`AppBottomSheet` and `ShowtimeActionModal`). A near-copy of gorhom's `BottomSheetBackdrop` that separates the fade from touchability: gorhom drops both at `disappearsOnIndex`, which for a modal must be -1, so the invisible backdrop went on swallowing touches for the whole close animation and the screen behind stayed dead for a beat after the sheet was dismissed. Here it stops taking touches as soon as the sheet leaves its open position, while the fade still runs to -1
- [x] `utils/blocking-overlays.ts` — Live registry of the blocking surfaces the layout-level providers own (showtime sheet, filters/cinema sheets, notification centre), for anything that has to be the *only* thing in front of the user rather than merely on top. A set, not a boolean, so a dialog over a sheet unregisters independently. Each surface registers *how to close itself* as well, so the intro can guarantee a clear screen (`closeAllBlockingOverlays`) instead of waiting and hoping for one — a filters sheet left open before a replay was still sitting there when the walkthrough ended. `useIsFocused` cannot see these: they are windows, not routes
- ~~`filters/DayFilterModal.tsx`~~ — deleted (its shortcut lists moved inline into `DaysFilterSection`, its calendar into `SpecificDatesModal`)
- ~~`tips/FeatureTipCard.tsx`~~ — deleted (the inline card was superseded by the blocking `FeatureTipModal`)
- [x] `hooks/useSingleFireNavigation.ts` — Wraps a `router.push`/`replace` call so a double-tap only fires it once; `expo-router` navigation is async, so a disabled-on-submit re-render lags behind a fast double-tap and stacks the destination screen twice. Resets on screen focus. Rolled out to every push-on-press site found across the app (movie/friend/cinema cards, showtime long-press, login's sign-up/forgot-password links, the notification centre)

---

## Mobile — Docs (`mobile/`)

- [x] `RESPONSIVE_AUDIT.md` — Screen-by-screen responsive/layout audit against a device matrix (SE → tablet). Records every layout risk and inconsistency found, which were fixed, and which are left as recommendations because they need a product decision or a screen restructure. Findings 15-22 are the open items.

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
