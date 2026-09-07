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
  },
  theme: {
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
