# MiKiNO — App ⇄ Website, after the rebuild

**Date:** 2026-09-07 · **Branch:** `dev`, 26 commits (`d188f3a`..`1b32d65`)
**Status:** nothing here has been type-checked or opened in a browser.

---

## 1. Where it stands

Measured against the generated SDK: the website now reaches **100 of 122** methods, up from 41. Mobile reaches 92 — the web is ahead, because sixteen of its methods are the admin panel the app has never had.

Everything you asked for is built. **What is left is entirely UI** — which is why this report is a list of things to open and judge rather than things to build.

**Deliberately not built** (your call, from this round):

| Left out | Why |
|---|---|
| Sentry | Needs `pnpm add @sentry/react`; you said leave it |
| Push notifications in the browser | Service worker + VAPID; preferences are built, delivery is not |
| Cineville card + barcode | |
| Social sign-in (Apple + Google) | Needs an Apple Services ID and domain verification |

**Everything else landed this round:** the seat floor plan, group-by-film, cinema presets, watchlist digest sources, per-friend status sharing, hidden-attending-friends, the invite-before-private warning, resending the email confirmation, and marking invites seen.

Three SDK methods remain app-only and are not gaps: `registerPushToken`/`deletePushToken` (push, left out) and `getShowtimeById` (a deep-link path the web reaches differently). The two `count*` endpoints are also unused — the web shows the number of rows it has loaded instead, which is a UI choice worth a look (item 19).

---

## 2. The structure you'll be editing

Three files decide almost everything about how the web looks. This is the payoff of the rebuild and the thing to know before changing anything:

- **`components/Feed/FeedLayout.tsx`** — the *only* file that positions anything. `RAIL_WIDTH` 280, `DETAIL_WIDTH` 380, `LIST_MAX_WIDTH` 900, plus clearing the fixed sidebar and bottom nav. Change the layout here and every feed follows.
- **`components/Feed/FeedPageShell.tsx`** — the chrome around any feed: toolbar, rail, presets, loading / empty / paging. `ShowtimeFeedPage` and `MovieFeedPage` differ only in what they put between them, which is what makes group-by-film a swap rather than a second page.
- **`features/showtimes/feed-params.ts`** — every filter dimension: URL spelling, defaults, API mapping.

**Caveat that matters for this report:** only 3 of 6 top-level pages use the shell. Friends, the film page, Activity and Settings each still have their own layout, inherited from before. That's the single biggest source of visual inconsistency right now.

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

Twenty-five items, ordered by how much the answer changes. Each says where to look, what I chose, and what the decision actually is. Tier 4 is everything built in the last round, which nobody has seen at all.

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

**6. Settings tab overflow** — see item 25; it grew again this round.

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

**19. Result counts are "rows loaded", not totals.** The toolbar says "40 showing" meaning forty are on screen, where the app calls a count endpoint for the real total. Cheaper, and arguably more honest about an infinite list — but it does mean the number climbs as you scroll.
→ **Decide:** is the loaded count fine, or should it read "40 of 312"?

### Tier 4 — new this round, nobody has seen any of it

**20. The seat floor plan**, in the panel with a showtime selected at a cinema that reports seats. It measures the panel and fits the room into 260px of height. Clicking a free seat sets yours, but only when you are marked Going.
→ **Decide:** is 260px enough to read a 250-seat room at 380px wide? This is the item most likely to need a size or a zoom.

**21. Group by film**, the checkbox in the toolbar on the home feed. It swaps the whole feed to film rows. The filter rail and presets stay put across the swap, which is intended — but the rows change shape underneath you.
→ **Decide:** does the swap need any transition or label to explain itself?

**22. Cinema presets**, at the top of the Cinemas section in the rail. Each row is a name plus up to three icon buttons (rename, make-default, delete) in a 280px column, above a checkbox list of every cinema.
→ **Decide:** three icons per row is a lot at that width. Menu instead?

**23. The digest tab**, Settings → Digest. Adding one is three dropdowns and a button on one line, which will wrap at narrow widths.

**24. Per-friend status sharing** is a "Sharing"/"Hidden" button on every friend row, next to the moderation kebab and the remove button. That row is getting busy.
→ **Decide:** does sharing belong on the row, or on a profile view?

**25. Settings is now eight tabs.** My profile, Password, Letterboxd, Digest, Notifications, Appearance, Blocked accounts, Danger zone. Horizontal tabs will almost certainly wrap now — this supersedes item 6.

---

## 5. Things I know are unfinished

Not decisions — defects or omissions, listed so they don't read as choices.

- **Nothing has been rendered.** Every file parses and every import resolves in both clients, but no type-check and no browser. Expect TanStack Router search-param type errors first.
- **The films list lost virtualization.** `Movies.tsx` used `useWindowVirtualizer`, but `_layout` scrolls an inner Box and not the window, so it was never working — this is a removal of dead code, not a regression, but long lists are now plain.
- **Six mobile files were rewired** to read from `shared/` (notification prefs, notification row, visibility modes, report reasons, seat levels, report dialog). All verified by symbol resolution only.
- **Guest mode is untested end to end.** The gates are in and the account-scoped queries are gated, but nobody has browsed the site signed out.
- **The seat floor plan has never been drawn.** It fits a room using the app's own geometry code, but that code has only ever run against React Native's layout, not a `ResizeObserver` and absolutely-positioned divs. Expect this one to need a fix.
