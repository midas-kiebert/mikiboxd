import { useNavigate, useRouterState } from "@tanstack/react-router"
/**
 * The two hooks every guest-aware screen needs.
 *
 * `useIsSignedIn` answers "is there an account here" synchronously, and
 * `useRequireAccount` is how an *action* asks for one. The split matters: the
 * app's guest rules say to gate the action, not the button — a signed-out
 * visitor should still see "Going" and discover what an account is for by
 * pressing it, rather than meeting a screen that hides half of itself.
 */
import { useCallback, useSyncExternalStore } from "react"

import { getSignedIn, subscribeToSession } from "./session"

/** True when this browser has a session. Synchronous after startup. */
export const useIsSignedIn = (): boolean =>
  useSyncExternalStore(subscribeToSession, getSignedIn, getSignedIn)

/**
 * Returns a `requireAccount()` to call at the top of any handler that needs an
 * account. It returns `true` when the caller may proceed, and otherwise sends
 * the visitor to `/login` carrying the page they came from, so signing in
 * returns them to what they were trying to do.
 *
 *     const requireAccount = useRequireAccount()
 *     const onGoing = () => {
 *       if (!requireAccount()) return
 *       setStatus("GOING")
 *     }
 */
export const useRequireAccount = () => {
  const isSignedIn = useIsSignedIn()
  const navigate = useNavigate()
  const href = useRouterState({
    select: (state) => state.location.href,
  })

  return useCallback(() => {
    if (isSignedIn) return true
    void navigate({ to: "/login", search: { redirect: href } })
    return false
  }, [isSignedIn, navigate, href])
}

/**
 * `enabled` for account-scoped queries. A guest sitting on a screen with an
 * ungated `/me/*` query 401s on every refetch, which is what used to eject them
 * to the login screen mid-browse.
 */
export const useAccountQueryEnabled = (extraCondition = true): boolean =>
  useIsSignedIn() && extraCondition
