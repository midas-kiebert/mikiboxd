/**
 * Who is here, answered synchronously.
 *
 * The website used to have exactly one answer to this — `_layout.tsx` awaited
 * `isLoggedIn()` in `beforeLoad` and redirected anyone without a token to
 * `/login`, so every screen below it could assume an account existed. Guest
 * browsing removes that assumption, and once it is gone every component needs
 * the answer *while rendering*, not one microtask later: a feed that waits on a
 * promise to decide whether to show "Going" buttons flashes the wrong UI first.
 *
 * So the token read happens once, before the first route renders (the router's
 * root `beforeLoad` awaits `primeSession`), and the result lives here as plain
 * module state that `useIsSignedIn` reads synchronously from then on. Login and
 * logout call `setSignedIn`, which notifies subscribers — nothing re-reads
 * storage after startup, which is also what keeps this consistent with the
 * app's own session store.
 */
import { storage } from "shared/storage"

type Listener = () => void

let signedIn: boolean | null = null
let priming: Promise<boolean> | null = null
const listeners = new Set<Listener>()

const notify = () => {
  for (const listener of listeners) listener()
}

/**
 * Resolve the session once and cache it. Safe to call repeatedly — every call
 * after the first returns the same promise, then the cached answer.
 */
export const primeSession = async (): Promise<boolean> => {
  if (signedIn !== null) return signedIn
  if (priming) return priming

  priming = storage
    .getItem("access_token")
    .then((token) => {
      signedIn = token !== null && token !== ""
      return signedIn
    })
    .catch(() => {
      // A storage read can fail in a private window. Treating that as "guest"
      // is the safe answer: the worst case is a sign-in prompt on an action,
      // rather than a screen that assumes an account it cannot prove.
      signedIn = false
      return false
    })
    .finally(() => {
      priming = null
      notify()
    })

  return priming
}

/** The cached answer, or `false` before `primeSession` has resolved. */
export const getSignedIn = (): boolean => signedIn ?? false

/** Called by login and logout so every subscriber updates in the same tick. */
export const setSignedIn = (next: boolean) => {
  if (signedIn === next) return
  signedIn = next
  notify()
}

export const subscribeToSession = (listener: Listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
