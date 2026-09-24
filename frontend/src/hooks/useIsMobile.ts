/**
 * Whether the viewport is below the `md` breakpoint.
 *
 * Deliberately not Chakra's `useBreakpointValue`: that mounts its own
 * `matchMedia` listener per call site, and this hook is called from inside feed
 * rows — `ShowtimeCard`, `DatetimeCard`, `ShowtimeInfoBox`, `FriendBadges` —
 * so a feed scrolled a few pages deep was carrying thousands of listeners and
 * re-rendering every one of them on a resize.
 *
 * One module-level media query, shared by every caller through
 * `useSyncExternalStore`. It also answers on the first render rather than
 * returning `undefined` and settling a frame later, which removed a full
 * second render of every list on mount.
 */
import { useSyncExternalStore } from "react"

/** Chakra's default `md` breakpoint. Feed rows lay out narrow below it. */
const MOBILE_QUERY = "(max-width: 47.9975em)"

const query =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(MOBILE_QUERY)
    : null

const subscribe = (onChange: () => void) => {
  query?.addEventListener("change", onChange)
  return () => query?.removeEventListener("change", onChange)
}

const getSnapshot = () => query?.matches ?? false

/** Server render has no viewport; desktop is the safer of the two guesses. */
const getServerSnapshot = () => false

export const useIsMobile = () =>
  useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
