# MiKiNO — App ⇄ Website, after the rebuild

**Date:** 2026-09-07 · **Branch:** `dev`, 21 commits (`d188f3a`..`3de6e70`)
**Status:** nothing here has been type-checked or opened in a browser.

---

## 1. Where it stands

Measured against the generated SDK: the website now reaches **87 of 122** methods, up from 41. Mobile reaches 92. Sixteen of the web's are the admin panel the app doesn't have, so on shared product surface the two are close to level.

The website went from "a third of the app" to "most of the app, with a different shape". **The remaining question is almost entirely UI, not features** — which is why this rewrite is organised around what to look at rather than what to build.

**Functionally still missing** (the whole list):

| Missing | Size | Note |
|---|---|---|
| Seat floor plan | M–L | Availability, counts, checks and sold-out watches all landed; only the map is absent |
| Group by film | M | Not a filter — the app swaps endpoints and renders film rows. The control is off, not faked |
| Cinema presets | M | Saved *filter* presets landed; the separate cinema-preset layer did not |
| Watchlist digest sources | S | |
| Cineville card + barcode | S–M | |
| Social sign-in (Apple + Google) | M | Needs a Services ID and domain verification |
| Sentry | S | Needs `pnpm add @sentry/react` — not run, it rewrites the lockfile |
| Per-friend status sharing toggle | S | Blocking and reporting landed; this one didn't |
| Friend-of-friend popup, friend watch-lists | S | |
| Push notifications in the browser | M–L | Preferences landed; Web Push itself is a separate decision |

---

## 2. The structure you'll be editing

Three files decide almost everything about how the web looks. This is the payoff of the rebuild and the thing to know before changing anything:

- **`components/Feed/FeedLayout.tsx`** — the *only* file that positions anything. `RAIL_WIDTH` 280, `DETAIL_WIDTH` 380, `LIST_MAX_WIDTH` 900, plus clearing the fixed sidebar and bottom nav. Change the layout here and every feed follows.
- **`components/Feed/ShowtimeFeedPage.tsx`** — every showtime feed renders through it: home, cinema, your agenda, a friend's agenda.
- **`features/showtimes/feed-params.ts`** — every filter dimension: URL spelling, defaults, API mapping.

**Caveat that matters for this report:** only 2 of 6 top-level pages use `FeedLayout`. Friends, the film page, Activity and Settings each still have their own layout, inherited from before. That's the single biggest source of visual inconsistency right now.

---

## 3. Where the web deliberately differs from the app

These are choices already made, following your brief — more space, fewer clicks, speed over animation. Listed so you can overrule them, not because they're in doubt.

| The app | The web | Why |
|---|---|---|
| Filters behind a button → sheet → section | Always-open 280px rail | Six actions become one click. The largest click-count win available |
| Showtime opens a full-screen sheet | Panel docks at 380px beside the list | Acting on one showtime no longer hides the alternatives |
| Filters are in-memory | Every dimension in the URL | Views are linkable, refresh-proof, back/forward works |
| Motion system throughout | None ported | Deliberate; instant is better here and it's why estimates held |
| Long-press for detail | Not used | |
| Activity is a 3-tab pager (All / You / Friends) | One flat list | Not a considered choice — see §4 |

---

## 4. What to look at — the review list

Ordered by how much the answer changes. Each item says where to look, what I chose, and what the decision actually is.

### Tier 1 — look at these first, they set everything else

**1. The filter rail, on the home feed.**
Seven sections stacked and always open: Day, Time of day, Length, Language, Your lists, Cinemas, Letterboxd lists. Cinemas is a full checkbox list of every cinema grouped by city, and it is *long* — on a 280px rail with ~40 cinemas it will dominate the page and push Letterboxd lists far below the fold.
→ **Decide:** does the rail need collapsible sections, a scroll region per section, or should Cinemas move behind a "Choose cinemas" control? This is the one I'd expect to need real work.

**2. The docked detail panel, with a showtime selected.**
380px, and it now stacks: status buttons → seats → invites → visibility → ticket link → film link. With a long friends list, invites has its own 260px scroll region inside a panel that also scrolls.
→ **Decide:** section order, and whether invites and visibility should be behind a disclosure rather than always expanded. I stacked everything flat because I could not see it.

**3. Narrow screens, anywhere.**
Below the `md` breakpoint the rail disappears entirely (so **no filters at all on a phone browser**) and the detail panel renders inline underneath the whole list rather than near the row you tapped.
→ **Decide:** rail as a drawer, panel as a sheet or as an inline row expander. This is the least finished part of the whole rebuild and I'd treat it as known-broken rather than a judgement call.

**4. Dark mode, on every screen.**
Neutrals are converted app-wide and follow the theme. **About 30 accent tints do not** — `green.200`, `orange.200`, `blue.50`, `yellow.100` and similar, in eight files: `MovieCard`, `MovieInfoBox`, `ShowtimeInfo`, `MovieTitle`, `ShowtimeRow`, `UserCard`, `FriendsPage`, `__root`. These are pale light-mode fills and will read as bright patches on a dark ground.
→ **Decide:** whether each is a status colour (make it a semantic token pair) or decoration (drop it). Mechanical once decided, but it's a per-case judgement.

### Tier 2 — real decisions, smaller blast radius

**5. Page-level inconsistency.** Open Friends, then the film page, then Activity, then Settings. Friends is a two-column grid, the film page is the old bespoke layout with a synopsis appended, Activity is a centred 720px column, Settings is Chakra tabs. None uses `FeedLayout`.
→ **Decide:** which of these should adopt the shell, and whether the shell needs a non-feed variant.

**6. Settings has 7 tabs now** — My profile, Password, Letterboxd, Notifications, Appearance, Blocked accounts, Danger zone. Chakra tabs are horizontal.
→ **Decide:** whether they wrap acceptably or should become a vertical rail.

**7. The cinema page is a navigation dead end.** `/cinema-showtimes/<id>` sits outside `_layout`, so it has no sidebar and no way out except the back button. It kept that path because the app deep-links to it.
→ **Decide:** move it under `_layout` (regenerates the route tree), or give it its own header with a way back.

**8. Single-select controls that look multi-select.** Time of day and Length are one-at-a-time (the shared helpers keep only the first), but they render as rows of toggle buttons identical to Day, which *is* multi-select.
→ **Decide:** make them look like a choice — segmented control or radio row.

**9. Length is three buckets** (Under 1½h / 1½–2h / Over 2h) where the app has a slider.
→ **Decide:** are the buckets right, and is a bucket enough?

**10. Letterboxd lists carry an Only/Hide button pair per row.** Invented for the web; the app expresses include/exclude differently. Two small buttons per row in a 280px rail is tight.
→ **Decide:** is the pair readable, or should exclude live elsewhere?

**11. No active-filter chips.** The app shows a removable chip per active filter. The web shows a "Clear filters (n)" button, on the theory that an open rail already displays state.
→ **Decide:** is the rail enough, or do you still want chips above the list?

**12. Presets are a flat row** of name + star + trash, with a save dialog that has a name field and one checkbox. No reordering, and no per-dimension opt-out — the app lets you mark dimensions the preset should leave alone, and here a preset always restores everything.
→ **Decide:** whether "leaves alone" matters enough on the web to build the picker. It's the one real behavioural simplification I made.

### Tier 3 — worth a glance

**13. Status buttons in the panel** are three equal-width buttons (Going / Interested / Not going) where the app uses a segmented control. Pressing the current one clears it.

**14. Notification preferences** are three buttons per row against the app's segmented control, seven rows. Check the row doesn't wrap awkwardly.

**15. The seat badge** appears on feed rows only for non-calm levels, and sits in the info box next to the cinema badge. Check it doesn't crowd the title at narrow widths.

**16. Moderation menu** is a kebab on every user row, and Block does not confirm (Settings → Blocked accounts is the undo). Check the kebab doesn't fight the existing accept/decline buttons.

**17. Activity is one flat list** where the app has All / You / Friends. Not a decision I made on purpose — I just built the feed.
→ **Decide:** does the web need the pager, or is one list plus the extra height enough?

**18. The showtime card is unchanged** from the old web design — poster, date block, title, cinema, friend badges. Selection is a 3px left border. Everything around it changed; the row didn't.

---

## 5. Things I know are unfinished

Not decisions — defects or omissions, listed so they don't read as choices.

- **Nothing has been rendered.** Every file parses and every import resolves in both clients, but no type-check and no browser. Expect TanStack Router search-param type errors first.
- **The films list lost virtualization.** `Movies.tsx` used `useWindowVirtualizer`, but `_layout` scrolls an inner Box and not the window, so it was never working — this is a removal of dead code, not a regression, but long lists are now plain.
- **`MoviesPage` duplicates the feed shell** instead of using `ShowtimeFeedPage`, because it renders film cards. Same layout, second copy.
- **Five mobile files were rewired** to read from `shared/` (notification prefs, notification row, visibility modes, report reasons, seat levels). All verified by symbol resolution only.
- **Guest mode is untested end to end.** The gates are in and the account-scoped queries are gated, but nobody has browsed the site signed out.
