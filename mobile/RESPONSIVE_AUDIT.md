# Mobile responsive-design audit

Audit of the Expo/React Native app in `mobile/`, reviewed as a strict frontend
designer against a representative device matrix. Method is static analysis of
the layout code (flex, fixed dimensions, safe-area usage, font scaling) reasoned
concretely against each width — no rendering was performed (see
[Method & limitations](#method--limitations)).

Line references are to the state of the tree **before** the fixes in this pass;
fixed items say so explicitly and the code now differs.

## Device matrix

| Ref | Device | Logical size | Notes |
|-----|--------|--------------|-------|
| SE | iPhone SE 2/3 | 375 × 667 pt | no notch, `insets.bottom = 0` |
| N320 | narrow Android | 320 × 640 dp | worst realistic case |
| A360 | small Android | 360 × 640 dp | very common budget size |
| 15 | iPhone 15/16 | 393 × 852 pt | Dynamic Island, home indicator (34pt) |
| A412 | standard Android | 412 × 915 dp | gesture nav bar (~24-48dp) |
| PM | iPhone Pro Max | 430 × 932 pt | |
| TAB | iPad / 10" Android | 768 × 1024 pt | `supportsTablet: true` in `app.json` |

Severity vocabulary:

- **breaks layout** — content overlaps, clips, or is unreachable on a device in the matrix.
- **looks unprofessional** — nothing is unusable, but the result is visibly wrong/sloppy.
- **nitpick** — polish, consistency, or a guideline violation with low practical impact.

## Summary

| # | Finding | Severity | Fixed |
|---|---------|----------|-------|
| 1 | Top bar title runs under the back button and bell | breaks layout | ✅ |
| 2 | Time/Runtime quick popovers hang off a 320dp screen | breaks layout | ✅ |
| 3 | Auth forms are not scrollable — submit unreachable with keyboard up | breaks layout | ✅ |
| 4 | Day filter sheet footer sits under the home indicator / gesture bar | breaks layout | ✅ |
| 5 | Settings form fields hidden behind the iOS keyboard | breaks layout | ✅ |
| 6 | Active-filter chip has no max width — one long chip pushes the rest off-screen | breaks layout | ✅ |
| 7 | Showtime card date column clips at larger OS text sizes | breaks layout | ✅ |
| 8 | Showtime sheet CTA labels wrap to two lines at ≤340dp | looks unprofessional | ✅ |
| 9 | Day-picker first week row sits 6pt low | looks unprofessional | ✅ |
| 10 | Badge counts overflow their 18pt circle at large font scale | looks unprofessional | ✅ |
| 11 | Sub-44pt touch targets on filter pills and chips | nitpick | ✅ |
| 12 | `add-friend` uses `SafeAreaView` where every other screen uses `TopSafeAreaView` | nitpick | ✅ |
| 13 | Movie page back button is a 38pt touch target | nitpick | ✅ |
| 14 | Showtimes list has no bottom padding, movie feeds do | nitpick | ✅ |
| 15 | Cinema pill starves the movie title on narrow cards | looks unprofessional | ❌ judgement call |
| 16 | Everything stretches to full width on a tablet | looks unprofessional | ~ partial (main lists capped, sheets still open) |
| 17 | Movie detail header eats a third of an SE screen | looks unprofessional | ❌ restructuring |
| 18 | Card heights are fixed in points and ignore font scale generally | looks unprofessional | ❌ restructuring |
| 19 | Friend badges are 14pt tall touch targets | nitpick | ❌ by design |
| 20 | Four near-identical "Filters pill" implementations have drifted | nitpick | ❌ refactor |
| 21 | Auth screens' type scale doesn't match the rest of the app | nitpick | ❌ judgement call |
| 22 | `app/modal.tsx` is a leftover Expo template route | nitpick | ❌ out of scope |

---

## Findings

### 1. Top bar title runs under the back button and the notification bell

**Where:** `components/layout/TopBar.tsx:53-56` (title row), `:90-107` (absolutely
positioned buttons). Reached via `app/cinema-showtimes/[id].tsx:349`
(`topBarTitle={cinemaName}` + `(city)` suffix) and
`app/friend-showtimes/[id].tsx:327` (`topBarTitle` = a friend's display name).

**Severity:** breaks layout.

**What actually happens.** The container centres a single `titleRow`; the back
button and the bell are `position: "absolute"` at `left: 12` / `right: 12` and
occupy roughly x∈[12, 46] and x∈[width−46, width−12]. The title row had no
width reservation, no `numberOfLines` and no `flexShrink`.

Take the real cinema name "LantarenVenster" with the "(Rotterdam)" suffix: 15
characters at 24pt bold ≈ 195pt, plus the 15pt suffix ≈ 88pt, plus the 4pt gap
≈ **287pt** of title row.

- **15 / PM / A412 (393-430dp):** content box is 361pt, so the row spans x∈[53, 340] — it clears the buttons by a few points. Fine, but with no margin for a longer name.
- **A360:** content box 328pt → x∈[36, 324]. The title's first glyph is **10pt inside the back arrow**, and the tail is **underneath the bell**.
- **N320:** content box 288pt ≈ the row's own width → the title collides with both buttons and, because RN wraps unconstrained `Text` in a row, drops to two lines, growing the bar.

A longer name ("Filmtheater Hilversum (Hilversum)") collides even on a Pro Max.

**Fixed.** The title row now reserves `SIDE_BUTTON_RESERVED_WIDTH` (50pt from
each screen edge) as horizontal padding, is capped at `maxWidth: "100%"`, and
both texts are `numberOfLines={1}` with `flexShrink: 1`. Long names now
ellipsize centred between the two buttons instead of sliding under them.

### 2. Time and Runtime quick popovers hang off the right edge of a 320dp screen

**Where:** `components/filters/TimeQuickPopover.tsx:28` and
`components/filters/RuntimeQuickPopover.tsx:33` — `CARD_WIDTH = 312` with
`CARD_HORIZONTAL_MARGIN = 12`; positioning math at `TimeQuickPopover.tsx:208-216`.

**Severity:** breaks layout (N320 only).

**What actually happens.** The clamp is
`cardLeft = max(12, min(rawLeft, screenWidth − 312 − 12))`. On N320 the inner
term is `320 − 324 = −4`, so the `max` wins and the card is pinned at
`left: 12` with a hard `width: 312` — its right edge lands at **324pt on a
320pt screen**. The card holds a two-handle range slider, so the right-hand
(max) handle is the part that goes off-screen and becomes ungrabbable. Any
device narrower than 336dp is affected.

**Fixed.** All four quick popovers (`TimeQuickPopover`, `RuntimeQuickPopover`,
`CinemaPresetQuickPopover`, `SelectionQuickPopover`) now derive
`cardWidth = Math.min(CARD_WIDTH, screenWidth − 2 × CARD_HORIZONTAL_MARGIN)` and
use it for the width, the left clamp and the arrow clamp. On every device ≥336dp
the rendering is byte-identical to before.

### 3. Auth forms are not scrollable — the submit button is unreachable with the keyboard up

**Where:** `app/signup.tsx:67-71`, `app/login.tsx:85-89`,
`app/recover-password.tsx:82-86` — each is a `KeyboardAvoidingView` wrapping a
plain `View` with `{ flex: 1, justifyContent: 'center' }`. No `ScrollView`
anywhere.

**Severity:** breaks layout.

**What actually happens.** Signup stacks a 32pt title (+30 margin), four inputs
(≈52pt each + 16 margin), a 52pt button and a link ≈ **450pt** of content. The
keyboard covers ~300pt on an SE/A360-class device, leaving ~340pt of usable
height. `KeyboardAvoidingView` shrinks the container, `justifyContent: 'center'`
overflows it symmetrically, and with no scroll view **"Create account" is simply
off-screen and cannot be reached** — the user has to dismiss the keyboard, and
even then it is borderline. The same content at the top of iOS's normal Dynamic
Type range (~1.35×) is ≈590pt, which overflows a 640dp Android screen with the
keyboard closed.

**Fixed.** All three screens now render the form inside a `ScrollView` with
`contentContainerStyle={styles.form}` (changed `flex: 1` → `flexGrow: 1`, so it
still centres when it fits and scrolls when it doesn't) and
`keyboardShouldPersistTaps="handled"`. Because content can now scroll past the
viewport, each is also wrapped in `SafeAreaView edges={['top','bottom']}` — these
three were the only screens in the app with no safe-area handling at all.

### 4. Day filter sheet footer sits under the home indicator / gesture bar

**Where:** `components/filters/DayFilterModal.tsx:345` (footer),
`:518` (`paddingBottom: 10`).

**Severity:** breaks layout.

**What actually happens.** `AppBottomSheet` snaps to `88%` and, like any bottom
sheet, is anchored to the bottom of the screen — so the sheet's own bottom edge
*is* the screen's bottom edge. The "Clear" footer had a flat `paddingBottom: 10`
with no inset, putting a 42pt-tall button directly beneath the 34pt iOS home
indicator (15, PM) and the Android gesture bar (A412). The bottom ~24pt of the
button is both visually crossed by the indicator and swallowed by the system
gesture area. Every other sheet in the app already does this correctly
(`FiltersModal.tsx:322`, `CinemaFilterModal.tsx:438`,
`NotificationCenterSheet.tsx:51`, `SavePresetDialog.tsx:158`) — this one was the
outlier.

**Fixed.** `paddingBottom: Math.max(bottomInset, 10)` via `useSafeAreaInsets()`.

### 5. Settings form fields are hidden behind the iOS keyboard

**Where:** `app/(tabs)/settings.tsx:603` — a bare `ScrollView` with no
`KeyboardAvoidingView` and no `automaticallyAdjustKeyboardInsets`, containing
seven `TextInput`s (username, email, Letterboxd, three passwords, Cineville card).

**Severity:** breaks layout (iOS).

**What actually happens.** Android's `adjustResize` window mode handles this for
free; iOS does not. Tapping "Confirm password" or the Cineville card field —
both of which sit well down a long scroll — leaves the focused input underneath
the keyboard with no auto-scroll, so the user types blind. Worst on SE, where
the keyboard is proportionally largest.

**Fixed.** Added `automaticallyAdjustKeyboardInsets` (iOS-only, ignored on
Android, so Android behaviour is unchanged) and `keyboardShouldPersistTaps="handled"`
so a tap on a button while a field is focused registers on the first tap.

### 6. Active-filter chip has no max width — one long chip pushes the rest off-screen

**Where:** `components/filters/ActiveFilterChips.tsx:291-303` (chip),
`:380-397` (style). Labels come from `getDaySelectionLabel`, time/runtime
formatters and — the problem case — `listTitleById.get(listId)` at `:183` and
`:191`, i.e. **user-authored Letterboxd list titles**.

**Severity:** breaks layout.

**What actually happens.** The chips live in a horizontal `ScrollView`, so
nothing constrains their width: `numberOfLines={1}` and `flexShrink: 1` on the
label are inert because the available width is effectively infinite. A list
titled "Films I Want To See Before The End Of The Year" produces a single chip
~280pt wide; prefixed with "Hide: " it is wider than an N320 screen. The
cinema chip and every other active filter are then scrolled out of view, and the
user has no indication they exist beyond the small chevron affordance.

**Fixed.** `maxWidth: 180` on the chip, which lets the existing
`numberOfLines={1}` + `flexShrink: 1` do their job and ellipsize the label.

### 7. Showtime card date column clips at larger OS text sizes

**Where:** `components/showtimes/ShowtimeCard.tsx:136-144` (column),
`:209` (`height: POSTER_HEIGHT` = 112), `:223-282` (type).

**Severity:** breaks layout (accessibility text sizes).

**What actually happens.** The card is a hard 112pt tall because the poster is
`height: "100%"` of it. The date column stacks weekday (13pt), day (26pt/28
line-height), month (13pt) and time (11pt) plus `gap: 2` ×3 and 16pt of vertical
padding ≈ **93pt** at the default text size — only ~19pt of headroom. At iOS
Dynamic Type's largest non-accessibility step (~1.35×) or Android's 1.3× slider
that becomes ≈121pt, and the card has `overflow: "hidden"`, so the time line is
cut in half. At Android's 2.0× accessibility scale two of the four lines vanish.

**Fixed.** `maxFontSizeMultiplier={1.2}` on the four date-column texts (a new
`DATE_COLUMN_MAX_FONT_SCALE` constant with a comment explaining the 112pt
budget). The date is still legible, and the surrounding title/badge text
continues to scale freely.

**Note:** this is a targeted patch, not a cure — see finding 18.

### 8. Showtime sheet CTA labels wrap to two lines at ≤340dp

**Where:** `components/showtimes/ShowtimeActionModal.tsx:1195-1232` (the row),
`:1846-1858` (`ctaRow` / `ctaIconButton`).

**Severity:** looks unprofessional.

**What actually happens.** The row can hold three buttons: "All showtimes"
(intrinsic width), "Get ticket" (`flex: 1`) and "Seat A-12" (intrinsic width).
`ctaIconButton` had no `flexShrink`, so the two intrinsic buttons never yield.
On N320 the sheet's content box is 280pt: "All showtimes" needs ≈102pt, a seat
label like "Seat AA-123" ≈91pt, plus 16pt of gaps — leaving ≈71pt for a "Get
ticket" label that needs ≈85pt. The label wraps to "Get / ticket", and since the
row stretches to the tallest child, all three buttons grow. Also reachable on
A360 with the font scale turned up.

**Fixed.** `flexShrink: 1` on `ctaIconButton` and `numberOfLines={1}` on the two
labels that lacked it (the seat label already had it). Labels now ellipsize
gracefully instead of the row breaking.

### 9. Day-picker first week row sits 6pt low

**Where:** `components/filters/DayFilterModal.tsx:487` — `dayCellPlaceholder`
is `height: 44, marginTop: 8` (52pt total) while a real cell is `dayCellWrapper`
`paddingTop: 8` + `dayCell` 38pt (46pt total).

**Severity:** looks unprofessional (nitpick-adjacent, but visible every time).

**What actually happens.** `calendarGrid` is a wrapping row, so the first line of
each month — the only one containing leading blank cells — is sized by the
tallest child, the 52pt placeholder. The real day buttons in that line are
top-aligned at 8pt, leaving a 6pt gap under them that no other week has. Every
month in a 180-day picker shows the same off-by-6 first row.

**Fixed.** Placeholder height 44 → 38, with a comment tying it to the cell
geometry.

### 10. Badge counts overflow their 18pt circle at large font scale

**Where:** `app/(tabs)/_layout.tsx:262` and `:279` (tab badges),
`components/layout/TopBar.tsx:69` (bell badge),
`components/filters/FilterPills.tsx:246` (pill badge). All are 10pt text in a
fixed `height: 18, borderRadius: 9` circle.

**Severity:** looks unprofessional.

**What actually happens.** Badge text scales with the OS setting but the circle
does not. At 1.5× a two-digit count is 15pt tall inside an 18pt circle with 5pt
horizontal padding — it clips vertically and the "99+" case spills horizontally.

**Fixed.** `maxFontSizeMultiplier={1.2}` on all four badge texts.

### 11. Sub-44pt touch targets on filter pills and active-filter chips

**Where:** `components/filters/FilterPills.tsx:271-278` (`paddingVertical: 7`
around 13pt text ≈ **30pt** tall), `components/filters/ActiveFilterChips.tsx:380`
(`paddingVertical: 5` around 12pt text ≈ **26pt** tall).

**Severity:** nitpick (Apple HIG and Android both specify ≥44pt / 48dp).

The chip's tap action is destructive-ish (it removes a filter), so a 26pt target
is the worst offender. The rows' own `paddingVertical: 10` provides the visual
breathing room but was not claimed for touch.

**Fixed.** `hitSlop` of 8pt vertical on `FilterPills` pills and 10pt vertical /
4pt horizontal on the active-filter chips, bringing both to ≥46pt without
changing a single pixel of layout.

### 12. `add-friend` uses `SafeAreaView` where every other screen uses `TopSafeAreaView`

**Where:** `app/add-friend/[receiverId].tsx:3` and `:80`.

**Severity:** nitpick.

`components/layout/TopSafeAreaView.tsx` exists specifically because the
`SafeAreaView` *component* applies its inset from a native layout pass that
lands a frame late, so the first painted frame sits too high and then drops —
documented in that file's header comment. Every tab screen and
`ShowtimesScreen` use it; this one deep-link landing screen did not, so it
flashes on mount.

**Fixed.** Swapped to `TopSafeAreaView`. (This screen only used `edges={["top"]}`,
so the components are equivalent apart from the flash.)

### 13. Movie page back button is a 38pt touch target

**Where:** `app/movie/[id].tsx:95-104` — a 22pt icon with `hitSlop={8}` and
`alignSelf: "flex-start"`, giving 38 × 38pt. `TopBar`'s equivalent button gets
56pt of height from its absolute `top: 0 / bottom: 0`, so the two back buttons in
the app have materially different hit areas.

**Severity:** nitpick.

**Fixed.** `hitSlop={12}` → 46 × 46pt.

### 14. Showtimes list has no bottom padding, movie feeds do

**Where:** `components/showtimes/ShowtimesScreen.tsx:294-297`
(`listContent: { paddingTop: 12, paddingHorizontal: 16 }`) versus
`app/(tabs)/index.tsx:396`, `app/(tabs)/movies.tsx:298`,
`app/cinema-showtimes/[id].tsx:441` (`movieFeed: { padding: 16 }`).

**Severity:** nitpick.

The list footer masked this most of the time, but back then it only rendered
when `!hasNextPage && showtimes.length > 0` — so a short filtered result set
butted straight against the tab bar while the same screen in group-by-movie
mode had 16pt of air. (`LoadMoreFooter` now always reserves its row, so it
also serves as the end spacer.)

**Fixed.** Added `paddingBottom: 16` to `listContent`. The remaining 12-vs-16
top-padding difference is left alone: it is small, deliberate-looking, and
changing it is pure churn.

---

## Recommendations (not fixed)

### 15. Cinema pill starves the movie title on narrow cards

**Where:** `components/badges/CinemaPill.tsx:127` (`maxWidth: "65%"`) inside
`components/showtimes/ShowtimeCard.tsx:150-166` (`titleRow`: `titleColumn`
`flex: 1` next to the pill).

**Severity:** looks unprofessional on N320/A360.

The card spends 74pt on the date column and 72pt on the poster before the info
column gets anything. On N320 the card is 288pt wide, so `info` has 288 − 146 −
2 (borders) − 20 (padding) = **120pt** for the title *and* the pill. Because
`titleColumn` is `flex: 1` (i.e. `flexBasis: 0`) and the pill is intrinsically
sized up to 65%, a 15-character cinema name (~68pt at 9pt type) leaves the title
**~46pt** — about six characters per line before the ellipsis. On SE it is ~101pt,
which is workable but tight.

**Why not fixed:** deciding which of the two truncates first is a product call.
Three defensible options, in my order of preference:

1. Give `titleColumn` a `minWidth` (say 45%) and `flexShrink: 1` to the pill, so the cinema name ellipsizes before the film title does. Titles are the primary scanning key; I would do this.
2. Lower the compact variant's `maxWidth` to ~45% (the "65%" is shared with the default variant, which sits in roomier contexts, so this needs to be variant-scoped).
3. Move the pill below the title on narrow widths — a layout change, and the card's fixed 112pt height has no room for it.

### 16. Everything stretches to full width on a tablet

**Where:** app-wide; most visible in `ShowtimeCard`, `MovieCard`,
`ShowtimesScreen`'s `listContent`, `FiltersModal`'s `scrollContent`, and the
`AppBottomSheet` sheets.

**Severity:** looks unprofessional on TAB. `app.json` sets
`ios.supportsTablet: true`, so this ships today.

On a 768pt iPad a showtime card is ~736pt wide with a 74pt date column, a 72pt
poster and ~570pt of near-empty info area holding a 15pt title. The
`FiltersModal` preset grid (`flexBasis: "47%"` at
`components/filters/FiltersModal.tsx:699`) becomes two 360pt-wide cards.
Line lengths in the settings and movie-detail screens run far past comfortable
reading measure.

**Partially fixed (2026-08-18).** The cheap version — `constants/tablet-layout.ts`'s
`tabletCappedContentStyle` (`maxWidth: 640` + `alignSelf: "center"`) — is now
applied to the four main-feed list containers: the showtimes tab, the movies
feed, the second movies feed on the main showtimes screen, and the friends
list. That is what a reviewer sees first and what the App Store 5.1.1(v)
rejection was actually reviewed on (an iPad Air 11").

Deliberately not applied to `FiltersModal`'s `scrollContent` or the
`AppBottomSheet` sheets: both have a pinned header/footer that spans the sheet's
full width, and centering only the scrollable middle at 640 while the footer
buttons stay edge-to-edge would look like two mismatched widths rather than one
deliberate layout — worse than the current stretch, and not verifiable without
a device. Left as the still-open part of this finding, along with the good
version (a two-column master/detail layout for the showtimes list).

### 17. Movie detail header eats a third of an SE screen

**Where:** `app/movie/[id].tsx:396-446`, poster `width: 110, height: 165` at
`:714-719`.

**Severity:** looks unprofessional on SE/N320/A360.

`summaryInfo` can render a 3-line title (22pt), a 2-line original title, 2 lines
of directors, 2 lines of cast and a metadata line — ≈195pt, taller than the
165pt poster, so the header grows to fit. Add the 48pt `compactHeader`, the
~46pt filter row, two dividers and the top inset, and on a 667pt SE roughly
**330pt** — half the screen — is gone before the first showtime.

**Why not fixed:** the remedies (collapse the header on scroll, drop cast on
short screens, shrink the poster below some width) are all product/interaction
decisions, and the header is currently static by design ("stays fixed while
showtimes scroll", per the code comment).

### 18. Card heights are fixed in points and ignore font scale generally

**Where:** `components/showtimes/ShowtimeCard.tsx:27` (`POSTER_HEIGHT = 112`),
`components/movies/MovieCard.tsx:28` (`POSTER_HEIGHT = 150`),
`components/showtimes/ShowtimesScreen.tsx:315` (matching 112pt skeleton).

**Severity:** looks unprofessional at raised text sizes.

Finding 7 patches the single worst clipping case. The broader issue remains:
`MovieCard` packs a title, an original title, up to five `ShowtimeRow`s and a
"+N more" line into 150 fixed points, all of which scale with the OS text
setting while the box does not. At 1.3× the showtime rows are the first thing to
be silently cut off by `overflow: "hidden"`.

**Why not fixed:** making these cards intrinsically sized means the poster can no
longer be `height: "100%"`, which changes the visual language of every list in
the app, and `getCompactBadgeRowsForHeight`'s measurement logic is built around
a known height. That is a redesign, not a patch. If you want a cheap middle
ground, apply `maxFontSizeMultiplier` consistently across both cards the way
finding 7 does for the date column.

### 19. Friend badges are 14pt tall touch targets

**Where:** `components/badges/FriendBadges.tsx:435-440` (`compactBadge`
`minHeight: 14`), with `hitSlop` of 4 → ~22pt. Each badge navigates to that
friend's agenda.

**Severity:** nitpick.

**Why not fixed:** these are deliberately dense secondary affordances inside an
already-tappable card, four rows of them fit in the card's badge area, and
enlarging the hit area would make adjacent badges overlap — the wrapping/row
measurement in `FriendBadges` is genuinely careful work and I do not want to
disturb it for a target that has a working fallback (tap the card, use the
sheet). Worth revisiting only if analytics show mis-taps.

### 20. Four near-identical "Filters pill" implementations have drifted

**Where:** `components/filters/FiltersRow.tsx:75-90`,
`components/filters/FiltersButtonRow.tsx:52-68` (since deleted — the sub-pages
now mount `FiltersButton` in the search row),
`components/filters/FilterPills.tsx:271-278`, `app/movie/[id].tsx:687-700`.

**Severity:** nitpick (consistency).

All four render a 13pt/500 label in a `borderRadius: 18` pill on
`colors.pillBackground`, and three of the four use `paddingHorizontal: 14,
paddingVertical: 7`. `FiltersModal`'s own `Pill` (`:657`) uses 12/6 and radius
16, and its `styles.pill` (`:684`) uses 13/7 and radius 18 — two different pill
sizes inside one sheet. The containing rows also disagree: `FiltersRow` uses
`marginLeft: 16` on the pill, `FiltersButtonRow` uses `paddingHorizontal: 16` on
the row, `movie/[id]` uses `paddingLeft: 16` with no right padding.

**Why not fixed:** extracting a shared `FilterPill` component touches five files
and changes pixel values in the two that have drifted. That is a cleanup task
with a visual diff, not a responsive fix, and it belongs on the `CLEANUP.md`
track rather than in an audit pass.

### 21. Auth screens' type scale doesn't match the rest of the app

**Where:** `app/login.tsx`, `app/signup.tsx`, `app/recover-password.tsx` — 32pt
titles, 16pt inputs with `padding: 15`, `borderRadius: 8`, versus
`app/(tabs)/settings.tsx:1085-1093` (14pt inputs, `paddingVertical: 10`,
`borderRadius: 8`) and the app's general 12-16pt body scale. The auth screens
also use raw `Text` rather than `ThemedText`, so they skip the iOS 0.94 font
correction in `components/themed-text.tsx:20`.

**Severity:** nitpick.

**Why not fixed:** an intentionally larger, airier login screen is a perfectly
normal choice, and I have no way to tell whether the divergence is deliberate.
Flagging so you can decide. If it is *not* deliberate, switching them to
`ThemedText` is the first step, since right now iOS renders auth text ~6% larger
relative to every other screen.

### 22. `app/modal.tsx` is a leftover Expo template route

**Where:** `app/modal.tsx` — renders "This is a modal" and a link home.

**Severity:** nitpick, and not really a responsive issue.

Not referenced by any navigation in the app. Noted because an audit that reads
every screen should say when one of them is dead. Deleting it is a `CLEANUP.md`
item (and would need the `CLEANUP.md` update this project's rules require), not
an audit fix.

---

## Things I checked that are fine

Recorded so a future pass doesn't re-derive them:

- **`FriendBadges` wrapping** (`components/badges/FriendBadges.tsx:244-302`) — measures each badge and the container, then counts rows to decide how many fit. Degrades correctly at every width in the matrix; the `+N` overflow badge is included in the fit calculation.
- **Quick-popover vertical placement** — all four clamp `cardTop` between `minTop` and `screenHeight − estimatedCardHeight − CARD_BOTTOM_MARGIN`, so they stay on-screen on a 640dp-tall device. (`estimatedCardHeight` is a constant and would under-estimate at large font scale, but the failure mode is a slightly low card, not an off-screen one.)
- **Day picker weekday shortcuts** (`DayFilterModal.tsx:427-429`) — `flexWrap: "nowrap"` looks alarming, but `weekdayShortcutChip` has `flex: 1, minWidth: 0`, so the seven chips share the width evenly (~34pt each at N320) instead of overflowing.
- **Friends QR code** (`app/(tabs)/friends.tsx:234`) — `size={210}` plus 24 + 2 + 24 + 2 + 32pt of nesting = 294pt, which clears N320's 320pt.
- **`FiltersModal` preset grid** (`:699`) — `flexBasis: "47%"` + `gap: 8` yields exactly two columns from N320 through PM.
- **Bottom-sheet safe areas** — `FiltersModal`, `CinemaFilterModal`, `NotificationCenterSheet`, `SavePresetDialog` and `ShowtimeActionModal` all add `bottomInset` to their scroll content. Only `DayFilterModal` (finding 4) was missing it.
- **`ShowtimeActionModal` title/close overlap** — `movieTitle` carries `paddingRight: 36` to clear the absolutely positioned close button, which is exactly the pattern `TopBar` was missing.
- **Root safe-area setup** (`app/_layout.tsx:526`) — `SafeAreaProvider` with `initialWindowMetrics`, so insets are correct on the first frame. Good.

---

## Method & limitations

- Primary method: reading `StyleSheet` definitions and JSX structure, and
  computing the resulting box widths/heights at each device width in the matrix.
- No headless browser was available in the run environment, and the brief
  forbids installing one, so the `react-native-web` export in `mobile/dist` was
  **not** rendered for corroboration. Every width/height figure above is derived
  arithmetically from the style definitions; text widths are estimated from
  font size (≈0.52 em per character for mixed-case Latin at the weights used),
  so numbers within ~10% of a boundary should be treated as "borderline" rather
  than proven. The findings marked *breaks layout* all clear that margin
  comfortably except where the text says otherwise.
- Font-scaling analysis assumes the RN default (`allowFontScaling` on, no
  `maxFontSizeMultiplier`). iOS Dynamic Type reaches ~1.35× at the top of the
  normal range and ~3.1× with accessibility sizes; Android's slider reaches 1.3×
  normally and 2.0× with accessibility sizes.
- Landscape was not audited: `app.json` pins `"orientation": "portrait"`. Note
  that this is ignored on iPad when `supportsTablet` is true, which is another
  reason finding 16 matters more than its position in the priority order
  suggests.
- Per the run's standing rules, no linter, type-checker or test suite was run
  against these edits. They are small and local, but they are unverified by
  tooling.
