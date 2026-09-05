/**
 * Defers mounting an expensive subtree until after the current screen
 * transition's interactions have settled. Returning a lightweight shell on the
 * first render lets Android's native-stack commit (and therefore start the push
 * animation) immediately, instead of waiting for heavy data-fetching renders.
 *
 * Pass a persistenceKey (e.g. route id) to skip deferral on re-mounts — this
 * prevents the exit animation from flashing a blank/skeleton state when
 * react-native-screens briefly re-mounts the screen at the start of a back
 * transition. "Seen" only survives a short window past unmount, just long
 * enough to cover that remount — a genuinely new visit later (a fresh push
 * to the same route) still defers, rather than rendering the expensive
 * content synchronously on the push that is supposed to stay light.
 *
 * `minDelay` holds the content back for at least that long *after*
 * interactions settle, for callers whose shell is announced by an animation
 * that must not be stalled by the mount. Pass a function when the wait is the
 * remainder of an animation already running: it is called once the
 * interactions have settled, which is the only point at which "how much of it
 * is left" has an answer.
 */
import { useEffect, useState } from "react";
import { InteractionManager } from "react-native";

const mountedKeys = new Set<string>();
// Keyed the same as mountedKeys. A pending timeout means that key's unmount is
// provisional — still within the back-transition remount window — so it has
// not actually been forgotten yet.
const pendingForgets = new Map<string, ReturnType<typeof setTimeout>>();
// Long enough to cover react-native-screens' back-transition remount (near
// instant), short enough that a real later visit to the same route still
// defers.
const FORGET_DELAY_MS = 300;

export function useDeferredMount(
  persistenceKey?: string,
  minDelay: number | (() => number) = 0
): boolean {
  const alreadySeen = persistenceKey != null && mountedKeys.has(persistenceKey);
  const [ready, setReady] = useState(alreadySeen);

  useEffect(() => {
    if (persistenceKey != null) {
      const pending = pendingForgets.get(persistenceKey);
      if (pending) {
        clearTimeout(pending);
        pendingForgets.delete(persistenceKey);
      }
    }
    return () => {
      if (persistenceKey == null) return;
      const timer = setTimeout(() => {
        mountedKeys.delete(persistenceKey);
        pendingForgets.delete(persistenceKey);
      }, FORGET_DELAY_MS);
      pendingForgets.set(persistenceKey, timer);
    };
  }, [persistenceKey]);

  useEffect(() => {
    if (alreadySeen) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arrive = () => {
      if (persistenceKey != null) mountedKeys.add(persistenceKey);
      setReady(true);
    };
    const task = InteractionManager.runAfterInteractions(() => {
      // `minDelay` holds the heavy mount back past an animation that has to
      // finish first — the tab bar's press flash, which is what actually
      // answers the tap. Reanimated does not register with
      // `InteractionManager`, so without this the mount lands in the middle of
      // it and the UI thread stalls the very movement the wait was supposed to
      // protect.
      const delay = typeof minDelay === 'function' ? minDelay() : minDelay;
      if (delay <= 0) {
        arrive();
        return;
      }
      timer = setTimeout(arrive, delay);
    });
    return () => {
      task.cancel();
      if (timer) clearTimeout(timer);
    };
  }, []);

  return ready;
}
