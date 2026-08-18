/**
 * The signed-in account, and the predicate the whole app is gated on: whether it
 * still owes a username.
 *
 * Shares the `currentUser` query key with `shared/hooks/useAuth`, but is enabled
 * from the global auth session rather than that hook's own one-off token read,
 * so it is live on every launch and from the moment a sign-in is announced —
 * which is what lets the root layout's guard hold the "no account without a
 * username" rule on every route change rather than only at the sign-in call site.
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MeService, type UserMe } from 'shared'

import { useAuthStatus } from '@/utils/auth-session'

export const currentUserQueryKey = ['currentUser'] as const

/** How often the account is re-read while waiting for a confirmation link. */
const VERIFICATION_POLL_INTERVAL_MS = 4000
/**
 * The account request usually answers in well under a frame or two, so the
 * spinner it drives would flicker rather than read as "checking". Held this
 * long so each poll is actually seen.
 */
const VERIFICATION_SPINNER_MIN_MS = 600

export function useCurrentUser(): UserMe | undefined {
    const isAuthenticated = useAuthStatus() === 'signed-in'
    const { data } = useQuery({
        queryKey: currentUserQueryKey,
        queryFn: MeService.getCurrentUser,
        enabled: isAuthenticated,
    })
    // The cache outlives a session, so a signed-out app must not keep reporting
    // the account that just left as the current one.
    return isAuthenticated ? data : undefined
}

/**
 * Re-reads the account every few seconds while `isWaiting` (i.e. the email is
 * still unconfirmed), so the confirmation link being opened elsewhere — in a
 * mail app, on a laptop — turns the badge over on its own rather than waiting
 * for the user to leave the screen and come back.
 *
 * Returns whether a check is currently in flight, for the caller to show: the
 * point of the polling is that the user can see it happening, otherwise a
 * screen that looks frozen on "Not verified" invites them to hunt for a button.
 */
export function useEmailVerificationPolling(isWaiting: boolean): boolean {
    const isAuthenticated = useAuthStatus() === 'signed-in'
    const isEnabled = isAuthenticated && isWaiting
    const { isFetching } = useQuery({
        queryKey: currentUserQueryKey,
        queryFn: MeService.getCurrentUser,
        enabled: isEnabled,
        refetchInterval: isEnabled ? VERIFICATION_POLL_INTERVAL_MS : false,
    })
    const [isHeld, setIsHeld] = useState(false)
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
        if (!isFetching) return
        setIsHeld(true)
        if (timeoutRef.current) clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => setIsHeld(false), VERIFICATION_SPINNER_MIN_MS)
        return () => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current)
        }
    }, [isFetching])

    return isEnabled && (isFetching || isHeld)
}

/**
 * Positive check, deliberately: an account that has not loaded yet is *not*
 * "has a username". Everything that must wait for a username waits for a real
 * answer, and never acts on the absence of one.
 */
export function hasUsername(user: UserMe | undefined): boolean {
    return Boolean(user?.display_name?.trim())
}

/** True only once the account is loaded and turns out to have no username. */
export function isMissingUsername(user: UserMe | undefined): boolean {
    return user !== undefined && !hasUsername(user)
}
