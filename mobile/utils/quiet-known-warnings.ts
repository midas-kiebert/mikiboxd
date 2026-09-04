/**
 * Silences a short, named list of warnings we have looked at and decided not to
 * act on yet.
 *
 * Deliberately not `LogBox.ignoreAllLogs()`: that only hides the on-device
 * overlay, leaves the Metro console as noisy as before, and hides *everything*
 * — including the next real warning. This drops specific messages, each with a
 * reason, and passes everything else through untouched.
 *
 * A entry here is a debt, not a fix. Anything listed should either be resolved
 * or re-justified; the list is short so that staying short is easy.
 *
 * Dev-only. Release builds never install the filter, so nothing can be hidden
 * from a production log by accident.
 */

type Suppressed = {
  /** Matched against the start of the formatted message. */
  readonly startsWith: string;
  /** Why it is here, and what would remove it. */
  readonly reason: string;
};

const SUPPRESSED: readonly Suppressed[] = [
  {
    startsWith: "InteractionManager has been deprecated",
    reason:
      "Three of the app's timing utilities schedule on runAfterInteractions — " +
      "use-deferred-mount, use-settled-focus and theme-preference — and all " +
      "three were measured on device against tab-switch and sheet-open " +
      "latency. requestIdleCallback waits for an idle JS thread rather than " +
      "for interactions to finish, which is a different promise, so swapping " +
      "them is a change to behaviour that has to be re-measured rather than a " +
      "rename. Until that happens the warning says nothing new once per launch.",
  },
];

let installed = false;

export function quietKnownWarnings(): void {
  if (!__DEV__ || installed) return;
  installed = true;

  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string" && SUPPRESSED.some((s) => first.startsWith(s.startsWith))) {
      return;
    }
    original(...args);
  };
}
