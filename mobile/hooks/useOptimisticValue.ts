import { useCallback, useEffect, useRef, useState } from "react";

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

  useEffect(() => {
    if (optimistic !== null && isEqual(value, optimistic)) setOptimistic(null);
  }, [value, optimistic, isEqual]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  const change = useCallback(
    (next: T) => {
      setOptimistic(next);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        onChange(next);
      });
    },
    [onChange]
  );

  return { value: optimistic ?? value, change };
}
