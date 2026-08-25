/**
 * Single source of truth for the MiKiNO color palette, shared by the mobile app
 * (consumed via `mobile/constants/theme.ts` → `useThemeColors()`) and the website
 * (turned into Chakra semantic tokens in `frontend/src/theme/tokens.ts`). Keep this
 * file pure data — no React Native / browser imports — so both platforms can load it.
 */

/**
 * Both modes share hue 149, so the brand green reads as the same green in light
 * and dark. Light mode is the darkest green that still keeps 4.5:1 against white,
 * which is what lets it double as a fill under white text and as an icon/link color.
 */
export const tintColorLight = '#0b8345';
export const tintColorDark = '#39b467';

// App-wide color tokens consumed by themed UI helpers/components.
export const Colors = {
  // The light neutrals are not gray: they all sit on the brand's green hue at very
  // low saturation, so surfaces, borders and muted text belong to the same family as
  // the tint instead of fighting it with a cold blue-gray.
  //
  // Each accent is a trio rather than a pair:
  //   primary   — the soft fill
  //   secondary — the label/icon on it; clears 4.9:1 on `primary` and 5.5:1 on white
  //   border    — a mid-tone outline for that fill. Deliberately far lighter than
  //               `secondary`, because using the label tone as a border made tinted
  //               cards read as heavy in light mode. Not for text, ever.
  light: {
    text: '#12211c',
    background: '#f4f8f6',
    nestedModalBackground: '#e9efec',
    tint: tintColorLight,
    icon: '#607b6f',
    tabIconDefault: '#607b6f',
    tabIconSelected: tintColorLight,
    cardBackground: '#ffffff',
    cardBorder: '#dce5e1',
    textSecondary: '#5a7268',
    searchBackground: '#ffffff',
    // Controls are outlined rather than filled in light mode: on a 96.5%-lightness
    // background any fill light enough not to read as gray is too close to the
    // background to see, so pills go white and are defined by `pillBorder` instead.
    pillBackground: '#ffffff',
    pillBorder: '#dce5e1',
    pillText: '#4f695e',
    pillActiveBackground: tintColorLight,
    pillActiveText: '#ffffff',
    // The recessed fill for things a hairline can't define: segmented-control
    // tracks, icon tiles, count bubbles, micro-badges and gradient stops.
    surfaceMuted: '#e6edea',
    // Two deliberately unremarkable, solid grays for the seat floor plan's
    // free/taken fills — plain neutral gray (no green undertone) rather than
    // reusing the app's tinted neutrals, since a hint of the brand green read
    // as muddy/dark once every seat in a room was filled with it. Distinct
    // enough in lightness from each other, and from the light background, to
    // read clearly at a glance. Neither should look like the more important
    // pick, since both are equally selectable.
    seatFree: '#cfcfcf',
    seatTaken: '#8c8c8c',
    // The seat floor plan's "friend"/"you" fills — the accent trios' own
    // `primary`/`border` tones read as too pale/washed-out as a solid seat
    // swatch (they're tuned for pill fills with a label on top, not a
    // standalone block of color), so these are their own, more saturated
    // shades instead.
    seatFriend: '#3f68c9',
    seatYou: tintColorLight,
    notificationBadge: '#c52b30',
    divider: '#e3eae7',
    posterPlaceholder: '#dae2de',
    skeletonShine: 'rgba(255, 255, 255, 0.6)',
    pink: {
      primary: '#f7dee6',
      secondary: '#b22a50',
      border: '#db7693',
    },
    purple: {
      primary: '#ebe1fa',
      secondary: '#763ecc',
      border: '#a480db',
    },
    green: {
      primary: '#daf1e5',
      secondary: '#137242',
      border: '#6ecf9e',
    },
    orange: {
      primary: '#fbe4d0',
      secondary: '#9f4b14',
      border: '#e2955a',
    },
    yellow: {
      primary: '#fcedc0',
      secondary: '#8b5b09',
      border: '#deab35',
    },
    blue: {
      primary: '#dee7fc',
      secondary: '#2759ce',
      border: '#7493dc',
    },
    teal: {
      primary: '#d9f2ed',
      secondary: '#0e7164',
      border: '#64c4b7',
    },
    red: {
      primary: '#fbdfe0',
      secondary: '#b62b2f',
      border: '#dc6a6e',
    },
    // "Last few seats", and nothing else: a hotter, more saturated red than the
    // error `red`, so the urgent end of the busyness scale reads as urgent
    // without borrowing the tone every form error already uses.
    redHot: {
      primary: '#fddbdc',
      secondary: '#c81e24',
      border: '#e56167',
    },
    // Sold out, and nothing else: the one step past `redHot`, darkened along the
    // same hue so the two read as one scale rather than two colours.
    redDeep: {
      primary: '#f3cdcf',
      secondary: '#7a1417',
      border: '#b8595c',
    },
    gray: {
      primary: '#e2e9e6',
      secondary: '#4c675b',
      border: '#a2b9af',
    },
    cyan: {
      primary: '#d2f0f9',
      secondary: '#0b6b8e',
      border: '#47acd1',
    },
    friendGoing: {
      primary: '#dbf5eb',
      secondary: '#0f764e',
      border: '#66cca5',
    },
    friendInterested: {
      primary: '#fde9d3',
      secondary: '#9c4d11',
      border: '#e49758',
    },
  },
  // Dark mode is deliberately untouched by the light-mode rework. The tokens the
  // light theme grew — `pillBorder`, `surfaceMuted`, and each accent's `border` —
  // are mirrored here at values that render identically to before: the pill border
  // matches the pill fill, and every accent border is that accent's existing
  // `secondary`. Dark pills are legible as fills, so they don't need an outline.
  dark: {
    text: '#ECEDEE',
    background: '#151718',
    nestedModalBackground: '#1e2123',
    tint: tintColorDark,
    icon: '#9BA1A6',
    tabIconDefault: '#9BA1A6',
    tabIconSelected: tintColorDark,
    cardBackground: '#1c1c1c',
    cardBorder: '#3a3a3a',
    textSecondary: '#9BA1A6',
    searchBackground: '#2a2a2a',
    pillBackground: '#2a2a2a',
    pillBorder: '#2a2a2a',
    pillText: '#9BA1A6',
    pillActiveBackground: tintColorDark,
    pillActiveText: '#151718',
    surfaceMuted: '#2a2a2a',
    // See the light theme's `seatFree`/`seatTaken`/`seatFriend`/`seatYou` for
    // what these are for.
    seatFree: '#6a6e70',
    seatTaken: '#35373a',
    seatFriend: '#5b82d9',
    seatYou: tintColorDark,
    notificationBadge: '#d63a3a',
    divider: '#3a3a3a',
    posterPlaceholder: '#3a3a3a',
    skeletonShine: 'rgba(255, 255, 255, 0.08)',
    pink: {
      primary: '#5a1e33',
      secondary: '#f6b7cf',
      border: '#f6b7cf',
    },
    purple: {
      primary: '#3f2a6b',
      secondary: '#d8ccff',
      border: '#d8ccff',
    },
    green: {
      primary: '#1f4d34',
      secondary: '#bfe5c7',
      border: '#bfe5c7',
    },
    orange: {
      primary: '#6b3a12',
      secondary: '#ffd1a6',
      border: '#ffd1a6',
    },
    yellow: {
      primary: '#6b5a12',
      secondary: '#ffeaa1',
      border: '#ffeaa1',
    },
    blue: {
      primary: '#1b2f63',
      secondary: '#c8d8ff',
      border: '#c8d8ff',
    },
    teal: {
      primary: '#143e34',
      secondary: '#a9e8c8',
      border: '#a9e8c8',
    },
    red: {
      primary: '#5a1c1c',
      secondary: '#ffb8b8',
      border: '#ffb8b8',
    },
    // The dark-mode twin of `redHot`: on a dark ground urgency reads as more
    // saturation, not more darkness, so it sits between `red` and `redDeep`.
    redHot: {
      primary: '#631c1c',
      secondary: '#ff9a9c',
      border: '#ff9a9c',
    },
    // "Deeper" inverts on a dark ground: a darker red would sink into it, so
    // the step past `redHot` is the more saturated one instead.
    redDeep: {
      primary: '#6d1a1a',
      secondary: '#ff7378',
      border: '#ff7378',
    },
    gray: {
      primary: '#3f4143',
      secondary: '#d7d9db',
      border: '#d7d9db',
    },
    cyan: {
      primary: '#0f3f51',
      secondary: '#9fe8ff',
      border: '#9fe8ff',
    },
    friendGoing: {
      primary: '#173b2b',
      secondary: '#7fddb6',
      border: '#7fddb6',
    },
    friendInterested: {
      primary: '#4e3015',
      secondary: '#ffc590',
      border: '#ffc590',
    },
  },
};
