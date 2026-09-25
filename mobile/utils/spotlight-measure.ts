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

/**
 * Measures a view inside a gorhom bottom sheet, from the sheet's live position.
 *
 * `measureInWindow` cannot be trusted there on Android. gorhom moves the sheet
 * with a Reanimated `translateY`, and Reanimated applies it on the UI thread
 * without writing it back to the Fabric shadow tree that Android's measure
 * reads — so the sheet's offset comes back as whatever it was at the last
 * React commit, part-way through the rise. That put the tour's highlight
 * roughly half a button above the button (and, with a status-bar correction
 * on top, below it).
 *
 * Both views sit under the same stale transform, so the difference between
 * them is exact; `sheetTop` (gorhom's `animatedPosition`) supplies the real one.
 * `sheetTopRef` must be a zero-size view at the very top of the sheet's content.
 */
export function measureInSheetForSpotlight(
  ref: View | null | undefined,
  sheetTopRef: View | null | undefined,
  sheetTop: number,
  callback: (rect: MeasuredRect) => void
) {
  if (!ref || !sheetTopRef) return;
  sheetTopRef.measureInWindow((_topX, topY) => {
    ref.measureInWindow((x, y, width, height) => {
      callback({ x, y: sheetTop + (y - topY), width, height });
    });
  });
}
