import type { Router } from 'expo-router'
import { storage } from 'shared/storage'
import { registerPushTokenForCurrentDevice } from '@/utils/push-notifications'
import { PENDING_DEEP_LINK_PATH_KEY } from '@/constants/pending-deep-link'
import { markSignedIn } from '@/utils/auth-session'
import { isIntroOwed, startIntroIfPending } from '@/utils/intro'

// Shared post-authentication side effects, run after any successful login or
// account creation (password, Apple, or Google) once tokens are stored.
//
// Everything that decides *where* the user lands is resolved first, so the
// session flag, the intro and the navigation can all be applied in one
// synchronous block at the end. React batches that into a single commit, which
// is what keeps the root layout's route guard from ever seeing a signed-in user
// on a signed-out route (or the reverse) and firing a correcting redirect —
// the double redirect that used to show up as a login stalling and then
// flicking through the wrong screen on its way to the right one.
export async function completeLogin(router: Router) {
    // Resume any deep link the user opened while logged out. Navigating to
    // the stored path re-mounts the target screen, which re-runs its own
    // side effects (e.g. /ping registers the invite, /add-friend sends the
    // request), so no special-casing per route is needed here.
    const pendingDeepLinkPath = await storage.getItem(PENDING_DEEP_LINK_PATH_KEY)
    if (pendingDeepLinkPath) {
        await storage.removeItem(PENDING_DEEP_LINK_PATH_KEY)
    }

    // A brand-new account still owes the intro (and, at the end of it, the
    // filters highlight): the OS permission prompt this can trigger has to
    // wait for both, so it's left entirely to the tabs layout's own
    // registration effect, which already waits for that.
    //
    // Not awaited: this is a network round trip (and, on Android, possibly a
    // permission prompt) that has nothing to do with getting the user into the
    // app. Awaiting it left them staring at a spinning Log In button for as
    // long as it took. It is redundant with tab onboarding anyway, and only
    // exists to catch the cases where that is skipped during initial mount.
    if (!isIntroOwed()) {
        void registerPushTokenForCurrentDevice({ force: true }).catch((notificationError) => {
            console.error('Error initializing push notifications after login:', notificationError)
        })
    }

    // One synchronous block, in this order:
    //  1. the session exists, so the route guard agrees with where we go next;
    //  2. a brand-new account's walkthrough goes up *now*, covering this screen,
    //     rather than after the tabs below have painted and been seen. Skipped
    //     when a deep link is being resumed: that screen does its own thing on
    //     mount, and `IntroHost` will start the intro once the user reaches the
    //     tabs, exactly as it did before;
    //  3. the actual navigation, which from here on happens behind the intro.
    markSignedIn()
    if (!pendingDeepLinkPath) {
        startIntroIfPending()
    }
    router.replace((pendingDeepLinkPath ?? '/(tabs)') as never)
}
