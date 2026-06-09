/**
 * Defers mounting an expensive subtree until after the current screen
 * transition's interactions have settled. Returning a lightweight shell on the
 * first render lets Android's native-stack commit (and therefore start the push
 * animation) immediately, instead of waiting for heavy data-fetching renders.
 *
 * Pass a persistenceKey (e.g. route id) to skip deferral on re-mounts — this
 * prevents the exit animation from flashing a blank/skeleton state when
 * react-native-screens briefly re-mounts the screen at the start of a back
 * transition.
 */
import { useEffect, useState } from "react";
import { InteractionManager } from "react-native";

const mountedKeys = new Set<string>();

export function useDeferredMount(persistenceKey?: string): boolean {
  const alreadySeen = persistenceKey != null && mountedKeys.has(persistenceKey);
  const [ready, setReady] = useState(alreadySeen);

  useEffect(() => {
    if (alreadySeen) return;
    const task = InteractionManager.runAfterInteractions(() => {
      if (persistenceKey != null) mountedKeys.add(persistenceKey);
      setReady(true);
    });
    return () => task.cancel();
  }, []);

  return ready;
}
