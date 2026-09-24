/**
 * Resolves a cinema's badge color into the theme palette.
 *
 * Every place that shows a cinema's accent color (the CinemaPill badge, the
 * cinema-showtimes header) resolves it here, so the same cinema always reads
 * the same color wherever it shows up.
 *
 * Which palette entry a cinema *is* comes from `shared/cinemas/cinema-color`,
 * which the website reads too — including the name-hash fallback for a venue
 * with no key configured, so an unconfigured cinema is not a different colour
 * on each client. This wrapper does the part that is the app's alone: turning
 * the key into theme colors.
 */
import type { CinemaPublic } from "shared";
import { getCinemaPaletteKey } from "shared/cinemas/cinema-color";

type ThemeColors = typeof import("@/constants/theme").Colors.light;
type CinemaColorPalette = { primary: string; secondary: string; border: string };

/** `primary` is the badge fill, `secondary` the text/border on top of it. */
export const getCinemaColorPalette = (
  cinema: Pick<CinemaPublic, "name" | "badge_bg_color">,
  colors: ThemeColors
): CinemaColorPalette => colors[getCinemaPaletteKey(cinema)];
