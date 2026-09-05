import type { ImperativeRouter } from 'expo-router'
import { MeService } from 'shared'
import { registerPushTokenForCurrentDevice } from '@/utils/push-notifications'
import { markSignedIn } from '@/utils/auth-session'
import { claimGuestCinemaSelection } from '@/utils/guest-cinema-selection'
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
export async function completeLogin(router: ImperativeRouter) {
    // A deep link the user opened while logged out is *not* followed from here.
    // It stays in storage, and the root layout resumes it once the account is
    // real and the intro it may owe is over.
    //
    // This used to be the place: it followed the path directly, and skipped it
    // for a brand-new account because doing otherwise stranded that account on
    // a screen outside the tabs layout, where nothing ever started the intro it
    // was owed — the only way out was restarting the app. Skipping it also lost
    // the link, which is the whole point of someone tapping an invite and then
    // signing up. Deferring it to the root layout answers both: the intro runs
    // first, on the tabs, and the link is followed on top of it afterwards.
    //
    // `utils/pending-deep-link` bounds how stale a stored path may be before it
    // is dropped instead of followed.

    // If they narrowed the feed to their own cinemas while browsing as a guest,
    // that choice is now theirs to keep — the new account inherits it rather
    // than making them pick the same cinemas a second time.
    //
    // Guarded on the account having no saved cinemas of its own, which is what
    // makes this safe on the *other* path into here: someone who already has an
    // account, browsed as a guest before remembering they had one, and logged
    // in. Their own picks are the real answer and a browsing session must not
    // overwrite them. (An account whose cinemas live in a favourite preset
    // instead reads as empty here, but the preset still wins when the backend
    // resolves the feed, so the write cannot change what they see either.)
    //
    // Not awaited, and failure is not fatal: this is a nicety on top of a login
    // that has already succeeded, and the cinema picker is one tap away.
    const guestCinemaIds = claimGuestCinemaSelection()
    if (guestCinemaIds.length > 0) {
        void (async () => {
            const savedCinemaIds = await MeService.getCinemaSelections()
            if (savedCinemaIds.length > 0) return
            await MeService.setCinemaSelections({ requestBody: guestCinemaIds })
        })().catch((cinemaError) => {
            console.error('Error carrying over guest cinema selection:', cinemaError)
        })
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
    //     rather than after the tabs below have painted and been seen;
    //  3. the actual navigation, which from here on happens behind the intro.
    markSignedIn()
    startIntroIfPending()
    router.replace('/(tabs)' as never)
}
