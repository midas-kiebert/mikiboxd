/**
 * Measures a view for use inside `SpotlightOverlay`, correcting for a
 * window mismatch that only shows up on Android.
 *
 * The target (Filters pill, showtime-sheet buttons) lives in the app's main
 * content window. The overlay that draws the highlight around it lives in a
 * separate, full-bleed `Modal` (see `IntroFiltersSpotlight` / `IntroFlow`).
 * On iOS both windows share one coordinate space, so a plain
 * `measureInWindow` lines up. On Android, with `edgeToEdgeEnabled`, the main
 * content window's origin sits below the status bar while the transparent
 * `Modal`'s origin is the true top of the screen — so a `y` measured in the
 * former lands too high when drawn in the latter, by exactly the status bar's
 * height. Adding that height back in on Android only puts the highlight over
 * the real control on both platforms.
 */
import { Platform, StatusBar, type View } from "react-native";

export type MeasuredRect = { x: number; y: number; width: number; height: number };

const ANDROID_STATUS_BAR_OFFSET = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export function measureForSpotlight(
  ref: View | null | undefined,
  callback: (rect: MeasuredRect) => void
) {
  ref?.measureInWindow((x, y, width, height) => {
    callback({ x, y: y + ANDROID_STATUS_BAR_OFFSET, width, height });
  });
}
