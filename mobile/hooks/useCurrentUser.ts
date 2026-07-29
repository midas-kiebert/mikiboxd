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
import { useQuery } from '@tanstack/react-query'
import { MeService, type UserMe } from 'shared'

import { useAuthStatus } from '@/utils/auth-session'

export const currentUserQueryKey = ['currentUser'] as const

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
