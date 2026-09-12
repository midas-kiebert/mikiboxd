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
  },
  theme: {
    /**
     * The one motion the site defines for itself.
     *
     * The showtime panel is docked beside a list of near-identical rows, so
     * changing which one it shows has to be *seen*: without it the card swaps
     * its contents silently and reads as though the click did nothing. Short
     * and small on purpose — this is a cut, not a transition.
     */
    keyframes: {
      "panel-enter": {
        from: { opacity: 0, transform: "translateY(6px)" },
        to: { opacity: 1, transform: "translateY(0)" },
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
