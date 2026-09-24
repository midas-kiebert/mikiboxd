/**
 * Theme configuration for Chakra UI styling in the web app.
 *
 * The palette itself is not defined here: `theme/tokens.ts` derives it from
 * `shared/theme/colors.ts`, the same file the app reads, so a colour cannot
 * drift between the two clients.
 */
import { createSystem, defaultConfig } from "@chakra-ui/react"
import { buttonRecipe } from "./theme/button.recipe"
import { semanticColorTokens } from "./theme/tokens"

export const system = createSystem(defaultConfig, {
  globalCss: {
    html: {
      fontSize: "16px",
    },
    body: {
      fontSize: "0.875rem",
      margin: 0,
      padding: 0,
      // Explicit, and from a token: the page's own ground has to follow the
      // colour mode or a dark theme paints dark text on a white body.
      bg: "bg",
      color: "fg",
    },
    ".main-link": {
      color: "ui.main",
      fontWeight: "bold",
    },
    /**
     * The showtime panel's seat map, hovered.
     *
     * Global rather than a `_hover` on each seat, because a room is a few
     * hundred of them and that prop is per-element work in the style engine
     * for a rule that is identical every time. The browser does this for free.
     */
    ".seat-tile": {
      transition: "opacity 120ms ease",
    },
    ".seat-tile--clickable:hover": {
      opacity: 0.65,
    },
    /**
     * A feed row arriving (`components/Feed/use-feed-entrance.ts`): fades and
     * lifts into place like the app's rows. Fill `backwards`, not `both`: a
     * transform left on the cell after it lands would make it the containing
     * block for anything fixed inside the card.
     */
    ".mk-feed-item": {
      animation:
        "feed-item-in 240ms cubic-bezier(0.25, 0.46, 0.45, 0.94) backwards",
      _motionReduce: { animation: "none" },
    },
  },
  theme: {
    /**
     * The motions the site defines for itself.
     *
     * `panel-enter`: the showtime panel is docked beside a list of
     * near-identical rows, so changing which one it shows has to be *seen*:
     * without it the card swaps its contents silently and reads as though the
     * click did nothing. Short and small on purpose — this is a cut, not a
     * transition.
     *
     * `rail-chip-in`: a filter chip arriving in a folded rail section grows in
     * rather than appearing, the way the app's chips do, so a filter switched
     * on is noticed where it lands.
     *
     * `sheet-in` / `sheet-out`: the cinema sheet slides out from behind the
     * filter rail's edge and back under it on close, from the offset in
     * `--mk-sheet-from` (by default its own width plus its shadow's reach, so
     * not even the shadow shows before it moves). `scrim-in` / `scrim-out`
     * fade the dim behind it in step.
     *
     * `feed-item-in`: a feed row arriving — see `.mk-feed-item` above.
     */
    keyframes: {
      "panel-enter": {
        from: { opacity: 0, transform: "translateY(6px)" },
        to: { opacity: 1, transform: "translateY(0)" },
      },
      "rail-chip-in": {
        from: { opacity: 0, transform: "scale(0.85)" },
        to: { opacity: 1, transform: "scale(1)" },
      },
      "feed-item-in": {
        from: { opacity: 0, transform: "translateY(10px)" },
        to: { opacity: 1, transform: "translateY(0)" },
      },
      "sheet-in": {
        from: {
          transform: "translateX(var(--mk-sheet-from, calc(-100% - 64px)))",
        },
        to: { transform: "translateX(0)" },
      },
      "sheet-out": {
        from: { transform: "translateX(0)" },
        to: {
          transform: "translateX(var(--mk-sheet-from, calc(-100% - 64px)))",
        },
      },
      "scrim-in": {
        from: { opacity: 0 },
        to: { opacity: 1 },
      },
      "scrim-out": {
        from: { opacity: 1 },
        to: { opacity: 0 },
      },
    },
    tokens: {
      colors: {
        ui: {
          main: { value: "#009688" },
        },
      },
    },
    semanticTokens: {
      colors: semanticColorTokens,
    },
    recipes: {
      button: buttonRecipe,
    },
  },
})
