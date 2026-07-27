/**
 * Mirrors a value one frame late so the layout change it causes is tweened
 * rather than snapped.
 *
 * `LayoutAnimation.configureNext` has to run *before* the state update that
 * moves things around, which a component cannot do for a value handed to it as
 * a prop (a form error, a server error) — by the time it sees the new value the
 * re-render has already happened. Holding a local copy and advancing it from an
 * effect puts the update back under this component's control, so the height
 * change it causes can be announced first.
 *
 * Used by the auth screens, where an error message appearing under a field
 * otherwise shoves everything below it down by a line instantly.
 */
import { LayoutAnimation } from "react-native";
import { useEffect, useState } from "react";

import { EXPAND_LAYOUT_ANIMATION } from "@/utils/expand-animation";

export function useLayoutAnimatedValue<T>(value: T): T {
  const [deferred, setDeferred] = useState(value);

  useEffect(() => {
    if (Object.is(deferred, value)) return;
    LayoutAnimation.configureNext(EXPAND_LAYOUT_ANIMATION);
    setDeferred(value);
  }, [deferred, value]);

  return deferred;
}
