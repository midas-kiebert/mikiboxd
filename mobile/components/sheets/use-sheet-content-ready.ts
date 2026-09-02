/**
 * Holds a sheet's expensive content back until the sheet itself is up.
 *
 * A gorhom sheet mounts its children the moment `present()` is called, and the
 * open animation only starts once that mount has committed — so a sheet with a
 * lot in it (the cinema picker is ~80 chips, several hundred native views)
 * does not begin to move until it has been built, and the tap that opened it
 * looks ignored. Gate the body on this flag and put a
 * {@link ../layout/LoadingLogo} up in the meantime: the first mount then costs
 * nothing, the sheet rises immediately, and the content arrives into a sheet
 * that is already there.
 *
 * A timer and not `InteractionManager`: gorhom animates under Reanimated,
 * which registers no interaction handle, so `runAfterInteractions` resolves
 * straight away and defers nothing (learned the hard way on the seat-plan
 * sheet).
 *
 * Resets on close, so the next open gets the same treatment — which is what a
 * `dismissWhenClosed` sheet needs anyway, since it rebuilds every time.
 */
import { useEffect, useState } from "react";

import { SHEET_OPEN_DURATION_MS } from "@/components/sheets/AppBottomSheet";

/**
 * The sheet's own animation plus a couple of frames: `present()` runs its
 * `snapToIndex` inside a `requestAnimationFrame`, so the movement starts
 * slightly after the flag flips.
 */
export const SHEET_CONTENT_MOUNT_DELAY_MS = SHEET_OPEN_DURATION_MS + 60;

export function useSheetContentReady(visible: boolean): boolean {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!visible) {
      setIsReady(false);
      return;
    }
    const timer = setTimeout(() => setIsReady(true), SHEET_CONTENT_MOUNT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  return isReady;
}
