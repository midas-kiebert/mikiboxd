/**
 * Settles on a value only once it has stopped changing for `delayMs`.
 *
 * Used to keep a search field from firing a request per keystroke — five
 * requests for "annie" where one will do, each of them briefly emptying the
 * results the previous one just filled in.
 */
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    if (Object.is(settled, value)) return;
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, settled, value]);

  return settled;
}
