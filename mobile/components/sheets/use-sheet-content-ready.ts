/**
 * Holds a sheet's body back until the sheet has finished rising.
 *
 * gorhom builds a sheet's children before it starts to move, so a body mounted
 * on open is paid for *inside* the tap-to-motion gap: a big one (the showtime
 * sheet is 3400 lines; the cinema picker is ~80 chips, several hundred native
 * views) can take longer to build than the whole open should take, and the tap
 * looks ignored. Deferring it means the sheet rises on
 * {@link ./SheetLoadingPanel} at the same speed every time, whatever it is
 * about to hold.
 *
 * **Nothing may be added between the tap and the rise.** That is the whole
 * point, and it has been re-learned the expensive way — see the wrong turns in
 * {@link ./AppBottomSheet}, the last of which built the body first and rose
 * second and took tap→rise from 98ms to 320ms.
 *
 * **It resets on close, and that is load-bearing** — not tidy-up. The body
 * renders from whatever the sheet was last given, and @gorhom/portal commits
 * sheet content a render late, so a body kept across opens is the *previous*
 * showtime on screen for a frame or two before the new one replaces it.
 * Tearing it down is what guarantees the next open starts from the panel and
 * never from stale content.
 *
 * A timer and not `InteractionManager`: gorhom animates under Reanimated, which
 * registers no interaction handle, so `runAfterInteractions` resolves straight
 * away and defers nothing (learned the hard way on the seat-plan sheet).
 */
import { useCallback, useEffect, useState } from "react";

import { SHEET_CONTENT_MOUNT_DELAY_MS } from "@/components/sheets/sheet-timing";

export function useSheetContentReady(visible: boolean): boolean {
  const [isContentReady, setIsContentReady] = useState(false);

  useEffect(() => {
    if (!visible) {
      setIsContentReady(false);
      return;
    }
    const timer = setTimeout(() => setIsContentReady(true), SHEET_CONTENT_MOUNT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  return isContentReady;
}


/**
 * How long to wait for the panel to report itself laid out before rising
 * without it. A few frames: long enough to cover the portal's extra commit on
 * a slow one, short enough that a panel which never reports makes the sheet
 * late rather than stuck.
 */
const PANEL_LAYOUT_TIMEOUT_MS = 64;

/**
 * Whether the loading panel is actually on screen yet, so the sheet does not
 * start to rise ahead of it.
 *
 * @gorhom/bottom-sheet renders a sheet's children through @gorhom/portal, and
 * the portal commits them **a render late** — the same lateness that makes
 * kept content show stale for a frame. So a panel rendered in the commit that
 * calls `present()` is not on screen when the rise begins, and the sheet comes
 * up empty for a frame or two before its own loading state catches up. Which
 * is worse than the wait it exists to cover.
 *
 * The panel's own `onLayout` is the signal, rather than a count of frames: it
 * fires when the views exist and have been measured, which is the thing being
 * waited for, and it is as fast as the device happens to be instead of as slow
 * as the worst device guessed at. This is the *one* thing allowed between the
 * tap and the rise, and only because without it the rise has nothing to show.
 */
export function useSheetPanelReady(visible: boolean): {
  isPanelReady: boolean;
  onPanelLayout: () => void;
} {
  const [isPanelReady, setIsPanelReady] = useState(false);

  useEffect(() => {
    if (!visible) {
      setIsPanelReady(false);
      return;
    }
    const timer = setTimeout(() => setIsPanelReady(true), PANEL_LAYOUT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  const onPanelLayout = useCallback(() => setIsPanelReady(true), []);

  return { isPanelReady, onPanelLayout };
}
