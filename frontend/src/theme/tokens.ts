/**
 * The app's palette, turned into Chakra semantic tokens.
 *
 * Built from `shared/theme/colors.ts` at load rather than copied, so the
 * website cannot drift from the app on a colour — the two clients now render
 * the same green from the same file. Every token carries both modes, so a
 * component that uses one is dark-aware without knowing it.
 *
 * Two layers come out of this:
 *
 *   - Chakra's own semantic tokens (`bg`, `fg`, `border`, …) are overridden so
 *     that every stock Chakra component follows the app's palette in both
 *     modes. This is what makes dark mode work without repainting each screen:
 *     Chakra's defaults are a cold neutral gray, and the app's neutrals sit on
 *     the brand's green hue at low saturation.
 *   - `app.*` for everything else the palette carries — the accent trios, the
 *     seat colours, the pill and checkbox surfaces — for components that want a
 *     specific one.
 */
import { Colors } from "shared/theme/colors"

type ColorScale = { primary: string; secondary: string; border: string }

/** Groups in the palette that are a trio rather than a single value. */
const SCALE_KEYS = [
  "pink",
  "purple",
  "green",
  "orange",
  "yellow",
  "blue",
  "teal",
  "red",
  "redHot",
  "redDeep",
  "gray",
  "cyan",
  "friendGoing",
  "friendInterested",
] as const

type ScaleKey = (typeof SCALE_KEYS)[number]

type TokenValue = { value: { base: string; _dark: string } }

const both = (light: string, dark: string): TokenValue => ({
  value: { base: light, _dark: dark },
})

/**
 * Every palette entry as `app.<name>`, with the trios flattened to
 * `app.<name>.<primary|secondary|border>`.
 */
const buildAppTokens = (): Record<string, TokenValue> => {
  const tokens: Record<string, TokenValue> = {}
  const light = Colors.light as Record<string, unknown>
  const dark = Colors.dark as Record<string, unknown>

  for (const key of Object.keys(light)) {
    const lightValue = light[key]
    const darkValue = dark[key]

    if (typeof lightValue === "string" && typeof darkValue === "string") {
      tokens[key] = both(lightValue, darkValue)
      continue
    }

    if (SCALE_KEYS.includes(key as ScaleKey)) {
      const lightScale = lightValue as ColorScale
      const darkScale = darkValue as ColorScale
      for (const step of ["primary", "secondary", "border"] as const) {
        tokens[`${key}.${step}`] = both(lightScale[step], darkScale[step])
      }
    }
  }

  return tokens
}

export const semanticColorTokens = {
  // Chakra's own surface/ink/border tokens, repointed at the app's palette so
  // stock components inherit dark mode rather than each screen handling it.
  bg: {
    DEFAULT: both(Colors.light.background, Colors.dark.background),
    subtle: both(Colors.light.surfaceMuted, Colors.dark.surfaceMuted),
    muted: both(
      Colors.light.nestedModalBackground,
      Colors.dark.nestedModalBackground,
    ),
    panel: both(Colors.light.cardBackground, Colors.dark.cardBackground),
  },
  fg: {
    DEFAULT: both(Colors.light.text, Colors.dark.text),
    muted: both(Colors.light.textSecondary, Colors.dark.textSecondary),
    subtle: both(Colors.light.icon, Colors.dark.icon),
  },
  border: {
    DEFAULT: both(Colors.light.cardBorder, Colors.dark.cardBorder),
    muted: both(Colors.light.divider, Colors.dark.divider),
  },
  app: buildAppTokens(),
}
