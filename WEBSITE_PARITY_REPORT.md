# MiKiNO — App ⇄ Website Feature Parity Report

**Date:** 2026-09-06
**Scope:** every user-facing feature in the Expo app (`mobile/`), whether it exists on the web app (`frontend/`), and what it costs to build.

---

## 1. Executive summary

The website is roughly **where the app was in early summer**. Its last real feature work landed 2026-06/07; everything since — filters v2, saved presets, the showtime action sheet, seat availability, the notification centre, guest mode, social sign-in, Cineville, Letterboxd lists, the intro flow — is app-only.

Counted against the generated API client, the app calls **101 of 122** SDK methods. The website calls **41**, and 13 of those are the admin panel that the app doesn't have. **The website exercises ~28 of the ~88 non-admin capabilities the backend offers — about a third.**

The good news is that the expensive half of the work is already done and shared:

- `shared/client` (generated SDK) and `shared/hooks` are **already consumed by both** platforms. Every endpoint you need on the web is one import away.
- All 12 session-filter hooks (`useSession*`) are **pure react-query, zero React Native**. They work on the web unchanged today.
- 21 of the 26 filter/showtime logic modules under `mobile/components/filters` and `mobile/components/showtimes` are **pure TypeScript** (no `react-native`, no `expo-*`). Preset resolution, day tokens, time ranges, runtime ranges, cinema grouping, cinema presets, seat levels, visibility modes — all of it hoists into `shared/` with a file move.

So the remaining work is **overwhelmingly UI**, not logic. The estimates below assume you do that hoist first (see §6, Phase 0).

**Headline gaps, by size:**

| Gap | Size |
|---|---|
| Filter system (11 dimensions + saved presets + cinema presets) | XL |
| Showtime action panel (status, invites, visibility, seats, watches) | XL |
| Notification centre + Activity feed | L |
| Guest browse mode | L |
| Seat availability + floor plan | L |
| Friends: visibility, blocking, reporting, friend agendas | M–L |
| Social sign-in (Apple + Google) | M |
| Letterboxd lists + watchlist digest | M |
| Cineville card | S–M |

**Three things worth knowing before you plan:**
- **The web has no dark mode.** Settings→Appearance renders a single radio: "Light Mode". Given the app ships a full themed palette, this will read as broken to anyone switching between the two.
- **The web has no error monitoring.** Sentry is live in the app (prod since 2026-08-26); the website has none, so you are currently blind to web breakage.
- **The web dashboard can't show you what's playing.** `MainShowtimesPage` hardcodes `GOING`+`INTERESTED`, so a signed-in user with an empty agenda sees an empty homepage.

**Effort scale:** XS <0.5d · S 0.5–1d · M 2–3d · L 4–7d · XL 8d+. Days are for a dev already fluent in this codebase, UI + wiring + a light pass of tests, not counting design polish.

---

## 2. Architecture: what you inherit for free

| Layer | State | Consequence |
|---|---|---|
| `shared/client` (openapi-ts SDK) | Shared, current | No API work for any feature below |
| `shared/hooks/useFetch*` | Shared; web uses 13/40 | Data fetching is mostly a one-line import |
| `shared/hooks/useSession*` | Pure react-query | All 12 filter-state hooks drop into the web as-is |
| `shared/filters/day-filter-utils.ts` | Already hoisted | Day tokens work on web today |
| `mobile/components/filters/*.ts` (13 of 16) | Pure TS, mobile-only by location | Hoistable in an afternoon |
| `mobile/components/showtimes/*.ts` (5 of 5) | Pure TS | Same |
| `shared/theme/colors.ts` | Shared | Palette is consistent |
| Web UI kit | Chakra UI v3.37 + TanStack Router/Query, React 19 | Modern; no framework migration needed |

**The one structural blocker:** `frontend/src/routes/_layout.tsx` hard-redirects every unauthenticated visitor to `/login` in `beforeLoad`. Guest mode can't exist until that guard is replaced with a per-action gate.

---

## 3. Feature inventory

Legend — **On web?** · ✅ full · 🟡 partial/worse · ❌ absent · ➖ N/A on web

### 3.1 Navigation & shell

| Feature | App | On web? | Notes | Effort |
|---|---|---|---|---|
| 5 primary destinations | Settings · Movies · Showtimes · Activity · Friends | 🟡 | Web has 6: Dashboard, Movies, Agenda, Friends, Invites, Settings. "Activity" and "Invites" are different things; web has no unified Activity | S (re-map IA) |
| Sidebar (desktop) | ➖ | ✅ | Works; underused — see §7 | — |
| Bottom nav (narrow) | tab bar | ✅ | Icons only, no labels/badges | XS |
| Unseen badges on tabs | Activity + Friends counts | ❌ | `getMyUnseenNotificationCount` / `getMyUnseenShowtimePingCount` unused on web | S |
| Dark / light / system theme | ✅ (+ animated switch) | ❌ | **Settings→Appearance offers exactly one radio option: "Light Mode".** There is no dark theme on the web at all | M |
| Pull-to-refresh / snapshot refresh | ✅ | 🟡 | Web sets `snapshotTime` once per mount, never refreshes it | XS |
| Deep links (`/movie`, `/ping`, `/add-friend`, `/cinema-showtimes`) | ✅ | 🟡 | Routes exist but 2 of them are "open the app" stubs | S |
| Install-app gate on shared links | ➖ | ✅ | Deliberate and correct — leave as is | — |
| Update-required screen | ✅ | ➖ | Web is always current | — |

### 3.2 Showtimes feed (the app's home tab)

| Feature | App | On web? | Notes | Effort |
|---|---|---|---|---|
| Paginated showtime feed | ✅ | 🟡 | `MainShowtimesPage` exists but is **hardcoded to GOING+INTERESTED** — the web has no browsable all-showtimes feed at all | M |
| Search within feed | ✅ debounced, field-selectable | ❌ | `SearchBar` exists on Movies only | S |
| Filter chips / active-filter row | ✅ | ❌ | Depends on §3.3 | (in 3.3) |
| Filter presets row | ✅ | ❌ | Depends on §3.3 | (in 3.3) |
| Group-by-movie toggle | ✅ | ❌ | `useSessionGroupByMovie` unused on web | S |
| Tap a showtime → action panel | ✅ | ❌ | **Web showtime cards are inert.** Only the Movie page opens a dialog | (in 3.4) |
| Friend badges on cards (going/interested) | ✅ | ✅ | Present | — |
| Watchlisted/watched friend markers | ✅ | ❌ | | S |
| Cinema pill with brand colour | ✅ | 🟡 | `CinemaBadge` exists, simpler | XS |
| Subtitle/language badges | ✅ | ❌ | | XS |
| Seat-availability badge inline | ✅ | ❌ | | (in 3.5) |
| Infinite scroll | ✅ | ✅ | `useInfiniteScroll` | — |

### 3.3 Filters — **the single biggest gap**

The app has an eleven-dimension filter system with two independent preset layers. The web has a modal with **cinema checkboxes and a day picker**, and a watchlist-only toggle in the top bar.

| Dimension | App | On web? | Effort |
|---|---|---|---|
| Cinemas (city-grouped, search, select-all) | ✅ `CinemaFilterModal` (1337 lines) | 🟡 flat checkbox list, no search/presets | M |
| — Cinema presets (create/rename/favourite/delete, quick popover) | ✅ | ❌ | M |
| — "Empty selection = all cinemas" rule | ✅ | ❌ | No such resolution in `Filters.tsx`/`CityCinemas.tsx`; web sends the raw list | XS |
| Days (relative/weekday/ISO tokens, specific-dates calendar) | ✅ | 🟡 date picker only, no tokens | S |
| Time of day (ranges + presets + inline slider) | ✅ | ❌ | M |
| Movie length / runtime range | ✅ | ❌ | S |
| Language / "English subtitled or spoken" | ✅ (OR semantics) | ❌ | S |
| Watchlist only | ✅ | ✅ | — |
| Watchlist exclude | ✅ | ❌ | XS |
| Watched only | ✅ | ❌ | XS |
| Hide watched | ✅ | ❌ | XS |
| Letterboxd lists — include | ✅ curated + your own | ❌ | M |
| Letterboxd lists — exclude | ✅ | ❌ | (same) |
| Status filter (going / interested / all) | ✅ | ❌ | S |
| Group by movie | ✅ | ❌ | S |
| **Saved filter presets** (save, name, favourite, manage, untouched-field semantics, cinema-scope inference) | ✅ | ❌ | L |
| Active-filter chips with remove | ✅ `ActiveFilterChips` (901 lines) | ❌ | M |
| Filters shared across Showtimes/Movies tabs | ✅ `useSharedTabFilters` | ❌ | S |
| Filter state in the URL | ➖ | 🟡 movies only (query/watchlistOnly/days) | S (extend) |

**Subtotal: XL — realistically 10–15 days.** But note: the *logic* is done (`saved-presets.ts`, `cinema-presets.ts`, `time-range-utils.ts`, `runtime-range-utils.ts`, `premade-filter-presets.ts`, `filter-preset-utils.ts` are all pure). You are building Chakra UI over existing pure functions. The animation-heavy parts (`MorphingChipLabel`, `filter-change-animation`, `PresetButton`'s light band) are explicitly **not needed** on the web per your brief.

### 3.4 Showtime action panel — **the second biggest gap**

`ShowtimeActionModal.tsx` is 3655 lines and is where most of the app's social features live. The web's equivalent is a small dialog reachable only from a movie page, with three status buttons + an invite list.

| Feature | App | On web? | Effort |
|---|---|---|---|
| Set Going / Interested / Not going | ✅ | 🟡 movie page only, not from feeds | S (surface it everywhere) |
| Invite (ping) a friend | ✅ with search + sent/pending states | 🟡 flat list, no search, no state | S |
| Uninvite a friend | ✅ | ❌ | XS |
| See who invited you | ✅ | ❌ | XS |
| Nudge/remind an invited friend | ✅ `sendShowtimeReminder` | ❌ | XS |
| Share an invite link (token) | ✅ `createShowtimePingLinkToken` | ❌ | S |
| Accept invite from link | ✅ | ✅ `/ping/$showtimeId/$sender` | — |
| Per-showtime status visibility (ALL / INVITED) | ✅ | ❌ | M |
| "Invite before going private" dialog | ✅ | ❌ | S |
| Hidden-attending-friends reveal | ✅ `getHiddenAttendingFriendsForShowtime` | ❌ | S |
| "Remove interested elsewhere" prompt | ✅ | ❌ | S |
| Set your seat | ✅ | ❌ | (in 3.5) |
| Ticket link ("Get ticket") | ✅ | ✅ | — |
| Report a showtime | ✅ 5 reasons | ✅ | — |
| Movie "More info" link-through | ✅ | ✅ | — |

**Subtotal: L–XL — 7–10 days**, dominated by visibility + invite state.

### 3.5 Seat availability & floor plans

Entirely absent from the web. Backend is ready (`getSeatAvailability`, `getSeatAvailabilityBatch`, `getShowtimeSeatmap`, `requestSeatAvailabilityCheck`, `startSoldOutWatch`, `stopSoldOutWatch`).

| Feature | App | On web? | Effort |
|---|---|---|---|
| Inline seat-availability badge (6-level busyness) | ✅ | ❌ | S |
| Batch prefetch for feeds | ✅ | ❌ | XS |
| Manual "Check how many seats are left" | ✅ auth-gated one-shot | ❌ | S |
| Seat floor plan viewer | ✅ `SeatFloorPlan` 700 lines, SVG-ish | ❌ | M–L |
| Floor-plan preview thumbnail | ✅ | ❌ | S |
| Set/store your seat | ✅ | ❌ | S |
| Sold-out watch ("tell me if a ticket frees up") | ✅ | ❌ | S |
| Seat-alert push notification | ✅ | ➖ (see 3.9) | — |

**Subtotal: L — 5–7 days.** The floor plan is the only genuinely fiddly piece; `seat-floor-plan-layout.ts` is pure and portable, so it's a rendering job (and SVG on the web is *easier* than on RN).

### 3.6 Movies

| Feature | App | On web? | Effort |
|---|---|---|---|
| Paginated movie grid/list | ✅ | ✅ | — |
| Search movies | ✅ | ✅ | — |
| All filters | ✅ | 🟡 cinema+day+watchlist only | (in 3.3) |
| Movie detail page | ✅ 1087 lines | 🟡 present, thinner | M |
| — Poster, title, original title, year | ✅ | ✅ | — |
| — Director(s) | ✅ | ✅ | — |
| — Cast / "STARRING" | ✅ | ❌ | API returns `cast`; unused on web | XS |
| — Description | ✅ | ❌ | API returns `description`; the web renders it nowhere | XS |
| — IMDb / Letterboxd links | ✅ | ✅ | — |
| — Open in Letterboxd | ✅ | ✅ | — |
| — Share the movie | ✅ | ❌ | XS |
| — Friends who watchlisted / watched (popup) | ✅ | ❌ | S |
| — Showtimes list, filtered | ✅ | 🟡 unfiltered | S |
| Cinema page (all showtimes for one cinema) | ✅ 662 lines | ❌ **stub page saying "use the app"** | M |
| Friend agenda page (one friend's showtimes) | ✅ 498 lines | 🟡 `$userId/showtimes` exists, 16 lines | S–M |

### 3.7 Friends & social

| Feature | App | On web? | Effort |
|---|---|---|---|
| Friends list | ✅ | ✅ | — |
| Search / discover people | ✅ dedicated pager page | ✅ | — |
| Send / accept / decline / cancel request | ✅ | ✅ | — |
| Remove friend | ✅ | ✅ | — |
| Received / sent request lists | ✅ | ✅ | — |
| Add-friend deep link | ✅ | ✅ | — |
| **Share an invite link to the app** | ✅ | ❌ | S |
| **Per-friend status sharing toggle** (`shares_status` opt-out) | ✅ | ❌ | S |
| **Default status visibility screen** | ✅ 207 lines | ❌ | S |
| **Block a user** | ✅ | ❌ | S |
| **Blocked accounts list / unblock** | ✅ 142 lines | ❌ | S |
| **Report a user** | ✅ | ❌ | XS |
| Friend-of-friend popup | ✅ | ❌ | S |
| Friend's watchlist/watched modal | ✅ | ❌ | S |
| Friend agenda options | ✅ | ❌ | S |
| Non-friend profile view | ✅ | ❌ | S |
| Inline request buttons in search results | ✅ | 🟡 | XS |

**Subtotal: M–L — 4–6 days.** Note the moderation trio (block / blocked list / report user) is **completely missing from the web** — worth flagging separately because App Store/Play policy treats it as required, and a web client with an account system arguably has the same obligation.

### 3.8 Activity & notifications

| Feature | App | On web? | Effort |
|---|---|---|---|
| Activity tab: All / You / Friends pager | ✅ | ❌ | M |
| Notification centre (feed of events) | ✅ sheet + rows | ❌ | M |
| Unseen count + mark-seen | ✅ | ❌ | S |
| Dismiss a notification | ✅ | ❌ | XS |
| Invites (pings) list | ✅ | ✅ `/pings` | — |
| Unseen ping count | ✅ | 🟡 `markMyShowtimePingsSeen` used, count not shown | XS |
| Dismiss / delete a ping | ✅ both | 🟡 delete only | XS |
| Feature-tip rows in the feed | ✅ | ❌ | (see 3.11) |

**Subtotal: L — 4–6 days.**

### 3.9 Notification preferences

The app has **7 notification types**, each with an Off/Push/Email tri-state. The web has **one checkbox**.

| Preference | App | On web? |
|---|---|---|
| Friend activity (`notify_on_friend_showtime_match`) | ✅ tri-state | 🟡 on/off checkbox |
| Invites (`notify_on_showtime_ping`) | ✅ | ❌ |
| Interest reminders (`notify_on_interest_reminder`) | ✅ | ❌ |
| Seat availability (`notify_on_seat_alert`) | ✅ | ❌ |
| Sold out (`notify_on_sold_out`) | ✅ | ❌ |
| Friend requests (`notify_on_friend_requests`) | ✅ | ❌ |
| Reminders from friends (`notify_on_showtime_reminder`) | ✅ | ❌ |
| "Notify on new films" digest toggle | ✅ | ❌ |
| Open system notification settings | ✅ | ➖ |
| Push token registration | ✅ Expo push | ➖ / Web Push |

**Effort: S for the preference UI** (it's a settings list over `updateUserMe`) — the mobile `NotificationPreferenceList` is nearly portable. **Separately M–L if you want actual Web Push** (service worker, VAPID keys, a second token table on the backend). My recommendation: ship the *preferences* now (they govern email + the app's push), defer Web Push.

### 3.10 Letterboxd & watchlist

| Feature | App | On web? | Effort |
|---|---|---|---|
| Set Letterboxd username | ✅ | ✅ | — |
| Sync watchlist | ✅ | ✅ | — |
| Sync watched | ✅ | ✅ | — |
| Last-synced timestamps shown | ✅ | ❌ | XS |
| **Add a Letterboxd list** | ✅ | ❌ | S |
| **Curated lists** | ✅ | ❌ | S |
| **Sync / remove a list** | ✅ | ❌ | XS |
| Filter by list (include/exclude) | ✅ | ❌ | (in 3.3) |
| **Watchlist digest sources** (add/edit/delete) | ✅ | ❌ | S |
| Digest frequency info | ✅ | ❌ | XS |
| Digest unsubscribe | ➖ email link | ✅ backend HTML | — |

**Subtotal: M — 2–3 days.**

### 3.11 Onboarding, tips, misc

| Feature | App | On web? | Effort |
|---|---|---|---|
| 5-step first-run intro | ✅ | ❌ | M (or skip — see note) |
| Feature tip modals (4) | ✅ | ❌ | S–M (or skip) |
| Filters spotlight overlay | ✅ | ❌ | S (or skip) |
| **Guest browse mode** | ✅ | ❌ **hard login wall** | L |
| Sign-in-required dialog / gate | ✅ | ❌ | S (part of guest mode) |
| Cineville card + CODE 128 barcode | ✅ | ❌ | S–M |
| Cineville shortcut buttons | ✅ | ❌ | XS |
| Email verification resend | ✅ | ❌ | XS |
| Email-change confirm flow | ✅ | ❌ | S |
| Social sign-in (Apple + Google) | ✅ | ❌ | M |
| Privacy policy / support pages | ✅ links | ✅ | — |
| Analytics `trackEvent` | ✅ | ✅ | — |
| Sentry | ✅ | ❌ | Only `@sentry/cli` at the root (mobile source maps). The web is unmonitored | S |

**Notes on onboarding:** a web visitor arrives with a mouse and a big screen; a 5-step swipe intro is the wrong shape. I'd port the *content* (pick cinemas, connect Letterboxd, find friends) as an optional dismissible "finish setting up" strip on the dashboard rather than a modal flow. That's S, not M, and better for the web.

### 3.12 What the **web** has that the app doesn't

Don't lose these when redesigning:

| Feature | Notes |
|---|---|
| Admin: analytics overview | `/admin` |
| Admin: movie search + TMDB cache correction | `AdminMovies`, `TmdbCacheOverrideForm` |
| Admin: showtime search / edit / delete | `AdminShowtimes` |
| Admin: showtime + user report queues, report-bans | `AdminReports` |
| Admin: scrape monitor + recaps + attachments | `ScrapeMonitor` |
| Password reset via emailed token | `/reset-password` (app only initiates) |
| `/beta` page | |

---

## 4. Capability coverage, by the numbers

Counting distinct generated SDK methods actually called:

| | Mobile | Web |
|---|---|---|
| Total methods called | 101 | 41 |
| Of which admin/scrape-only | 0 | 13 |
| **Product methods** | **101** | **28** |

Endpoints the backend exposes that **neither** client calls: `clearFavoriteCinemaPreset`, `getFavoriteCinemaPreset`, `countMyShowtimes`, `getPingedFriendIdsForShowtime`, `listUserReports`, `updateUserReport`, `overrideTmdbCacheEntry`, `simulateSeatAvailability`, `refreshAccessToken` (used indirectly), `healthCheck`, `verifyEmail`, `unsubscribeWatchlistDigest`, `getScrapeRecapAttachment`.

---

## 5. Effort roll-up

| Area | Effort | Days |
|---|---|---|
| Phase 0 — hoist pure logic into `shared/` | S | 1 |
| Filters + presets (§3.3) | XL | 10–15 |
| Showtime action panel (§3.4) | L–XL | 7–10 |
| Seat availability + floor plan (§3.5) | L | 5–7 |
| Activity + notification centre (§3.8) | L | 4–6 |
| Guest browse mode (§3.11) | L | 4–6 |
| Friends: visibility/moderation/agendas (§3.7) | M–L | 4–6 |
| Movies: detail page, cinema page (§3.6) | M | 3–4 |
| Notification preferences UI (§3.9) | S | 1 |
| Letterboxd lists + digest sources (§3.10) | M | 2–3 |
| Social sign-in (§3.11) | M | 2–3 |
| Cineville card (§3.11) | S–M | 1–2 |
| Feed/search/shell polish (§3.1, §3.2) | M | 2–3 |
| Dark mode + theme tokens (§3.1) | M | 2–3 |
| Sentry on web (§3.11) | S | 1 |
| Onboarding-as-checklist (§3.11) | S | 1 |
| **Total** | | **≈ 50–72 dev-days** |

Add Web Push (M–L, 3–5d) only if you decide the web needs its own notifications.

---

## 6. Recommended build order

**Phase 0 — Foundations (1–2 days).** Move the 18 pure modules from `mobile/components/filters/*.ts` and `mobile/components/showtimes/*.ts` into `shared/filters/` and `shared/showtimes/`; re-export from their old mobile paths so nothing breaks. Everything after this gets cheaper. Also: replace the `_layout.tsx` `beforeLoad` redirect with a signed-in-aware layout, even before guest mode ships — it unblocks Phase 4.

**Phase 1 — Make the feed real (4–6 days).** A browsable all-showtimes feed with search, group-by-movie, and clickable cards. Today the web literally cannot show you what's playing tonight unless you already marked interest. This is the biggest *value* gap even though it's not the biggest *effort* gap.

**Phase 2 — Filters (10–15 days).** The whole system, over the hoisted logic. On a desktop this should be a **persistent left rail or a docked panel, not a modal** — see §7.

**Phase 3 — Showtime action panel (7–10 days).** Status, invites, visibility, reminders, invite links. Make it a side panel that opens next to the feed rather than a centred dialog, so the list stays visible.

**Phase 4 — Guest mode (4–6 days).** Now cheap, because Phase 0 removed the hard guard and Phases 1–3 built the read-only surfaces guests actually use. Follow the four gating rules already established for the app.

**Phase 5 — Social depth (4–6 days).** Friend visibility, blocking, reporting, friend agendas, cinema pages.

**Phase 6 — Activity + notification prefs (5–7 days).**

**Phase 7 — Seats + floor plans (5–7 days).**

**Phase 8 — Long tail (5–8 days).** Letterboxd lists, digest sources, Cineville, social sign-in, onboarding checklist.

Phases 1–4 (≈26–37 days) get you to "a person could genuinely use the website instead of the app." Phases 5–8 close the last third.

---

## 7. Design notes for the web build

Per your brief — same general layout, more space, fewer clicks, speed over animation:

1. **Filters live on the page, not behind a modal.** The app hides them behind a button because a phone has no room. A desktop has a 280–320px left rail going spare. Every filter dimension visible and one-click-toggleable turns the app's *tap button → open modal → open section → toggle → close → close* (6 actions) into **one click**. This is the single largest click-count win available.
2. **The showtime panel should dock, not overlay.** A right-hand panel (~400px) next to the feed lets you mark status on one showtime while still seeing the others. On the app that's a full-screen sheet because there's no alternative.
3. **Three-column dashboard.** Filter rail · feed · context panel. The current web dashboard uses a single centred column and wastes roughly half of a 1440px viewport.
4. **Every filter dimension in the URL.** The app can't share a filtered view; the web can. `?cinemas=…&days=…&time=…&lists=…` makes every view linkable and gives you back/forward for free. Extend what `/movies` already does.
5. **Hover replaces long-press.** Friend badges, seat counts, and cinema pills can reveal their detail on hover instead of costing a tap.
6. **Keyboard.** `/` to search, `f` to focus filters, `escape` to close the panel, `j`/`k` through the feed. Cheap, and it's the kind of speed the brief asks for.
7. **Skip the motion system.** `filter-change-animation.ts`, `MorphingChipLabel`, `showtime-glow`, the preset light band, `FeedItemEntrance`, sheet warm-up ordering — none of it should be ported. Instant state changes are *better* here, and skipping them is a meaningful part of why these estimates aren't larger.
8. **Keep the install gate** on `/ping`, `/movie`, `/add-friend` for phone visitors. It's correct behaviour and it's already built.
