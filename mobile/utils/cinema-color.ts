/**
 * Resolves a cinema's badge color into the theme palette.
 *
 * Every place that shows a cinema's accent color (the CinemaPill badge, the
 * cinema-showtimes header) resolves it here, so the same cinema always reads
 * the same color wherever it shows up.
 */
import type { CinemaPublic } from "shared";

type ThemeColors = typeof import("@/constants/theme").Colors.light;
type CinemaColorPalette = { primary: string; secondary: string; border: string };

type CinemaColorKey =
  | "pink"
  | "purple"
  | "green"
  | "orange"
  | "yellow"
  | "blue"
  | "teal"
  | "red"
  | "cyan";

const CINEMA_PALETTE_KEYS: readonly CinemaColorKey[] = [
  "pink",
  "purple",
  "green",
  "orange",
  "yellow",
  "blue",
  "teal",
  "red",
  "cyan",
];

/** `primary` is the badge fill, `secondary` the text/border on top of it. */
export const getCinemaColorPalette = (
  cinema: Pick<CinemaPublic, "name" | "badge_bg_color">,
  colors: ThemeColors
): CinemaColorPalette => {
  const paletteByKey: Record<CinemaColorKey, CinemaColorPalette> = {
    pink: colors.pink,
    purple: colors.purple,
    green: colors.green,
    orange: colors.orange,
    yellow: colors.yellow,
    blue: colors.blue,
    teal: colors.teal,
    red: colors.red,
    cyan: colors.cyan,
  };
  const cinemaColorKey = cinema.badge_bg_color as CinemaColorKey;
  const fallbackPalette =
    paletteByKey[
      CINEMA_PALETTE_KEYS[
        Math.abs(
          cinema.name.split("").reduce((hash, char) => hash * 31 + char.charCodeAt(0), 0)
        ) % CINEMA_PALETTE_KEYS.length
      ]
    ];
  return paletteByKey[cinemaColorKey] ?? fallbackPalette;
};
