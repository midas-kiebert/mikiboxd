import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How long an optimistic value waits for the real one to catch up before it
 * gives up and shows the truth again. Every caller applies its change
 * synchronously (or optimistically, rolling back on failure), so the override
 * normally clears a render or two later and this never fires. It is here for
 * the change that is refused outright and silently — a notification set to
 * Email with no verified address, which opens a dialog and writes nothing —
 * where nothing else would ever put the control back where it belongs.
 */
const REVERT_UNCONFIRMED_MS = 1000;

/**
 * Generic "paint instantly, apply next frame" hook for toggle-like controls.
 * The returned `value` flips the same frame as `change` is called; the real
 * `onChange` (which may trigger an expensive re-filter/re-render) is deferred
 * by one `requestAnimationFrame` so the visual never waits on that work. Once
 * the incoming `value` prop catches up to the optimistic one, the override is
 * dropped automatically.
 */
export function useOptimisticValue<T>(
  value: T,
  onChange: (next: T) => void,
  isEqual: (a: T, b: T) => boolean = (a, b) => a === b
) {
  const [optimistic, setOptimistic] = useState<T | null>(null);
  const frameRef = useRef<number | null>(null);
  const revertRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelRevert = useCallback(() => {
    if (revertRef.current === null) return;
    clearTimeout(revertRef.current);
    revertRef.current = null;
  }, []);

  useEffect(() => {
    if (optimistic !== null && isEqual(value, optimistic)) {
      cancelRevert();
      setOptimistic(null);
    }
  }, [value, optimistic, isEqual, cancelRevert]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      cancelRevert();
    },
    [cancelRevert]
  );

  const change = useCallback(
    (next: T) => {
      setOptimistic(next);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        onChange(next);
      });
      cancelRevert();
      revertRef.current = setTimeout(() => {
        revertRef.current = null;
        setOptimistic(null);
      }, REVERT_UNCONFIRMED_MS);
    },
    [onChange, cancelRevert]
  );

  return { value: optimistic ?? value, change };
}
