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
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { MeService, type UserMe } from 'shared'

import { useAuthStatus } from '@/utils/auth-session'

export const currentUserQueryKey = ['currentUser'] as const

/**
 * A check that answers faster than this would flash its spinner rather than
 * read as "checking", so the spinner is held at least this long. Deliberate
 * feedback for a button the user pressed: they need to see that the tap did
 * something, even when the account comes back in 50ms.
 */
const VERIFICATION_SPINNER_MIN_MS = 600
/**
 * Much tighter than the app-wide request timeout: this one drives a visible
 * spinner on a button, and a spinner that outlives the user's patience stops
 * reading as progress and starts reading as broken. A check that cannot answer
 * within this is abandoned and the badge is left as it was — the user can
 * simply press again.
 */
const VERIFICATION_REQUEST_TIMEOUT_MS = 10_000

/**
 * The generated client has no per-request timeout, so the request is raced
 * against a timer and cancelled — `CancelablePromise.cancel()` aborts the
 * underlying axios request rather than leaving it running unwatched.
 */
function readAccountWithTimeout(): Promise<UserMe> {
    const request = MeService.getCurrentUser()
    return new Promise<UserMe>((resolve, reject) => {
        const timer = setTimeout(() => {
            request.cancel()
            reject(new Error('Timed out while checking the account'))
        }, VERIFICATION_REQUEST_TIMEOUT_MS)
        request.then(resolve, reject).finally(() => clearTimeout(timer))
    })
}

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
 * A one-shot "has it been confirmed yet?" re-read of the account, for the
 * refresh control next to the unverified-email badge.
 *
 * Manual rather than a background poll: the confirmation link is opened in
 * another app or on another device, so the app has no way to know when to look
 * — and a timer that re-reads the account every few seconds while Settings
 * happens to be open is traffic nobody asked for, to answer a question only
 * the user knows they are waiting on.
 *
 * The result is written straight into the shared `currentUser` cache, so a
 * confirmation that has landed turns the badge (and everything else reading the
 * account) over immediately. A failed or timed-out check changes nothing: the
 * badge keeps saying what it said, and pressing again is the whole recovery.
 */
export function useEmailVerificationCheck(): {
    isChecking: boolean
    check: () => void
} {
    const queryClient = useQueryClient()
    const [isChecking, setIsChecking] = useState(false)
    // Guards the two things a fired-and-forgotten request can get wrong: a
    // second check racing the first, and either one landing after the screen
    // is gone.
    const isCheckingRef = useRef(false)
    const isMountedRef = useRef(true)
    useEffect(() => {
        isMountedRef.current = true
        return () => {
            isMountedRef.current = false
        }
    }, [])

    const check = useCallback(() => {
        if (isCheckingRef.current) return
        isCheckingRef.current = true
        // Painted on the tap itself rather than off the request, so the button
        // acknowledges the press in the same frame.
        setIsChecking(true)
        const startedAt = Date.now()
        void readAccountWithTimeout()
            .then((user) => {
                queryClient.setQueryData(currentUserQueryKey, user)
            })
            .catch(() => {
                // Nothing to report: the badge already says the account is
                // unconfirmed, which is still the best answer available.
            })
            .finally(() => {
                // Measured from the start of the request, so a slow check is
                // not padded with an extra delay on top of the wait the user
                // already sat through.
                const remaining = Math.max(
                    0,
                    VERIFICATION_SPINNER_MIN_MS - (Date.now() - startedAt),
                )
                setTimeout(() => {
                    isCheckingRef.current = false
                    if (isMountedRef.current) setIsChecking(false)
                }, remaining)
            })
    }, [queryClient])

    return { isChecking, check }
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
