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
- [x] `middleware.py` — `ClientVersionGateMiddleware`: 426s requests from mobile builds older than that platform's `MIN_SUPPORTED_CLIENT_VERSION_*`. Per-platform floors, because App Store review runs weeks behind Play and a shared floor would hold the faster store hostage to the slower one
- [x] `viewer.py` — `ViewerId` (`UUID | None`): who a read is being annotated for. `None` is a legitimate anonymous viewer, entitled to the public catalogue and none of the personal annotations — threaded through the browse routes, services, converters and crud so one code path serves signed-in and signed-out alike
- [x] `username_filter.py` — Objectionable-username denylist for App Store guideline 1.2 (slurs, child-safety terms, hardcore sexual content, staff impersonation only — deliberately minimal, see its module docstring); leet-speak folding + a small `_ALLOWED_WORDS` strip to dodge the Scunthorpe problem (`Hitchcock` must pass)
- [x] `apple_auth.py` — Apple's OAuth token endpoints as a *client* (code exchange at sign-in, revocation at account deletion) — required so deleting an account also revokes its Sign in with Apple tokens (guideline 5.1.1(v)). Fails soft throughout: nothing here may block an account deletion

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
- [x] `mailer.py` — Email sending and template rendering (split out of `utils.py`; not named `email.py` because it would shadow stdlib `email`). Templates live in `email-templates/src/*.mjml` (source) and `email-templates/build/*.html` (rendered); `verify_email` is the "confirm your email" message sent at registration, whose link points straight at the API (`GET /users/verify-email`) rather than through the frontend, like the digest's unsubscribe link. Note `mjml` is not a project dependency and there is no build script, so `build/*.html` is edited by hand and `src/*.mjml` kept in sync manually — `watchlist_digest.html` is now plain hand-written table HTML rather than MJML output. All mail is multipart/alternative; `_html_to_plain_text` derives the text part for generators that don't hand-write one
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
- [x] `routes/letterboxd_lists.py` — The curated (shared, non-account) Letterboxd lists, readable without a token — filtering the catalogue by the Top 250 is browsing, not an account action; adding/removing your own lists stays on `/me/letterboxd-lists`
- [x] `routes/users.py` — User lookup endpoints (admin + public profiles)
- [x] `routes/utils.py` — Utility endpoints (health check, TMDB cache override)
- [ ] `routes/admin.py` — Superuser-only endpoints (analytics overview, movie/showtime moderation, showtime reports)

---

## Backend — Models (`backend/app/models/`)

> Models are SQLModel classes — they define both the database table schema and
> the base data shape. Each model corresponds to one database table.

- [x] `auth_schemas.py` — Token and token-payload shapes (not a DB model)
- [x] `user.py` — User account (email, password hash, settings, flags)
- [x] `cinema.py` — Cinema venue (`key` identity + display `name` + `aliases`, city, seating preset). `CinemaBase` holds only what clients are served; `key`/`aliases` are backend-only and sit on `Cinema`/`CinemaCreate`
- [x] `cinema_selection.py` — Which cinemas a user has selected
- [x] `cinema_preset.py` — Saved named sets of cinema selections
- [ ] `saved_preset.py` — `cinema_preset_id` (new): when set, a `SavedPreset` follows a `CinemaPreset` live instead of its own frozen `cinema_ids`/`cinema_scope`, which are kept in sync as the fallback used if the linked preset is ever deleted
- [x] `movie.py` — Movie metadata (title, duration, genres, poster). Positive id = TMDB id; negative id = synthetic listing (e.g. sneak preview) via `sneak_preview_movie()` / `is_synthetic_movie_id`
- [x] `showtime.py` — Individual screening (datetime, cinema, movie, ticket link)
- [x] `showtime_selection.py` — User's going/interested status on a showtime
- [x] `sold_out_watch.py` — One user waiting on one full showtime for a returned ticket. Unique `user_id` (not a compound key with the showtime) is the "one watch at a time" rule; one-shot, deleted once it finds a seat
- [x] `cinema_room_capacity.py` — Largest seat count ever seen in one room of one cinema, keyed `(cinema_id, room)`. Shared across every screening in the room, which is what lets the estimate converge at all — a single showtime is read a handful of times, a busy room hundreds
- [x] `showtime_seat_map.py` — Which individual seats were taken at a showtime's last reading, keyed by showtime. The per-seat half of a seat availability reading, written by the same poller pass from the same response; kept off `Showtime` because every catalogue query selects that row in full and exactly one endpoint ever wants this. Absent means "unknown", never "nothing taken"
- [x] `showtime_ping.py` — Notification sent to a friend about a showtime
- [ ] `showtime_ping_link.py` — Short opaque code (not a self-contained token) mapping a shared `/ping/{showtime_id}/{token}` invite link back to who minted it and for which showtime
- [x] `notification.py` — Notification-centre entry (match / invite-response / request-accepted)
- [x] `showtime_visibility.py` — Per-showtime visibility mode + effective-visibility cache
- [x] `showtime_source_presence.py` — Tracks which scraper provided a showtime
- [x] `scrape_run.py` — Metadata about each scraping execution
- [x] `scrape_recap.py` — Stored per-run scrape recap (metrics + HTML + attachments; the day's rows are rendered into one email)
- [x] `friendship.py` — Accepted friend relationships (+ per-friend `shares_status`)
- [x] `filter_preset.py` — Saved filter configurations (movies or showtimes scope)
- ~~`friend_group.py`~~ — deleted (friend groups retired in the visibility overhaul)
- [x] `letterboxd.py` — Cached Letterboxd watchlist data per user
- [x] `watchlist_selection.py` — Movies on a user's watchlist
- [x] `push_token.py` — FCM device tokens for push notifications
- [x] `tmdb_lookup_cache.py` — Cache of title → TMDB ID resolutions
- [x] `city.py` — City (currently Amsterdam only)
- [ ] `watchlist_digest_queue_entry.py` — Movies newly available for the watchlist digest (queued once, ever)
- [ ] `watchlist_digest_notified_movie.py` — Per-*source* record of movies already sent/seen in the digest (keyed `(source_id, movie_id)`, not per-user, since one user's sources are notified independently)
- [ ] `watchlist_digest_source.py` — A user's watchlist digest source (may have several): frequency, list/watchlist, cinema restriction (saved preset or one-off custom ids, never persisted as a preset)
- [ ] `analytics_event.py` — Single usage-analytics event (name + free-form properties)
- [ ] `showtime_report.py` — User-submitted report that a showtime is wrong
- [x] `user_block.py` — One user blocking another; directional storage, symmetric effect (see `crud/user_block.is_blocked_either_way`)
- [x] `user_report.py` — User-submitted report about another user; mirrors `showtime_report.py`

---

## Backend — Schemas (`backend/app/schemas/`)

> Schemas are Pydantic models used as API response shapes. They are richer than
> raw models — they may include computed fields or join data from related tables.
> Converters (below) transform models into schemas.

- [ ] `user.py` — Public/private user representations
- [ ] `cinema.py` — Cinema response shape
- [ ] `movie.py` — Movie response shape. `MoviePublic`/`MovieSummaryPublic` are the film itself; whatever depends on who asked lives under a nullable `viewer` block (`MovieViewerState`/`MovieSummaryViewerState`), absent for an anonymous read
- [ ] `showtime.py` — Showtime response shape. Same split: `ShowtimePublic`/`ShowtimeInMoviePublic` are public, `ShowtimeViewerState`/`ShowtimeInMovieViewerState` carry selections, invites and friend annotations. The two viewer shapes differ rather than sharing one with empty defaults, so an empty list always means "none" and never "we didn't look"
- [x] `legacy_viewer_compat.py` — TEMPORARY. Deprecation note shared by the flat `going`/`friends_going`/... mirrors that keep pre-1.1.0 app builds working now that those fields live under `viewer`. Delete this file and the `LEGACY_VIEWER_FIELDS` blocks once no old build is still calling
- [ ] `showtime_ping.py` — Ping response shape
- [x] `notification.py` — Merged notification-centre feed item shape
- [x] `showtime_visibility.py` — Per-showtime visibility mode response shape
- [x] `seat_availability.py` — `ShowtimeSeatAvailabilityPublic` (busyness level + counts + when it was read + whether a ticket watch applies here) and `SoldOutWatchPublic`. Viewer-independent on purpose, which is what lets it be prefetched and cached per showtime; a showtime with no usable reading is omitted from a batch rather than returned with nulls
- [ ] `cinema_preset.py` — Cinema preset response shapes: `CinemaPresetCreate` (with `overwrite`, the explicit opt-in to replacing a same-named preset), `CinemaPresetRename`, `CinemaPresetPublic`
- [x] `cinema_scope.py` — `CinemaScope`: a preset's cinema selection as the *rule* behind it (every cinema / whole cities / individual ones) rather than a frozen id list, so cinemas that open later land inside a selection the user meant to be open-ended
- [ ] `filter_preset.py` — Filter preset response shape
- [ ] `watchlist_digest_source.py` — WatchlistDigestSource create/update/public shapes; create/update validate `cinema_preset_id`/`custom_cinema_ids` are mutually exclusive
- [x] `friendship.py` — Friend status-sharing toggle request shape
- [ ] `push_token.py` — Push token registration shape
- [ ] `city.py` — City response shape
- [ ] `analytics_event.py` — Event create/public response shapes
- [ ] `analytics_dashboard.py` — Admin analytics-overview response shape
- [x] `scrape_monitor.py` — Admin scrape-run/recap response shapes (deltas + anomaly flags)
- [ ] `showtime_report.py` — Showtime report create/update/admin-view shapes
- [ ] `admin.py` — Admin movie/showtime moderation request/response shapes
- [x] `user_block.py` — Blocked-account list-row shape
- [x] `user_report.py` — User report create/update/admin-view shapes; `UserReportCreate.block_user` defaults true — reporting and blocking are one client gesture

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
- [ ] `showtime_ping_link.py` — Create/look-up for a shared invite link's short code
- [x] `notification.py` — Notification-centre row queries (upsert, feed, decay)
- [x] `sold_out_watch.py` — Sold-out watch reads/writes; `set_watch_for_user` moves the user's single row rather than delete-and-insert, so the one-per-user constraint never sees two
- [ ] `friendship.py` — Friend request and friendship queries (+ status-sharing)
- ~~`friend_group.py`~~ — deleted (friend groups retired)
- [ ] `cinema.py` — Cinema queries. Resolve by `get_cinema_id_by_key`; `get_cinema_id_by_name_or_alias` is only for names arriving from outside (Cineville venues). `upsert_cinema` matches on key so a rename in cinemas.yaml edits the row in place
- [ ] `cinema_preset.py` — Cinema preset CRUD; `resolve_preset_cinema_ids` is the only way ids come off a preset (it expands `cinema_scope`)
- [x] `cinema_scope.py` — Inferring a `CinemaScope` from ticked ids and expanding it again. Inference runs on the backend so installed builds get the follow-the-city behaviour without knowing rules exist; the two directions live together because they are inverses
- [ ] `filter_preset.py` — Filter preset CRUD
- [ ] `watchlist_digest_source.py` — WatchlistDigestSource CRUD (list/create/get/delete by owner)
- [ ] `watchlist.py` — Watchlist selection CRUD
- [ ] `push_token.py` — Push token registration and lookup
- [ ] `city.py` — City queries
- [ ] `analytics_event.py` — Event creation and dashboard aggregation queries
- [ ] `showtime_report.py` — Report creation, listing (joined), status updates
- [x] `user_block.py` — Block create/delete, symmetric `is_blocked_either_way`, `get_hidden_user_ids` (both directions folded into one set — the one every list-filtering caller wants)
- [x] `showtime_seat_map.py` — One showtime's taken-seat map. `record_seat_map` always replaces, never merges: a reading is a complete snapshot of the room, so merging would pin a freed seat as taken for ever
- [x] `user_report.py` — Report creation, duplicate-open-report check, listing (joined, scalar-subquery count so status filtering doesn't shrink it)

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
- [ ] `watched.py` — Watched-list sync logic
- [ ] `watchlist_digest_sources.py` — CRUD orchestration behind `/me/watchlist-digest-sources`: create/update/delete, the 5-source cap, and the "setting one of preset/custom clears the other" rule
- [x] `letterboxd_sync.py` — Shared sync cooldown for `watchlist.py`/`watched.py` (counts failed attempts, not just successes)
- [x] `viewer_context.py` — Settles the browse filters that depend on who is asking: fills in `selected_cinema_ids` from the account's favourite cinema preset (then its legacy selection), and resolves the Letterboxd username the watchlist filters read against. For an anonymous viewer it leaves cinemas unrestricted — the whole catalogue, not an empty feed — and drops Letterboxd list ids, which can only belong to an account. Replaces the copy of that block that sat in each of the four movie/showtime list+count entry points
- [ ] `scrape_sync.py` — Triggers scraping from the API layer
- [ ] `analytics_dashboard.py` — Aggregates AnalyticsEvent/Notification/ShowtimePing/User data for the admin overview
- [x] `seat_availability.py` — Decides which showtimes get their seat count re-read and what to write down. `seats_capacity` now comes from `CinemaRoomCapacity` when the room is known (shared across every screening in that room), else falls back to the per-showtime running max; a platform-reported exact total (Eagerly, Tricket) or a manual override always wins over either. `seat_availability_level` buckets a raw reading; `effective_seat_level` applies the ratchet on top — a screening's level is capped at its `seats_level_floor` (the fullest it has ever reached) and can only rise, never fall, except sold-out-to-not which is deliberately exempt. `apply_reading` returns whether that ratchet just crossed into `SEAT_ALERT_LEVELS`, which is the only trigger for the once-ever "nearly sold out" notice. Cadence is per showtime and written onto the row as `seats_next_check_at`, computed off the *effective* level so a ratcheted showtime keeps the cadence its shown level deserves; a run is capped both overall and per ticket host. `simulate_reading` drives the whole pipeline with made-up numbers for the superuser-only staging test hook — see `admin.py`
- [x] `sold_out_watch.py` — The one thing that polls a ticket shop hard, and every rule that keeps that affordable: one watch per user, `is_pro` to have one at all, a global `MAX_ACTIVE_WATCHES`, and a cadence that bursts on start, tapers through the middle, and ramps back up for the two hours before the screening when tickets actually get handed back. One-shot — it deletes itself the moment it finds a seat
- [x] `scrape_monitor.py` — Read-only aggregation of ScrapeRun/ScrapeRecap for the admin scrape monitor (deltas + anomaly flags)
- [x] `scrape_recap_render.py` — `RecapRunMetrics` + the recap renderer; the daily email is grouped by statistic (combined value, then each run's) instead of stitching per-run reports, and the long diagnostic dumps live in JSON attachments only
- [x] `showtime_title_conflict.py` — Recognizing the same screening listed by Cineville and a cinema scraper under near-identical titles; used both to stop the duplicate being inserted (`upsert_showtime`) and to clean up existing ones (`runner._delete_cineville_title_conflicts`). Also collects the resulting `SourceDisagreement`s, which the recap reports as TMDB matches to review
- [x] `moderation.py` — Blocking (a teardown of friendship/requests/invites + visibility rebuild, not a flag) and reporting another user, together — App Store guideline 1.2. Reporting blocks by default; the two are still separate rows so unblocking never withdraws a report. Mails the operator on every new report, best-effort

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
- [x] `cinema_preset_exceptions.py` — Cinema preset errors: not found, empty name, and the 409 raised when a preset name is already taken (create and rename both need it, and the client turns it into a "replace?" prompt rather than a failure)
- [ ] `watchlist_digest_source_exceptions.py` — Not found, per-user source limit reached, cinema-preset/custom-ids conflict
- [ ] `letterboxd_list_exceptions.py` — Letterboxd list scrape/sync errors
- [x] `moderation_exceptions.py` — Block/report self-target and not-found errors, plus `UserBlockedError` (deliberately vague — never tells the sender which direction the block runs, so it can't be used to confirm a block landed) and `ObjectionableUsernameError`

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
- [x] `seat_availability.py` — Turns a showtime's ticket link into a seat count, room, and (Eagerly, Tricket) exact room capacity. Four platforms, between them covering every cinema we scrape ourselves and a good many Cineville-only ones (Cineville's `ticketingUrl` is the cinema's own shop, so a cinema is read whether or not we scrape it): Z-ELITE (exact count in `data-configured-max`, max across badge types since some are per-order capped, no capacity), Tricket (the screening resource lists every seat in the room + `numberOfAvailableSeats`, so capacity is `len(seats)` — verified stable per `hallId` while availability moves, which is what makes it the room rather than the free list. Which seats are taken, and the room's layout, come from `/api/screenings/{id}/seats?basketId=` — one empty basket per host, reused for every reading and recreated on 404, which holds nothing since locking is a separate call. Gated on `TRICKET_SEAT_MAP_HOSTS`: Studio/K's map is decorative, its rooms are sold unreserved (`seating: free`), so only its count is read. Tricket names no room, so `TRICKET_ROOM_NAMES` maps Cinecenter's four `hallId`s to Zaal 1-4, joined once by hand off cinecenter.nl's own programme — without it a floor plan would have nothing to be filed under), Eagerly (exact count *and* exact capacity for all 8 sites — 10 cinemas, since Bioscopen Leiden runs Lido/Trianon/Kijkhuis off one feed with a booking app each, resolved by the feed's `cinema_id` through `eagerly_booking_host`, the only case where the ticket link's host is not enough — via each site's own unauthenticated `getSeatPlanData` seat-map endpoint — "ROL"/wheelchair-space entries excluded from both, falling back to the feed's sold-out-only status for any site not in the `EAGERLY_BOOKING_HOSTS` table, which is where Bioscopen Leiden sits). Eagerly links are recognised only on a host in `EAGERLY_SITE_HOSTS` — `/tickets/<number>` alone is too ordinary a path to identify a platform — and both tables are keyed on the host with any `www.` stripped, since our own scrapers and Cineville hand out different forms of the same site. ActiveTickets (9 tenants; every show page inlines the shop's Knockout view-model as `var jsonCart`, decoded from the opening brace with a real JSON parser rather than a regex). What it yields depends on how the room is sold: a numbered room ships its whole seat plan in `EditData.Seats` — availability, blocked flag, x/y and the row/seat names — so count, the room's real total and the taken map all come out of the one GET the link already needs, while a free-seating room ships no seats and only says sold-out-or-not. Four of the nine (Rialto De Pijp, De Balie, Cinebergen, Slieker) sell every room free-seating, so no count is possible there at any price. `TicketsAvailable`/`TicketsCapacity` exist on newer tenants and are deliberately unread — most don't send them, the ones that do send 0/0 for a screening whose sales have not opened, and the capacity is the sellable allocation rather than the room. A failed fetch raises rather than returning zero. `fetch_eagerly_room_geometry` is the floor-plan ingest's entry point: it only accepts a show's seat map for a room once the plan's own `screen_name` agrees, because the feed's room label and the booking system's screen disagree often enough to file one room's layout under another's name
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
- [ ] `cinemas/amsterdam/fchyena.py` — FC Hyena scraper; fixed 2026-08-24 after the Framer migration broke it — now reads the film catalogue out of the Framer CMS's binary export instead of scraping HTML (no server-rendered listing exists anymore); per-showtime ticket page scraping (Z-ELITE) is unchanged and unaffected
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
- [ ] `cinemas/generic/eagerly.py` — Eagerly-based generic scraper; fixed 2026-08-24 a double-slash bug in every derived URL (`self.url`, `ticket_link`) since every call site passes a trailing-slash `url_base` — `self.url_base` now strips it once in `__init__` instead

**Letterboxd integration:**
- [ ] `letterboxd/load_letterboxd_data.py` — Watchlist sync ⚠️ Large (1193 LOC) — needs splitting
- [ ] `letterboxd/watchlist.py` — Watchlist parsing
- [ ] `letterboxd/watched.py` — Watched ("films") parsing; blocked/partial-page detection
- [x] `letterboxd/rss.py` — Member RSS feed parsing; the cheap "anything new?" check the incremental watched sync runs instead of a full page walk
- [ ] `letterboxd/utils.py` — Letterboxd utilities, shared `SlugScrapeResult`

---

## Backend — Inputs (`backend/app/inputs/`)

- [ ] `movie.py` — Input validation models for movie-related endpoints

---

## Backend — Tests (`backend/tests/`)

> Current coverage: ~25%. Goal: 80%+. Prioritise services and large CRUD files.

- [ ] Review and understand existing test structure
- [ ] Check coverage report — identify untested services and CRUDs
- [ ] `tests/api/` — Route-level tests (are all endpoints covered?)
- [ ] `tests/crud/` — CRUD tests (are complex queries tested?); `test_seat_availability_candidates.py` covers the seat poller's selection + priority ordering
- [ ] `tests/services/test_seat_availability_interest.py` — the interest-triggered live read, its per-showtime cooldown, and the `checking` state the sheet shows
- [ ] `tests/services/` — Service tests (most critical layer)
- [ ] `tests/converters/` — Converter tests
- [ ] `tests/scraping/` — Scraper tests
- [x] `backend/scripts/preview-digest-email.py` — Renders every digest variant (Eager/Weekly x watchlist/chosen list/deleted list) to one browsable page through the real `generate_watchlist_digest_email`, so the wording can be eyeballed without waiting for a scheduler tick. Fixture films only, no DB; the Movie/Showtime stand-ins carry just the attributes the mailer reads, and deliberately include a film with no poster and one with no Letterboxd slug
- [x] `frontend/public/favicon.ico` + `frontend/public/apple-touch-icon.png` — Root-path site icons, generated from `assets/images/favicon.png` with ImageMagick (ico at 16/32/48, touch icon 180x180 flattened on white since iOS composites transparency onto black). They exist because avatar fetchers (Proton Mail's sender images) request the conventional root paths rather than parsing index.html, and nginx's SPA fallback answered those with index.html under a 200
- [x] `tests/test_mailer.py` — Email shaping the digest depends on to reach the primary inbox: per-frequency subjects (Eager claims no timeframe because it has no horizon, Weekly says "this week"), never a brand prefix, and a text/plain part that keeps link URLs, drops MJML's <head>/<style>/Outlook comments, and collapses blank-line runs
- [x] `tests/services/test_seat_map_persistence.py` — The seat map is polled, stored and served: a reading stores the seats it already read, a later one replaces rather than merges, a platform that reports no seat map leaves the stored one alone, an unpolled showtime reads as unknown rather than free, and drawing the floor plan never touches a ticket shop
- [x] `tests/scraping/test_seat_floor_plan_room_match.py` — A stored floor plan must belong to the room it's filed under: the agenda feed names the room, the booking system supplies the geometry, and when a show's `screen_name` says a different room the ingest walks on to the next showtime rather than storing another room's seats
- [x] `tests/scraping/test_eagerly_host_matching.py` — Which ticket links count as Eagerly: `/tickets/<number>` is only an Eagerly link on a host in `EAGERLY_SITE_HOSTS` (AnnexCinema and De Sien sell at that path without running Eagerly, and matching them made the client promise seat counts that 404 for ever), and both the `www.` form our scrapers build and the bare form Cineville hands out must resolve to the same booking host or a cinema silently drops to sold-out-only depending on which source won the dedupe
- [x] `tests/scraping/test_tricket_seat_map.py` — Reading a Tricket seat map: positions come from the map's SVG and names from the screening resource, so neither is usable alone; a seat the resource does not name is dropped rather than drawn unmatchable. Also the one place a `screen_side` is *derived* — Tricket draws the screen line itself, and Cinecenter draws it below every seat — plus the guards that keep Studio/K's decorative map out and every seat-map host nameable
- [x] `tests/scraping/test_activetickets_seat_availability.py` — The platform sells two kinds of room through one page shape: a numbered room inlines its seat plan (count, capacity, taken map, blocked seats taken but still counted towards the room) and a free-seating room inlines nothing but the sold-out flag. Also the id-at-the-end-of-the-slug URL parsing, the unknown-host rejection, and the two states that must never read as sold out — a screening the shop no longer lists, and a page with no view-model at all
- [ ] `tests/fixtures/` — Test factories and shared fixtures
- [ ] Add tests for `services/me.py`
- [ ] Add tests for `services/showtimes.py` (visibility logic)
- [ ] Add tests for `crud/showtime_visibility.py` (default-mode resolution covered by `tests/crud/test_showtime_visibility_defaults.py`)
- [ ] Add tests for `crud/user.py` (time-range filtering)
- [ ] `tests/api/test_admin.py` — Admin route gating, analytics overview, movie/showtime moderation, showtime reports
- [x] `tests/api/test_anonymous_browse.py` — The browse endpoints answered without a token: catalogue in full, no personal annotations, `/me/*` still 401
- [x] `tests/api/test_client_compatibility.py` — Legacy flat mirrors match the `viewer` block, and the version gate's per-platform floors are independent
- [x] `tests/test_cinemas_yaml.py` — `data/cinemas.yaml` carries no field the seeder would silently drop, and no duplicate keys

---

## Frontend — Entry & Config (`frontend/src/`)

- [ ] `main.tsx` — App entry point, React Query setup, Axios interceptors
- [x] `theme.tsx` — Chakra UI theme: app `semanticTokens` (light+dark) from `theme/tokens.ts`, plus `ui.main` + button recipe
- [x] `theme/tokens.ts` — Generates Chakra `app.*` semantic color tokens from `shared/theme/colors.ts` (matches the mobile palette, no drift)
- [ ] `constants.ts` — App-wide constants
- [x] `app-install.ts` — Store listing URLs, the Play install-referrer payload, the phone-platform sniff and the official store badge assets (`public/assets/images/app-store-badge.svg`, `google-play-badge.png` — Apple's and Google's own artwork, unmodified, which is why the two are sized to different heights: Google's PNG bakes its required clear space into the image). iPadOS 13+ needs the `Macintosh` + `maxTouchPoints` check; `IOS_APP_STORE_URL` stays null until the App Store listing is live
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
- [x] `InstallAppGate.tsx` — Wraps the shared-link routes (`/ping`, `/movie`, `/add-friend`): a phone with no web session gets the store instead of a login wall, because an installed app would have intercepted the link before the browser saw it. A panel rather than a redirect — universal links do fall through with the app installed, and a wrong guess must cost one tap, not a store bounce
- [ ] `Layout.tsx` — Page layout wrapper
- [ ] `Navbar.tsx` — Top navigation bar
- [ ] `Sidebar.tsx` + `SidebarItems.tsx` — Desktop sidebar (legacy; still used by standalone MoviePage, replaced by NavRail elsewhere)
- [x] `NavRail.tsx` — Slim desktop icon nav rail (app-parity rebuild); replaces Sidebar in `_layout`
- [x] `nav-items.ts` — Shared nav entry list used by NavRail + BottomNavBar
- [x] `BottomNavBar.tsx` — Mobile-web bottom navigation (now app-token themed, shares nav-items.ts)
- [ ] `TopBar.tsx` — Mobile top bar
- [ ] `UserMenu.tsx` — User avatar dropdown
- [ ] `Page.tsx` — Page container with consistent padding
- [ ] `SearchBar.tsx` — Reusable search input. Gained a `leftSlot` rendered in the same row and stretched to the field's height, so the feeds' Filters button lines up with the search box without either side hardcoding a height. Each dropdown option carries its own icon (three of the five are film-related, so they need distinct silhouettes — note `movie-creation` draws the same clapperboard as `movie` despite its own codepoint), and `getSearchFieldLabel` exports the dropdown's wording for anything else that has to name a field
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
- [x] `useShowtimeSeatAvailability.ts` — Same batching for how busy a showtime is, plus `useCachedShowtimeSeatAvailability`, a read that never fetches — a list row must not be able to turn a screenful of showtimes into a screenful of requests. Ids the server had nothing for are cached as `null` so they aren't re-asked every render
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
- [x] `badges/SeatAvailabilityBadge.tsx` — The busyness icon on a showtime row. Reads the prefetch cache and never fetches, and renders nothing at all when there is no reading — a row of dashes where a real answer sometimes appears is worse than nothing being there
- [x] `showtimes/seat-availability-level.ts` — Icon, wording and colour per busyness level (a green→red ramp, seat-shaped icons for the calm levels and people-shaped for the busy ones), plus the "31 of 312 seats left" / "Checked 4 minutes ago" formatters. Never recomputes a level — the backend hands one over
- [x] `showtimes/InviteBeforePrivateDialog.tsx` — Checkbox-list variant of `ConfirmDialog`, shown right before a showtime switches to INVITED_ONLY when friends are already going/interested but never pinged; offers to invite them (non-notifying) so they don't silently lose visibility
- [x] `showtimes/SeatSheets.tsx` — Owns which seat map is open (the editable `SeatFloorPlan`, the read-only `SeatFloorPlanPreview`, or neither) and is driven by an imperative ref rather than a prop. Exists so opening or closing one doesn't have to wait behind a re-render of `ShowtimeActionModal`, which is what made both feel slow — the sheet animation was never the delay
- [x] `ui/AnimatedHeight.tsx` — Measures its children and tweens its own height to match, for content that grows and shrinks under the user (search results arriving, an empty state replacing a list). Used instead of `LayoutAnimation` where the change comes from a query resolving rather than a tap, since `configureNext` has to be armed before the update that moves things
- [x] `ui/LoadMoreFooter.tsx` — The spinner at the bottom of a paginated list, tweening its own height and opacity so a loaded page glides in instead of snapping up a whole row the instant the spinner unmounts. Shared by every infinite list (showtimes, movies, friends, cinema/friend/movie detail). Not `AnimatedHeight`: there is nothing to measure, and the fade has to run *with* the collapse rather than after it
- [x] `auth/AuthScreenShell.tsx` — The frame every auth screen sits in (brand mark, title, subtitle, keyboard handling, and the error banner, which is tweened in rather than inserted under the user). Exists so log in / sign up / pick a username / recover password cannot drift apart — this is the first thing anyone sees of the app
- [x] `auth/AuthTextField.tsx` — Labelled auth input: focus recolours a border that is always there (so focusing cannot reflow the form), validation messages are tweened in, and a password field gets a reveal toggle
- [x] `auth/AuthPrimaryButton.tsx` — The one call to action on an auth screen; keeps the label mounted under the spinner so a button that starts working does not resize
- [x] `auth/SocialSignInSection.tsx` — "Continue with Apple / Google" plus the divider above the email form, shared by log in and sign up, which used to carry a verbatim copy of both handlers each. Both buttons commit to a busy state on tap, and the Apple button follows the colour scheme (a black button on the dark theme was a rectangle you could only find by its text)
- [x] `auth/GoogleMark.tsx` — Google's four-colour "G", drawn with `react-native-svg` as their sign-in branding guidelines require
- [x] `friends/UserSearchResults.tsx` — The results under a "find a friend" search box, shared by the intro's friends page and the add-friends tip. Debounced, keeps the previous results up while the next load, and tweens its height, so typing does not kick the invite card below it down the page
- [x] `friends/FriendVisibilityControl.tsx` — Per-friend "Can see your showtimes: Always / Only when invited" segmented control (writes `shares_status`). Its own shape — squared corners on a hairline white track, because it sits on the white of a friend row — over the shared `useSlidingThumb` motion: the tint slides between the two answers and crosses green to amber on the way
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
- [x] `utils/theme-preference.ts` — The theme preference store, and the three beats a change of it is played in: the curtain comes down, the preference is applied under it, and it lifts once the app has settled (`runAfterInteractions` plus a frame, capped at 1.5s, held for a 300ms minimum so a fast switch is not a flicker). The switching flag has its own subscriber list — announcing it must re-render one component and nothing else, or it would cost the same full-app render it exists to hide. Startup (`loadThemePreference`) skips all of it: the splash is still up
- [x] `layout/ThemeSwitchOverlay.tsx` — That curtain: full-screen, painted in the palette being switched *to* so it lifts onto a screen the colour it already was. An `ActivityIndicator` rather than the splash's pulsing logo, because `Animated.loop` over a sequence steps between its halves from JS and would stall for exactly as long as the re-render it is covering
- [x] `utils/feature-tips.ts` — Feature-tip store: master switch + permanent dismissals in SecureStore, session snoozes and their notification-centre reminders in memory; subscriber model copied from `theme-preference.ts`. Holds `FORCED_TIP_ID`, the dev override that pins one tip on screen while it's being designed, and `ALWAYS_SHOW_TIP_IDS`, the tips that are obligations rather than suggestions and so ignore the chance, the cooldown, the master switch and permanent dismissal
- [x] `notifications/NotificationRowLayout.tsx` — Shared visual shell for a notification row (accent icon circle, title/subtitle, relative time, unseen dot, dismiss ✕), extracted from `NotificationRow` so backend feed items and local feature-tip reminders cannot drift apart
- [x] `notifications/FeatureTipNotificationRow.tsx` — A snoozed feature tip in the notification centre; tapping it reopens the tip dialog, so a suggestion the user closed is recoverable rather than gone
- [x] `notifications/NotificationPreferenceList.tsx` — The four notification preferences, one line each, as a single `SegmentedControl` per row (replacing a switch plus a second delivery row), with "Off" carrying the neutral thumb so it does not read as switched on; shared by the Settings screen and the notification-permission tip
- [x] `hooks/useNotificationPreferences.ts` — Preferences state, delivery channels, OS permission and the optimistic writes behind them, lifted out of `settings.tsx` so the tip drives the same logic. Also exports `useSystemNotificationPermission` (permission state alone, for tip eligibility; re-reads on foreground so a change made in system settings lands), `wantsPushNotifications`, and `openSystemSettings` (the never-rejecting settings hand-off every caller uses). `requestSystemPermission` never rejects either — token registration throws for reasons unrelated to the user's answer
- [x] `tips/NotificationPermissionTip.tsx` — Tip shown when the OS blocks notifications while the user still wants pushes; offers the prompt (or system settings once the OS stops asking) alongside the full preference list
- [x] `tips/WatchlistDigestTip.tsx` — The quietest tip in the app: offers the watchlist digest to someone who has never turned it on. The only tip whose eligibility the *backend* decides (`show_watchlist_digest_tip` on /me = server switch + confirmed address + never enabled), so the feature can sit unadvertised in Settings until it is ready to be pointed at; longest cooldown and lowest show chance of any tip
- [ ] `settings/WatchlistDigestSourcesSection.tsx` — The "Advanced: sources" body of the digest settings: a user may have several `WatchlistDigestSource` rows, each its own frequency/list/cinema card, plus the shared "add a Letterboxd list" row and per-source delete confirm
- [ ] `settings/CustomCinemaPickerModal.tsx` — One-off cinema multi-select for a digest source (`custom_cinema_ids`); wraps `CinemaPickerList` directly rather than the preset-bound `CinemaFilterModal`, since nothing here is ever saved as a `CinemaPreset`
- [ ] `hooks/useWatchlistDigestSources.ts` — Query + create/update/delete mutations for `/me/watchlist-digest-sources`
- [x] `tips/VerifyEmailTip.tsx` — Tip shown while the account's email address is unconfirmed. Unlike the others it is unfinished business rather than a suggestion: highest priority, exempt from the random chance, the cooldown and the Settings switch (`ALWAYS_SHOW_TIP_IDS`), and no "Don't show this again" — closing it only lasts the session. Spells out the address (a typo is the usual reason nothing arrived) and can re-send the link
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
- [x] `ui/use-sliding-thumb.ts` — The motion behind a segmented control, shared by `SegmentedControl` and `FriendVisibilityControl` (which cannot share a component — different shape, different palette — but must share a feel): segments measured rather than assumed equal, one thumb tweened to the one picked, and the label crossfades that track it. Nothing animates until the first measurement lands, so a control is never seen sliding into place on mount. The travel is started by the press (`moveTo`), never by React noticing the value afterwards — on the Friends tab the same tap swaps a SectionList for a FlatList and renders a QR code, and a tween that waited for the effect after that commit started visibly late. The layout-effect pass is only for a value changing from somewhere other than a press, and `appliedRef` makes sending the thumb where it is already going a no-op rather than a restarted tween. An optional `externalProgress` inverts the whole model for a control above a pager: the thumb stops being sent anywhere and becomes a readout of the pages, interpolated across the measured segments by a `useAnimatedReaction` so it tracks the finger and never waits on React — the JS round trip is what made it lag a second behind a swipe on Android
- [x] `ui/SegmentedControl.tsx` — Compact pill track with the selected option as a filled thumb, for an either/or choice that should cost one line rather than a wrapping row of loose pills. Per-option thumb colors let a neutral default ("Any") avoid reading as switched on while the real options keep the app's status colors. A `stretch` + `size="large"` pair widens it into screen-level navigation (the Friends tab's Friends / Find people header) without disturbing the compact settings-row default. The thumb travels: it slides and resizes to the segment picked, crossing colour on the way when the two segments do not share one, and each segment stacks a resting-colour and a selected-colour copy of its content that crossfade with its arrival — text colour is not something Reanimated can drive through `ThemedText`. Every either/or choice in the app now goes through it: Light/Dark/System, Off/Push/Email, Eager/Weekly, Friends/Find people, Group By, Marked by Friends. The travel starts on the tap rather than on the answer (`useOptimisticValue`), because `onChange` can re-theme the app or wait on a save. A control labelling a pager passes that pager's `progress` instead: the thumb then follows the pages on the UI thread — tracking the finger mid-drag — rather than being sent to a segment by a render, which on Android left it frozen on the old page for as long as the commit took
- [x] `utils/expand-animation.ts` — Shared caret-spin duration + `LayoutAnimation` config for disclosure toggles (and Android's `setLayoutAnimationEnabledExperimental` opt-in), so `FilterSection` and `ShowtimeActionModal`'s invite/visibility toggles open and close at the same speed
- [x] `filters/DaysFilterSection.tsx` — The Filters modal's Days section: the three relative days as cards labelled with the date they resolve to, the seven weekdays as one chip row, a summary line naming every selection (with Clear), and the row that opens the calendar. Every token the section can produce is reachable without opening a sheet; selections are canonicalized first so an ISO date for today lights up the Today card instead of hiding in the calendar row
- [x] `filters/SpecificDatesModal.tsx` — Calendar sheet behind that row (six months of month grids, applied on close). Draws today/tomorrow/day-after as selected even though they are relative tokens — and clears the token when such a day is tapped — so no day is shown unselected while it is being filtered on. Weekday tokens are left alone, including by "Clear dates"
- [x] `utils/sign-in-notice.ts` — The one-time thing a sign-in has to tell the user afterwards: currently only "linking Apple/Google removed this account's password" (the unverified-account takeover). Set during the sign-in, read by `SignInNoticeHost` in the root layout, because the screen that learns it unmounts on the navigation that follows. In memory only, like `username-gate.ts`
- [x] `auth/SignInNoticeHost.tsx` — Renders that notice as a single-button `ConfirmDialog`, mounted in the root layout alongside `IntroHost`
- [x] `utils/auth-session.ts` — Whether there is a signed-in session, as the app's navigation sees it. The stored token is read exactly once, at startup; every transition after that is announced synchronously by whoever caused it (`completeLogin` in, logout/401 out). Re-deriving it from SecureStore on every route change made the guard disagree with the navigation it was guarding for a frame or two, which showed up as a login that hung and then flicked through the wrong screen on its way to the right one
- [x] `hooks/useOptimisticValue.ts` — The app-wide "paint on the tap" hook: the returned value flips in the frame the press lands, the real `onChange` is deferred a frame so the visual never waits on a re-filter, a re-theme or a save, and the override drops itself once the incoming value catches up. It also gives up after a second, for the change that is refused outright and silently (Email delivery with no verified address) — nothing else would ever put such a control back. Behind every filter pill, the movie-filter cards and `SegmentedControl`
- [x] `hooks/useDebouncedValue.ts` — Settles on a value once it stops changing, so a search field is one request per word rather than one per keystroke
- [x] `hooks/useLayoutAnimatedValue.ts` — Mirrors a value one frame late so the layout change it causes is tweened, for values arriving as props (a form error, a server error) where `LayoutAnimation.configureNext` cannot be armed in time
- [x] `constants/auth.ts` — Email pattern + password minimum, shared by the auth screens that were each carrying their own copy
- [x] `utils/intro.ts` — First-run intro store: the pending flag (set when an account is created, so existing users updating the app never get an intro) in SecureStore, the current phase in memory, same subscriber model as `feature-tips.ts`. Cleared on finish/skip rather than on start, so an app killed halfway through gets another go
- [x] `intro/IntroHost.tsx` — Mounts the walkthrough once the user is in the tabs *and* the loaded account has a username (a social sign-in is authenticated while still picking one, and an intro over that form would cover it — or, when a redirect race put the app in the tabs instead, replace it entirely). Only the start is gated; once running the intro stays put. No longer waits for the splash: the intro is a Modal, so it draws *above* the splash overlay, which is exactly what stops the app being revealed for a beat before the walkthrough covers it back up
- [x] `intro/IntroFlow.tsx` — The five pages, the progress row and the always-reachable "Skip tutorial". One Modal for all of them: opaque for the three that own the screen, see-through for the showtime tour, whose sheet is rendered as a sibling of the Modal so it shows behind it rather than under it. Takes the screen instantly and animates its *contents* in (fading the window itself showed whatever it was covering through the fade); leaving does fade, since by then the app underneath is the point. Pages crossfade into each other rather than hard-cutting
- [x] `intro/IntroPageShell.tsx` — Shared shell for a full-screen intro page (icon, title, message, the page's own content, primary button and a quiet escape hatch), the intro's counterpart to `FeatureTipModal`
- [x] `intro/IntroCinemasPage.tsx` — Page 1: the cinema picker, saved as the favorite preset under a fixed name ("Favorites" — a ten-second-old account should not be asked to name anything) and applied to the session; retires the cinema-preset tip. Opens with every cinema ticked ("0 of 24 selected" on a new account's first screen reads as a filter already hiding everything), and clearing them all is taken as saving nothing at all — no preset, and the tip stays eligible
- [x] `intro/IntroLetterboxdPage.tsx` — Page 2: the username, inline, with "I don't use Letterboxd" — which retires that tip for good, so the app never asks again about a service the user has said they don't have
- [x] `intro/IntroShowtimeSheet.tsx` — Page 3's subject: the real `ShowtimeActionModal` over invented data, mounted outside the intro's Modal on purpose (the sheet portals into the app root, and a Modal is a window above it)
- [x] `intro/IntroShowtimeTour.tsx` — Page 3's script and overlay: three steps walking a spotlight across Interested, Going and Invite friends
- [x] `intro/IntroFriendsPage.tsx` — Page 4: search for someone by name, or show the invite QR code — this being the one moment the user is likely to be sitting next to the friend who told them about the app
- [x] `intro/IntroNotificationsPage.tsx` — Page 5: fires the OS permission prompt by itself a beat after the page paints, so the ask is read before it is answered. Asks through token registration rather than the preferences controller, whose refusal path raises native Alerts — over a walkthrough that is a dialog answering a dialog; here the page itself becomes the fallback, switching its button to "Open system settings" once the OS stops asking
- [x] `intro/demo-showtime.ts` — The showtime the tour points at: the first real one the list would show (real film, poster, cinema, time), dressed with invented friends and a sentinel id that matches no real showtime
- [x] `intro/SpotlightOverlay.tsx` — Dim-with-a-hole overlay: four panes around a measured rect, a pulsing ring, and a caption card in whichever gap is bigger. Four panes rather than an SVG mask, so the hole is genuinely untouched and a caller can let the real control be tapped through it (`onPressTarget`)
- [x] `intro/IntroFiltersSpotlight.tsx` — The intro's last step, owned by the showtimes screen rather than the flow because it waits for that screen's list to load, its tab to be focused, and nothing else to be open. The highlighted button is real: tapping it opens the filters. Renders nothing until the button has actually been measured — presenting first and measuring after showed the caption in its unmeasured fallback position and then jumped it down to the button. If the measurement never lands it ends the intro rather than leaving the phase parked forever
- [x] `sheets/SheetBackdrop.tsx` — The dimmed backdrop behind every sheet (`AppBottomSheet` and `ShowtimeActionModal`). A near-copy of gorhom's `BottomSheetBackdrop` that separates the fade from touchability: gorhom drops both at `disappearsOnIndex`, which for a modal must be -1, so the invisible backdrop went on swallowing touches for the whole close animation and the screen behind stayed dead for a beat after the sheet was dismissed. Here it stops taking touches as soon as the sheet leaves its open position, while the fade still runs to -1
- [x] `utils/blocking-overlays.ts` — Live registry of the blocking surfaces the layout-level providers own (showtime sheet, filters/cinema sheets, notification centre), for anything that has to be the *only* thing in front of the user rather than merely on top. A set, not a boolean, so a dialog over a sheet unregisters independently. Each surface registers *how to close itself* as well, so the intro can guarantee a clear screen (`closeAllBlockingOverlays`) instead of waiting and hoping for one — a filters sheet left open before a replay was still sitting there when the walkthrough ended. `useIsFocused` cannot see these: they are windows, not routes
- ~~`filters/DayFilterModal.tsx`~~ — deleted (its shortcut lists moved inline into `DaysFilterSection`, its calendar into `SpecificDatesModal`)
- ~~`tips/FeatureTipCard.tsx`~~ — deleted (the inline card was superseded by the blocking `FeatureTipModal`)
- [x] `hooks/useCurrentUser.ts` — The signed-in account (same `currentUser` query key as `shared/hooks/useAuth`, but enabled from the global auth session rather than that hook's own token read, so it is live on every launch and from the moment a sign-in is announced) plus the predicate the app is gated on: `hasUsername`/`isMissingUsername`, positive checks both ways so an account that has not loaded is never read as either
- [x] `utils/username-gate.ts` — "This session owes a username", known synchronously, raised by a social sign-in in the same block as `markSignedIn` so the route guard has an answer before the account loads. In memory only, unlike `intro.ts`: a stored flag outliving its account would strand a user on the username screen
- [x] `auth/SignInGateProvider.tsx` — One place to ask "does this need an account?", and one dialog to answer it. `requireAccount(feature)` returns true when the caller may proceed and false when it has put the prompt up instead, so an account-only affordance anywhere in the app gates itself in one line. Mounted above the sheet/notification providers so the prompt outlives the surface the tap came from
- [x] `auth/SignInRequiredDialog.tsx` — What a guest sees when they tap something an account is needed for. Not a `ConfirmDialog`: it asks for two different yeses (make an account, or use the one you have), with dismissal as a quiet third option
- [x] `auth/SignedOutPanel.tsx` — What a guest sees instead of a tab that has nothing to show them (Agenda, Friends), and as a card at the top of Settings. Reads the same copy table as the dialog, so the sentence on the Friends tab is the one they read again if they tap "Invite" three screens later
- [x] `auth/account-features.ts` — The copy table both of the above read: for each thing an account is for, an icon, a title naming the *feature* rather than the restriction, and one sentence on what it does
- [x] `auth/BrowseWithoutAccountLink.tsx` — The way past the door, on both auth screens. A quiet link rather than a third button competing with Apple/Google; hidden when the user is already browsing as a guest
- [x] `utils/guest-cinema-selection.ts` — A guest's chosen cinemas, kept on the device (a signed-in user's live on their account). Empty means all cinemas, which is where a guest starts; `claimGuestCinemaSelection` hands them to the account on sign-up so the picking is not repeated
- [x] `hooks/useCinemaSelection.ts` — The session's cinema selection plus persistence for guests, so every picker in the app saves a guest's choice by doing nothing different from what it already did
- [x] `hooks/useSingleFireNavigation.ts` — Wraps a `router.push`/`replace` call so a double-tap only fires it once; `expo-router` navigation is async, so a disabled-on-submit re-render lags behind a fast double-tap and stacks the destination screen twice. Resets on screen focus. Rolled out to every push-on-press site found across the app (movie/friend/cinema cards, showtime long-press, login's sign-up/forgot-password links, the notification centre)
- [x] `hooks/useSwipePager.ts` — The horizontal pager behind the Activity tab's All/You/Friends pages and the Friends tab's Friends/Find people pages: the finger drags the row, a flick or a third of a page turns it, and the settle borrows `THUMB_SLIDE_MS`/`THUMB_SLIDE_EASING`. One shared value, `progress` (counted in pages, fractional mid-drag), is both the row's offset and the segmented control's thumb position, so the two cannot come apart. Everything visible runs on the UI thread by design: committing a page change re-renders a screenful of feeds, and on Android anything waiting on that commit sat frozen for a second or more after the swipe — so the gesture writes `progress` itself and React is told afterwards, and a tap goes through `goTo` before `setState` for the same reason. The index stays the caller's state, so a tap on the control or a `?mode=` deep link is tweened to like any other change. The resting page is a `SharedValue` and emphatically not a ref: a ref captured by a gesture worklet is copied to the UI thread when the gesture is built, so it freezes on the page the pager opened at and every later drag measures from the wrong origin. The pan is horizontal-only (`activeOffsetX`/`failOffsetY`) because every page holds a vertical list with a pull-to-refresh, and a drag that is at all vertical must be theirs
- [x] `hooks/useUserModeration.ts` — Block/unblock/report-user mutations behind one hook, mirroring `useFriendActions`; invalidates `["users"]` since a block changes search, friend-status and the friends list at once
- [x] `friends/ReportUserDialog.tsx` — "Report this person" reason picker (`ConfirmDialog`'s fade/scale chrome, a reason list instead of two buttons); reporting blocks by default, offered from `NonFriendProfile` and `FriendAgendaOptions`
- [x] `friends/NonFriendProfile.tsx` — Gained Block/Report (or Unblock, once blocked) links below the existing friend-request actions — App Store Review guideline 1.2's blocking/reporting mechanism for the one profile screen a stranger is ever shown
- [x] `friends/FriendAgendaOptions.tsx` — Gained the same Block/Report pair below the visibility control; blocking a friend removes the friendship, same as Remove
- `app/blocked-users.tsx` — "Blocked accounts" screen off Settings → Privacy: the one place a blocked account is still visible, since search/friends/invites all filter them out; unblock-only, does not restore what blocking removed
- [x] `constants/tablet-layout.ts` — `tabletCappedContentStyle` (maxWidth 640 + centered), the cheap fix for `RESPONSIVE_AUDIT.md` finding 16; applied to the four main-feed list containers, deliberately not to `FiltersModal`/`AppBottomSheet` (would mismatch their full-width pinned footers)
- ~~`app/modal.tsx`~~ — deleted (leftover Expo Router template screen — "This is a modal" — that was never navigated to; flagged as `RESPONSIVE_AUDIT.md` finding 22)
- [x] `utils/install-referrer.ts` — Android deferred deep link: reads the Play install referrer the web install panel attached to the store URL, so someone who tapped a shared link with no app lands on that link after installing. Claimed once ever (the referrer is fixed at install time and a reinstall would otherwise replay the old one) but cached as a promise for the process, because the effect that reads it re-runs when the session appears. Path shapes are whitelisted — a referrer is attacker-supplied and this ends in a navigation. iOS has no equivalent and is told to reopen the link instead
- [x] `utils/pending-deep-link.ts` — Read/write for the deep-link path held across a sign-in, with a 7-day bound so an abandoned link is not resumed on an unrelated login weeks later. Written by the route guard and the install referrer, followed in one place: the root layout, once the account is real *and* the intro is over. `completeLogin` used to follow it directly and dropped it entirely for new accounts, which lost exactly the invite-then-sign-up case this exists for
- [x] `utils/sentry.ts` — Crash reporting init plus `reportError()`, for failures the app deliberately swallows and Sentry's automatic handlers therefore never see. Added because a Play Services error dialog on the store build was unreproducible on any internal build (those are plain APKs, the store one is an app bundle) and there was no telemetry to tell which native call raised it. Every entry point no-ops without a `SENTRY_DSN`, so local and fork builds are unaffected
- [x] `utils/code128.ts` — Code 128 encoder (symbol table, code-set-B-with-C-for-digit-runs encoding, modulo-103 checksum), written rather than pulled in as a dependency because the app needs exactly one barcode. Verified bit-for-bit against a reference implementation
- [x] `utils/cineville-card.ts` — The device-local Cineville card number. Gained a small subscription store (`useCinevilleCardDigits`) so the agenda shortcut appears the moment the number is saved in Settings — secure storage cannot be watched, so writes announce themselves
- [x] `components/cineville/CinevilleBarcode.tsx` — Draws an encoded value as SVG bars, sized to its container in whole pixels per module and with the quiet zones a scanner needs. Deliberately unthemed: black on white in dark mode too
- [x] `components/cineville/CinevilleCardModal.tsx` — The Cineville pass for the door, on an `AppBottomSheet` so it can be swiped away one-handed the moment the scanner beeps: white card, human-readable number, and the screen eased up to full brightness while it is open (walked back down on close) via `useFullBrightness`
- [x] `hooks/useFullBrightness.ts` — Holds the screen at full brightness while a flag is true, ramping in over 400ms and back out over 300ms a frame at a time rather than stepping — a dark foyer to full brightness in one write is a flash in the face. Progress comes off the clock, so a slow device drops frames instead of running long, and an interrupted ramp (sheet reopened mid-descent) continues from the brightness actually on screen. iOS restores the exact value read beforehand; Android only aims the descent at that reading — it is on a different scale — and ends the boost by dropping the window override, the one thing that leaves adaptive brightness as the user had it
- [x] `components/cineville/CinevilleCardButton.tsx` — The floating shortcut into the above, at the bottom of the agenda and showtimes feeds where a thumb actually reaches. Rendered for guests too since the card is stored on the device and needs no account; hidden until a number is saved, and on any feed its Settings switch is off
- [x] `utils/cineville-shortcuts.ts` — Per-feed on/off for that shortcut, stored on the device beside the card number. Both default to on (a button that must be switched on before it can be found never is), and only an explicit "off" is persisted
- [x] `ui/AppSwitch.tsx` — The app's on/off switch, wrapping RN's `Switch` because iOS and Android want opposite props from it: `trackColor.false` is only an *outline* on iOS, so a white `thumbColor` on a near-white card left the off state a pale empty capsule. iOS gets `ios_backgroundColor` and the system thumb, Android keeps the explicit colors, and both get the selection haptic every other control in the app fires

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
- [ ] `alembic/versions/` — 114 migrations: understand the schema evolution
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
- [x] `filters/FiltersButton.tsx` — The button that opens the Filters sheet, in one place on every screen that has one: to the left of the search field, in `SearchBar`'s `leftSlot`. It used to sit on a row of its own on the sub-pages (in a `FiltersButtonRow` since deleted), which cost a whole band of vertical space to hold one button and made the same screen chrome read differently on the feeds and the sub-pages. It used to be pinned to the left of the preset row, which left that row's caption heading only half a row and forced the two halves to be height-matched; beside the search field it stretches to the field's height and the presets get a row of their own
- [x] `filters/PresetsRow.tsx` — (was `FiltersRow.tsx`) The saved-preset buttons under an uppercase "Presets" caption. The caption is the only thing that can say what these are: a preset's label is a name the user chose, so it carries no signal of its own — squared corners then separate them from the fully-rounded pills and chips that hold state. Absent entirely for a guest rather than empty
- [x] `filters/filter-control-metrics.ts` — The numbers behind the filter UI's *action* controls (Filters button, saved-preset buttons), in one place so the same family of control cannot drift into looking like two unrelated things now that they no longer share a row. Holds the squared radius that separates "does something" from the fully-rounded pills and chips that hold state, and the explicit line height every label in these controls needs (ThemedText's default 24pt survives a fontSize override and silently made both buttons 40pt tall). The Filters button takes the larger type of the two: it is the entry to the whole sheet and stands next to a 16pt search field, not in a row of small chips
- [x] `inputs/SearchFieldFallback.tsx` — Sits under an empty result on either feed when the search ran against something other than the title: names the field that was searched and offers the same query back against titles. The field is set once from a dropdown and then only visible in the placeholder, so a later search for a film by name comes back empty with nothing on screen explaining why. Renders nothing for a title search or an empty query; reached through `ShowtimesScreen`'s new `emptyExtra` slot on the showtimes feed, and inline in both movie-grid empty states
- [x] `filters/PresetButton.tsx` — One saved-preset button, owning its own tap animation: a small scale pop, a brief lift in the neutral the chips flash, and a fade to the disabled look, all one closed 250ms animation started at t=0 and interruptible by nothing. Reanimated rather than RN's `Animated`, and that decides the file: `Animated.sequence`/`delay`/`spring` hand over between stages *on the JS thread* even under `useNativeDriver`, and a press fires an apply that holds that thread for the whole of the animation — which came out on a mid-range Android as pop, shrink, stall, pop again, stall, flash, snap. The press also claims its own outcome (a preset just applied has nothing left to apply) and reconciles with the row once at the end, rather than letting the row's verdict — which arrives in pieces, mid-press — drive the animation. Per button rather than per row so two presets tapped in quick succession run on their own timelines. `onApply` is called in a `requestAnimationFrame` so the apply's render cannot get ahead of the button lighting up
- [x] `filters/filter-change-animation.ts` — How the filter rows answer a change and move while they do, as two beats: everything that leaves goes first (with the cinema pill resizing on the same clock, `PHASE_ONE_MS`), then everything that arrives. Sequencing them is what stops an arriving chip being laid out in the row's new shape while the pill is still travelling towards it. A chip's flash is *part of its entrance* — one `EntryExitAnimationFunction` whose `initialValues` carry the flashed colours and whose animations time them back to resting — not a second animation on a shared clock, which is what it was: the chip only started reading that clock once a `setState` told it to, a commit later, so the growth finished before the colour began. Every wait inside a beat is a Reanimated delay on the UI thread, never a `setTimeout`: applying a preset re-renders the whole feed, and a JS-thread boundary drifts hundreds of milliseconds behind the animations it is meant to be following. The flash is a neutral step away from the pill's resting colour, not an accent — green read as "this is on", a claim about state, and every chip in the row is already on. `FILTER_ROW_SETTLE_MS` is exported for the screens *around* the row: mounting a feed's worth of cards is UI-thread work and stalls a running animation just as a blocked JS thread stalls a timer
- [x] `filters/ActiveFilterChip.tsx` — One active-filter chip, extracted from `ActiveFilterChips` so it can carry its own entering/exiting/layout animations. Nothing keeps a removed chip alive by hand — Reanimated holds it on screen for its exit, which is why the row can simply stop rendering it
- [x] `filters/MorphingChipLabel.tsx` — A chip label that changes without snapping: text cannot morph, so the outgoing label slides out sideways and fades while the incoming one slides in behind it, over roughly the time the chip's width transition takes to catch up. The direction follows the width — a longer label arrives from the right as the chip opens up for it, a shorter one from the left as it closes in — so the text and the box travel the same way at the same moment instead of reading as two animations. The outgoing copy is absolutely positioned so only the incoming text decides how wide the chip wants to be, and it is left mounted at zero opacity rather than cleared on a timer. The swap is taken during render, not in an effect: deferring it by a frame put the chip's resize in a commit of its own, after the row had stopped holding movement back for chips still animating away, and the two collided. Used by the cinema pill, whose label is a count one moment and a preset's name the next; any chip with a changing label can take it
- [x] `feeds/feed-paging.ts` — How both infinite feeds ask for and render rows, in one place because they are the same list with a different card. Sizes the *first* page to a screenful plus two from the row height each card states (`SHOWTIME_ROW_HEIGHT`, `MOVIE_ROW_HEIGHT`), leaving later pages full-size: the first page is the only one always fetched, and a filtered feed is very often scrolled nowhere, so the rest of a twenty-row page is query, payload, parse and two batched prefetches spent on rows nobody sees. Two things have to come with it or it saves nothing — `getNextPageParam` must sum real page lengths instead of assuming uniform pages, and `onEndReached` must wait for an actual drag (`useScrollTriggeredLoadMore`), since `FlatList` otherwise calls it on mount for any content shorter than the threshold and pulls the next page unasked. Also caps the render window: the defaults (10 initial rows, 21 viewports) mount a whole page of native views on the UI thread while whatever caused the fetch is still animating
- [x] `filters/ActiveFilterChips.tsx` — The row, and the conductor for its own motion: the only thing that can see both halves of a change, so it decides where each beat starts. It never drives an animation or owns one — every decision is made in the commit the change lands in and handed to a chip as two booleans read at mount, because anything the row still had to say afterwards would arrive too late to be part of the movement. Removals go the same way round: a tapped chip is dropped from the row's own list first (`dismiss`) and the filter written a frame later, so the exit starts in a commit that rebuilds nothing — most filter setters write the session cache synchronously, and the feed rebuild that follows was holding the exit up long enough to read as the row ignoring the tap
- [x] `tab-bar.tsx` — (was `haptic-tab.tsx`) The bottom bar's button, icon and label. All three exist because the default bar derives everything it shows about the selected tab from navigation state, and navigation state changes in the *same commit* that renders the screen being navigated to — so a tab press showed nothing at all until that screen had built, then the bar and the screen arrived together: a stall followed by a jump. Here one module-level shared value says which tab is lit, set on press *before* the navigator is called, and the highlight, the icon colour and the label colour all follow it on the UI thread. Navigation still decides what is really selected, but the correction is watched as an edge, never asserted every render — between the press and the navigator catching up the bar still believes the old tab is selected, and asserting would snap the highlight back. Colours cross-fade rather than tween, because an icon's colour is a prop and not a style: each is drawn twice, once in each colour, and the copies are faded past each other. The press haptic fires on touch-down with the flash, and on **both** platforms via `triggerTabPressHaptic` — the Expo tab template this began as fired on iOS only, reasoning that Android "already has native ripple feedback", which confuses something you see for something you feel
- [x] `layout/TabScreenSkeleton.tsx` — What a tab shows between being pressed and being built. A tab screen is mounted the first time it is opened and React renders the whole thing before committing anything, so the tab you pressed *away from* stayed on screen for as long as the new one took to build — the press looked ignored. Each tab now gates its content behind `useDeferredMount` and puts this up instead: the same top bar the screen will have, and `ListLoadingLogo` under it. Rows of bones were what it used to draw, and they could only ever be right for one tab — feed cards, friend rows and settings groups are three different shapes, and being wrong about the shape made the content arriving read as a correction; the panel promises no layout at all and is the same wait the rest of the app shows. The gate is a wrapper component rather than an early return, so every hook the screen owns sits behind it — an early return inside one component would defer only the render, not the queries and subscriptions that set it up. The wait is at least `TAB_CONTENT_MIN_DELAY_MS`, which `tab-bar.tsx` derives from its own highlight animation: the mount takes the UI thread, and without the wait it lands in the middle of the movement that is supposed to be answering the tap
- [x] `layout/LoadingLogo.tsx` — The one panel every wait in the app puts up: splash logo, spinner, one line of text. Extracted from `ThemeSwitchOverlay`, which now renders it, so a wait inside a sheet and a wait covering the whole screen are visibly the same app waiting. Takes its colours as props rather than reading the theme hook, because the theme curtain is painted in the palette being switched *to*, which the hook cannot know yet. The spinner stays an `ActivityIndicator` for the reason the curtain always had one — what it covers is a heavy render, so anything stepped from JS would stall exactly when it is meant to be saying "still working" — and the optional `fadeIn` exists for callers that put it up on *every* open, where most opens finish before the fade does and so show nothing rather than a blink
- [x] `layout/ListLoadingLogo.tsx` — `LoadingLogo` sized and posed for a feed, and the app's replacement for every list skeleton (`SkeletonRows` is gone). No spinner — every caller has a `ThemedRefreshControl` pinned above it and the two would spin side by side — and it sits a little above centre, since dead centre reads as low once the search bar and filter row above it are counted. Callers mount it as an **absolute overlay** rather than as a list's `ListEmptyComponent`: list content scrolls, and RefreshControl's pull drags it, which read as the logo drifting down the screen. `pointerEvents="none"` so it never eats the pull-to-refresh gesture underneath it. The movie page is the deliberate exception: its list is headed by the movie's *already loaded* description, which can run long, so a viewport-centred overlay printed the logo over good text — there it goes in the empty slot instead, under the description at the top of the showtimes section, in a fixed-height parent. That only holds because the panel there is never up for a refresh. The hard rule is in its doc comment: it must never come up for a pull-to-refresh at all, which is RefreshControl's own spinner's job
- [x] `hooks/useDelayedTrue.ts` + `constants/loading-logo.ts` — When the loading panel is allowed to appear, which is the whole difficulty with it. True only once its input has held for `LOADING_LOGO_DELAY_MS`, so a filter or preset that resolves from cache never flashes it; false *synchronously*, gated on the input rather than on the effect that resets it, because the render where real content arrives is exactly the render the panel has to be gone in and an effect lands a frame or more later (visible on Android, where a big list commits slowly). `LOADING_LOGO_COOLDOWN_MS` additionally holds back the *next* appearance after a hide, so tapping through several filters shows the panel at most once per window instead of once per tap. A screen's own deliberate hold (a preset's `FILTER_ROW_SETTLE_MS` settle window) gets its own clock with the delay but **no** cooldown — a cooldown left ticking by the previous preset outlasts the next one's hold and swallows its panel entirely
- [x] `ui/FeedItemEntrance.tsx` — Wraps one feed row so it fades and lifts into place instead of popping in, staggered ~45ms per row and capped at the eighth, so a page reads as filling in rather than snapping in as a block. Past the first screenful the stagger would only delay rows nobody is looking at. On every paginated feed in the app: the showtimes/movies tabs, cinema and friend showtimes (via `ShowtimesListContent`), the movie page's showtimes and both Friends-tab lists. In a `SectionList` the `index` it is given is the row's place within its *section*, so each group cascades from its own header
- [x] `sheets/use-sheet-content-ready.ts` — Why a heavy sheet now opens on the tap. gorhom mounts a sheet's children the moment `present()` is called and only starts the rise once that mount has committed, so `CinemaFilterModal`'s ~80 cinema chips (several hundred native views, rebuilt every open because the sheet is `dismissWhenClosed`) were being built *before* the sheet moved. The body is gated on this flag with a `LoadingLogo` in its place, so the first mount costs nothing and the content arrives into a sheet that is already up. A timer and not `InteractionManager`: gorhom animates under Reanimated, which registers no interaction handle, so `runAfterInteractions` resolves immediately and defers nothing (learned on the seat-plan sheet). The wait is `SHEET_OPEN_DURATION_MS` — now exported from `AppBottomSheet` rather than inlined in its `animationConfigs` — plus two frames for the `requestAnimationFrame` inside `present()`
- [x] `utils/android-back.ts` — Who gets Android's back press, decided by what opened last instead of by React. RN calls its `hardwareBackPress` subscribers in reverse registration order *and re-registering jumps the queue*, so with the cinema sheet open on top of the Filters sheet the press went to Filters: opening the cinema sheet re-rendered `FiltersModalProvider`, `FiltersModal` re-subscribed in that same commit, and back closed the sheet behind the one the user was looking at. Now every surface is stamped with a sequence number when it opens and keeps it, one RN subscription fans the press out highest-first, and the handler is read through a ref so a re-render can never reorder anything. The subscription is dropped when the last surface closes, so it is always re-added after react-navigation's and an open surface still beats navigation. `AppBottomSheet`, `ShowtimeActionModal` and `SearchBar`'s `AndroidBackClear` all go through it — nothing subscribes to `BackHandler` directly any more
