/**
 * Measures a view for use inside `SpotlightOverlay`.
 *
 * The target (Filters pill, showtime-sheet buttons) lives in the app's main
 * window; the overlay that draws the highlight around it lives in a separate,
 * `statusBarTranslucent` `Modal` (see `IntroFiltersSpotlight` / `IntroFlow`).
 * Both now start at the true top of the screen on both platforms, so a plain
 * `measureInWindow` lines up.
 *
 * This used to add the status bar's height on Android, from when the main
 * window started below it (SDK 54, edge-to-edge optional). Edge-to-edge is
 * mandatory since SDK 55, so that correction put every Android highlight a
 * status bar's height too low. Kept as the one place both spotlights measure,
 * so a window difference that comes back has one place to be corrected.
 */
import type { View } from "react-native";

export type MeasuredRect = { x: number; y: number; width: number; height: number };

export function measureForSpotlight(
  ref: View | null | undefined,
  callback: (rect: MeasuredRect) => void
) {
  ref?.measureInWindow((x, y, width, height) => {
    callback({ x, y, width, height });
  });
}
