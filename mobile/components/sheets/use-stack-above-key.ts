/**
 * Keeps one sheet drawn in front of another it can open on top of.
 *
 * A gorhom sheet's z-order is fixed the first time it is presented:
 * @gorhom/portal updates a registered portal in place and never reorders it,
 * and `stackBehavior="push"` does not change that. So when the upper sheet
 * (Cinemas) is first opened on its own, before the lower one (Filters) ever
 * was, it is registered first and will draw *behind* Filters when later opened
 * from it.
 *
 * The fix is to rebuild the upper sheet, once, the first time it opens on top
 * of the lower one in that state: pass the returned `key` to it, and a new key
 * mounts a fresh sheet whose portal registers after the lower one's. That open
 * pays the build cost (~325ms on a mid-range Android); every open after it is
 * a single frame, and the order stays right for good.
 */
import { useCallback, useRef, useState } from "react";

export function useStackAboveKey(): {
  /** The upper sheet's `key`. */
  key: number;
  /** Call whenever the lower sheet opens. */
  onLowerOpen: () => void;
  /** Call whenever the upper sheet opens, saying whether the lower is open. */
  onUpperOpen: (isLowerOpen: boolean) => void;
} {
  const hasLowerRegisteredRef = useRef(false);
  const hasUpperRegisteredRef = useRef(false);
  const isUpperBehindRef = useRef(false);
  const [key, setKey] = useState(0);

  const onLowerOpen = useCallback(() => {
    hasLowerRegisteredRef.current = true;
  }, []);

  const onUpperOpen = useCallback((isLowerOpen: boolean) => {
    if (!hasUpperRegisteredRef.current) {
      hasUpperRegisteredRef.current = true;
      isUpperBehindRef.current = !hasLowerRegisteredRef.current;
      return;
    }
    if (isUpperBehindRef.current && isLowerOpen) {
      isUpperBehindRef.current = false;
      setKey((current) => current + 1);
    }
  }, []);

  return { key, onLowerOpen, onUpperOpen };
}
