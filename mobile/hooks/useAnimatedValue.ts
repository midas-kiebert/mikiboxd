/**
 * One `Animated.Value`, created once and kept for the life of the component.
 *
 * The obvious spelling of this is `useRef(new Animated.Value(0)).current`, and
 * it is what every animated component here used to say. It is replaced
 * everywhere by this hook for one reason that is invisible until you go
 * looking for it: the React Compiler reads `.current` as a ref access during
 * render, and a component that touches a ref in render is one the compiler
 * **skips entirely** — silently, with no build warning and no runtime symptom
 * beyond being slower than it should be. Measured across the app, that was 27
 * files, and they were the animated ones: every dropdown, every chip in the
 * filter row, the search bar, the dialogs. Exactly the parts that have to stay
 * smooth.
 *
 * `useState` with a lazy initialiser says the same thing to React — built on
 * the first render, never rebuilt — without the ref, so the components that
 * hold an animated value are optimised along with everything else.
 *
 * It is also cheaper on its own terms: `useRef(new Animated.Value(0))`
 * constructs an `Animated.Value` on *every* render and throws all but the
 * first away. The lazy initialiser only ever runs once.
 *
 * For Reanimated shared values the equivalent trap is writing `sv.value = x`
 * outside a worklet; use `sv.set(x)` there.
 */
import { useState } from "react";
import { Animated } from "react-native";

export function useAnimatedValue(initialValue: number): Animated.Value {
  return useState(() => new Animated.Value(initialValue))[0];
}
