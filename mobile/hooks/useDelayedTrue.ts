import { useEffect, useRef, useState } from "react";

/**
 * True only once `value` has stayed true for `delayMs` straight — filters out
 * quick loading blips (a filter tap that resolves from cache almost
 * instantly) so a loading panel doesn't flash in and immediately back out.
 *
 * Reverts to false the instant `value` goes false — synchronously, in the
 * same render, not on a follow-up effect. `value` going false is usually the
 * exact render where real content (the list's cards) shows up, and an
 * effect-driven reset lands a frame or more later, especially under load
 * (e.g. a big Android list committing many rows at once); that gap is what
 * read as the panel lingering on top of content that had already arrived.
 *
 * `cooldownMs` (optional) additionally suppresses the *next* appearance for
 * that long after one hide — someone tapping through several filters in a
 * row each trigger their own short-lived load, and without a cooldown each
 * one clears the show delay independently, so the panel still strobes once
 * per tap. The cooldown collapses that into showing at most once per window.
 */
export function useDelayedTrue(value: boolean, delayMs: number, cooldownMs = 0): boolean {
  const [delayedShow, setDelayedShow] = useState(false);
  const cooldownUntilRef = useRef(0);

  useEffect(() => {
    if (!value) {
      setDelayedShow(false);
      cooldownUntilRef.current = Date.now() + cooldownMs;
      return;
    }
    const wait = Math.max(delayMs, cooldownUntilRef.current - Date.now());
    const timer = setTimeout(() => setDelayedShow(true), wait);
    return () => clearTimeout(timer);
  }, [value, delayMs, cooldownMs]);

  // Gated on `value` directly (not just the effect-driven state) so hiding
  // never waits on an effect to catch up — see the note above.
  return value && delayedShow;
}
