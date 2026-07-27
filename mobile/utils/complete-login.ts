import type { Router } from 'expo-router'
import { storage } from 'shared/storage'
import { registerPushTokenForCurrentDevice } from '@/utils/push-notifications'
import { PENDING_DEEP_LINK_PATH_KEY } from '@/constants/pending-deep-link'
import { isIntroOwed } from '@/utils/intro'

// Shared post-authentication side effects, run after any successful login or
// account creation (password, Apple, or Google) once tokens are stored.
export async function completeLogin(router: Router) {
    // A brand-new account still owes the intro (and, at the end of it, the
    // filters highlight): the OS permission prompt this can trigger has to
    // wait for both, so it's left entirely to the tabs layout's own
    // registration effect, which already waits for that.
    if (!isIntroOwed()) {
        try {
            // Redundant with tab onboarding by design: this catches edge cases
            // where Android permission/token flow is skipped during initial mount.
            await registerPushTokenForCurrentDevice({ force: true })
        } catch (notificationError) {
            console.error('Error initializing push notifications after login:', notificationError)
        }
    }
    // Resume any deep link the user opened while logged out. Navigating to
    // the stored path re-mounts the target screen, which re-runs its own
    // side effects (e.g. /ping registers the invite, /add-friend sends the
    // request), so no special-casing per route is needed here.
    const pendingDeepLinkPath = await storage.getItem(PENDING_DEEP_LINK_PATH_KEY)
    if (pendingDeepLinkPath) {
        await storage.removeItem(PENDING_DEEP_LINK_PATH_KEY)
        router.replace(pendingDeepLinkPath as never)
        return
    }
    router.replace('/(tabs)')
}
