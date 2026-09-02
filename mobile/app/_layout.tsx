/**
 * Expo Router root layout. It wires global providers, auth-based redirects, and app-wide API config.
 */
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useRouter, useSegments, usePathname, useRootNavigationState, withLayoutContext } from 'expo-router';
import { CardStyleInterpolators, createStackNavigator, TransitionPresets, TransitionSpecs } from '@react-navigation/stack';
import { Appearance, Easing, Linking, LogBox, Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import {
  ApiError,
  OpenAPI,
  installAuthRefreshInterceptor,
  installUpdateRequiredInterceptor,
  type UpdateRequiredInfo,
} from 'shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { storage, setStorage } from 'shared/storage';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as SystemUI from 'expo-system-ui';
import * as SplashScreen from 'expo-splash-screen';
import Constants from 'expo-constants';
import { getGoogleSignin, isGoogleSignInAvailable } from '@/utils/google-signin';
import * as Sentry from '@sentry/react-native';
import { initSentry, reportError } from '@/utils/sentry';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import UpdateRequiredScreen from '@/components/layout/UpdateRequiredScreen';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { loadThemePreference, useThemePreference } from '@/utils/theme-preference';
import { loadFeatureTips } from '@/utils/feature-tips';
import { loadIntroState, useIsIntroOwed } from '@/utils/intro';
import { loadAuthSession, markSignedIn, markSignedOut, useAuthStatus } from '@/utils/auth-session';
import { loadGuestCinemaSelection } from '@/utils/guest-cinema-selection';
import { SignInGateProvider } from '@/components/auth/SignInGateProvider';
import { currentUserQueryKey, hasUsername, isMissingUsername, useCurrentUser } from '@/hooks/useCurrentUser';
import { markUsernameResolved, useIsUsernameRequired } from '@/utils/username-gate';
import { markAppReady, useIsAppReady } from '@/utils/app-ready';
import { parseInviteLinkUrl, registerInviteLink } from '@/utils/showtime-invite-link';
import { closeAllBlockingOverlays } from '@/utils/blocking-overlays';
import IntroHost from '@/components/intro/IntroHost';
import SignInNoticeHost from '@/components/auth/SignInNoticeHost';
import { savePendingDeepLink, takePendingDeepLink } from '@/utils/pending-deep-link';
import { getInstallReferrerPath } from '@/utils/install-referrer';
import AppSplash, { SPLASH_FADE_DURATION_MS } from '@/components/layout/AppSplash';
import ThemeSwitchOverlay from '@/components/layout/ThemeSwitchOverlay';
import {
  displayPresetOrderQueryKey,
  displayPresetsQueryKey,
  fetchDisplayPresets,
  loadDisplayPresetOrder,
} from '@/components/filters/saved-presets';
import { prefetchCinemas } from 'shared/hooks/useFetchCinemas';
import { prefetchSelectedCinemas } from 'shared/hooks/useFetchSelectedCinemas';
import { ShowtimeModalProvider, useShowtimeModal } from '@/components/showtimes/ShowtimeModalProvider';
import { NotificationCenterProvider } from '@/components/notifications/NotificationCenterProvider';
import {
  canRouteFromNotificationAction,
  configureNotificationCategories,
  getModalShowtimeIdFromNotification,
  handleNotificationQuickAction,
  resolveNotificationRoute,
  registerPushTokenForCurrentDevice,
} from '@/utils/push-notifications';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import axios, { AxiosRequestTransformer } from 'axios'
import * as qs from 'qs'
import useTrackEvent from 'shared/hooks/useTrackEvent';

export const unstable_settings = {
  anchor: '(tabs)',
};

// JavaScript-driven stack (react-navigation's classic Stack) instead of the
// native stack. The native stack on Android drops the leaving screen's content
// a frame before its exit animation runs, producing a blank-then-slide flash on
// back (react-native-screens #489). The JS stack runs the iOS-style card slide
// and the previous-screen parallax entirely in JS/Reanimated, so content is
// never cleared early — no blank, identical on iOS and Android.
const { Navigator: JsStackNavigator } = createStackNavigator();
const JsStack = withLayoutContext(JsStackNavigator);

// For screens that must appear and leave with no transition at all. Both the
// interpolator and the spec have to be given: the stack's screenOptions set each
// of them explicitly, and an explicit value always wins over a preset's.
const INSTANT_SCREEN_OPTIONS = {
  cardStyleInterpolator: CardStyleInterpolators.forNoAnimation,
  transitionSpec: {
    open: { animation: 'timing', config: { duration: 0 } },
    close: { animation: 'timing', config: { duration: 0 } },
  },
} as const;

// Before any of the module-scope work below, so a failure in it is reported
// rather than lost — this file's startup path is the one place that reaches
// into Play Services without a user action behind it.
initSentry();

// Configured once at startup so GoogleSignin.signIn() is ready wherever a
// sign-in button is rendered. webClientId sets the ID token audience, which
// the backend checks against settings.GOOGLE_CLIENT_IDS. Skipped entirely in
// Expo Go, which doesn't bundle this native module.
const googleWebClientId = Constants.expoConfig?.extra?.googleWebClientId as string | undefined;
// iOS-only: without a GoogleService-Info.plist, RNGoogleSignIn can't derive
// its own client ID and throws at configure() time without this.
const googleIosClientId = Constants.expoConfig?.extra?.googleIosClientId as string | undefined;
if (isGoogleSignInAvailable && googleWebClientId) {
  // configure() reaches into Play Services on Android, so a device with a
  // stale or mid-update GMS can throw here. That must not take down module
  // init for the whole app: sign-in is one button, and SocialSignInSection
  // already surfaces its own error when the user actually taps it.
  try {
    getGoogleSignin().GoogleSignin.configure({
      webClientId: googleWebClientId,
      ...(googleIosClientId ? { iosClientId: googleIosClientId } : {}),
    });
  } catch (error) {
    reportError('Error configuring Google Sign-In', error);
  }
}

setStorage({
  // Route shared storage calls through SecureStore on native devices.
  getItem: async (key: string) => {
    return await SecureStore.getItemAsync(key);
  },
  setItem: async (key: string, value: string) => {
    await SecureStore.setItemAsync(key, value);
  },
  removeItem: async (key: string) => {
    await SecureStore.deleteItemAsync(key);
  },
})

// Add BEFORE OpenAPI.BASE configuration
// Configure axios to properly serialize form-urlencoded data on React Native
const defaultTransformers: AxiosRequestTransformer[] =
  Array.isArray(axios.defaults.transformRequest)
    ? axios.defaults.transformRequest
    : axios.defaults.transformRequest
    ? [axios.defaults.transformRequest]
    : []

axios.defaults.transformRequest = [
  (data, headers) => {
    if (
      headers['Content-Type'] === 'application/x-www-form-urlencoded' &&
      data instanceof FormData
    ) {
      // Convert FormData to URL-encoded string
      const params: Record<string, unknown> = {}
      const formDataWithEntries = data as FormData & {
        entries?: () => IterableIterator<[string, FormDataEntryValue]>
      }
      if (typeof formDataWithEntries.entries === 'function') {
        for (const [key, value] of formDataWithEntries.entries()) {
          params[key] = value
        }
      } else {
        const reactNativeParts = (data as FormData & { _parts?: [string, unknown][] })._parts
        if (Array.isArray(reactNativeParts)) {
          for (const [key, value] of reactNativeParts) {
            params[key] = value
          }
        }
      }
      return qs.stringify(params)
    }
    return data
  },
  ...defaultTransformers,
]

// OpenAPI.BASE = "http://192.168.1.121:8000";
// In dev (`pnpm start`) talk to the staging API/DB; release builds use production.
OpenAPI.BASE = __DEV__ ? "https://api.staging.mikino.nl" : "https://api.mikino.nl";

// Attach bearer token from secure storage to every generated client request.
OpenAPI.TOKEN = async () => {
  const token = await storage.getItem('access_token');
  return token || '';
}

// Lets the backend attribute logins/events to a platform without any
// per-request client code (see AnalyticsEventName.LOGIN in login.py), and
// gate old builds if a breaking API change ever needs it — see
// installUpdateRequiredInterceptor below and app/core/middleware.py.
OpenAPI.HEADERS = {
  'X-Client-Platform': Platform.OS,
  'X-Client-Version': Constants.expoConfig?.version ?? '0.0.0',
};

let apiLoggingEnabled = false;
if (__DEV__ && !apiLoggingEnabled) {
  apiLoggingEnabled = true;
  OpenAPI.interceptors.request.use((config) => {
    const method = config.method ? config.method.toUpperCase() : "GET";
    console.log(`[API] ${method} ${config.url}`);
    return config;
  });
  OpenAPI.interceptors.response.use((response) => {
    console.log(`[API] ${response.status} ${response.config?.url}`);
    return response;
  });
}

// An involuntary sign-out leaves the cache behind, unlike `logout`, which clears
// it. The cached account has to go with the session: the next one to sign in
// reads the same `currentUser` key, and a leftover account *with* a username is
// exactly what would tell the username guard below that a brand-new account
// already has one.
const endSessionCaches = () => {
  queryClient.removeQueries({ queryKey: currentUserQueryKey });
  // The gate belongs to the session that raised it; the next one decides for
  // itself, rather than inheriting a demand meant for an account that is gone.
  markUsernameResolved();
};

// When the backend rejects our stored token (401), the session is dead — the
// token is invalid/expired (or was issued by a different backend). Clear it and
// let the component-level redirect send the user back to login, rather than
// leaving them stuck on a blank screen that re-fires 401s forever.
const handleUnauthorized = (error: unknown) => {
  if (!(error instanceof ApiError) || error.status !== 401) return;
  void storage.removeItem('access_token');
  endSessionCaches();
  markSignedOut();
};

// Before a 401 becomes a logout, try to transparently refresh the access token.
// Only a failed refresh falls through to handleUnauthorized above.
installAuthRefreshInterceptor(() => {
  endSessionCaches();
  markSignedOut();
});

// When the backend 426s (this build is older than MIN_SUPPORTED_CLIENT_VERSION),
// there's no recovering — every call will keep failing the same way. Route
// straight to the blocking update screen instead of whatever the failed call
// would otherwise have shown.
let onUpdateRequired: ((info: UpdateRequiredInfo) => void) | null = null;
installUpdateRequiredInterceptor((info) => {
  onUpdateRequired?.(info);
});

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleUnauthorized }),
  mutationCache: new MutationCache({ onError: handleUnauthorized }),
});

// Keep the native splash up until the app shell is stable (see RootLayourContent).
void SplashScreen.preventAutoHideAsync();

// Tracked so the splash can wait for the saved theme before revealing the UI,
// avoiding a dark→light (or vice-versa) recolour flash on launch.
const themePreferenceReady = loadThemePreference();

// Feature tips render nothing until this resolves, so the splash needn't wait.
void loadFeatureTips();

// Same for the first-run intro: it only starts once this says an account was
// created on this device, which is well after the splash is gone.
void loadIntroState();

// A guest's cinema picks shape their very first feed, so this is read alongside
// the session rather than after it. The splash does not wait on it: the filter
// state seeds itself the moment it lands, and until then the feed is the
// unfiltered catalogue, which is the right thing to show anyway.
void loadGuestCinemaSelection();

// Screenshot-mode bypass for App Store screenshot automation (CI only — see
// .github/workflows/ios-screenshots.yml): writes a real, pre-fetched staging
// token straight to storage and marks the session signed in immediately,
// skipping the login screen (and everything that only runs from
// completeLogin, e.g. push-token registration) entirely. Never set outside
// that workflow.
const screenshotModeToken = process.env.EXPO_PUBLIC_SCREENSHOT_MODE_TOKEN;
if (screenshotModeToken) {
  void storage.setItem('access_token', screenshotModeToken).then(markSignedIn);
  // Dev-only LogBox warning toasts sit at the bottom of the screen and cover
  // the tab bar — cosmetic noise a real build never shows, but it blocks
  // automation from reaching the tabs underneath.
  LogBox.ignoreAllLogs(true);
} else {
  // The one and only read of the stored token. Everything after this point is
  // announced synchronously by whoever signs in or out — see `auth-session.ts`.
  void loadAuthSession();
}

// Default foreground notification behavior for this app.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});



function RootLayourContent() {
  // Current route segments let us detect whether the user is in a protected area.
  const segments = useSegments();
  const pathname = usePathname();
  // Router instance used for in-app navigation actions.
  const router = useRouter();
  // `key` is null until the navigator has actually mounted; on a fast cold
  // start `!rootSegment` below isn't enough on its own to catch this, since
  // useSegments() can already report a non-empty path before the Root Layout
  // has finished its first mount, and router.replace() throws if called
  // before then ("Attempted to navigate before mounting the Root Layout").
  const navigationState = useRootNavigationState();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  // Single source of truth for "is there a session", shared with the screens
  // that start and end one so this never disagrees with them mid-navigation.
  const authStatus = useAuthStatus()
  // True only until the stored session has been read once, at startup.
  const isChecking = authStatus === 'unknown'
  const isAuthenticated = authStatus === 'signed-in'
  // Browsing without an account. Allowed everywhere the catalogue lives, and
  // nowhere an account is the subject — see the route guard below.
  const isGuest = authStatus === 'guest'
  // Whether the app shell should be up at all, rather than the login screen.
  const isInsideApp = isAuthenticated || isGuest
  // Splash gating: theme loaded, critical caches warmed, and whether the
  // branded overlay is still mounted.
  const [themeReady, setThemeReady] = useState(false)
  const [warmupDone, setWarmupDone] = useState(false)
  const [splashVisible, setSplashVisible] = useState(true)
  // Reveal the app only once the shell is stable: theme resolved, auth known,
  // and critical caches warmed. The branded overlay covers everything until then.
  const appReady = themeReady && !isChecking && warmupDone;
  // Set once the backend 426s this build; renders UpdateRequiredScreen instead
  // of the app shell for the rest of the session (see onUpdateRequired above).
  const [updateRequiredInfo, setUpdateRequiredInfo] = useState<UpdateRequiredInfo | null>(null)
  const queryClient = useQueryClient();
  const hasHiddenNativeSplashRef = useRef(false)
  const user = useCurrentUser();
  const userId = user?.id ? String(user.id) : undefined;
  // An account with no username is not allowed to be anywhere but the screen
  // that asks for one — see the route guard below. Two sources, because neither
  // covers the other's window: the loaded account is authoritative but arrives a
  // round trip late, and the gate a sign-in raises is synchronous but only knows
  // about the session it started.
  const owesUsername = useIsUsernameRequired() || isMissingUsername(user);
  const { trackEvent } = useTrackEvent();
  // Lets notification taps open the showtime modal in place instead of navigating.
  const { openShowtimeModalById } = useShowtimeModal();
  // Gates deep-link handling until the shell is up — see the invite effect below.
  const isAppReady = useIsAppReady();
  // Prevent duplicate handling when the same notification response is replayed.
  const handledNotificationResponsesRef = useRef<Set<string>>(new Set())
  // Anything arriving from outside the app mid-walkthrough — a notification tap,
  // an invite link, a deferred link carried through an install — would otherwise
  // navigate or open the showtime modal right underneath the intro, which only
  // reveals it once the intro ends. So its routing waits for the intro to be out
  // of the way.
  //
  // "Owed", not "active": a brand-new account owes the intro from the moment it
  // exists, a beat before the walkthrough is actually on screen, and holding on
  // the narrower flag lets an arrival slip into that beat and open underneath.
  //
  // One slot is enough — two external arrivals inside a single walkthrough would
  // need a brand-new install to already have notifications waiting for it.
  const isIntroOwed = useIsIntroOwed()
  const isIntroOwedRef = useRef(isIntroOwed)
  useEffect(() => {
    isIntroOwedRef.current = isIntroOwed
  }, [isIntroOwed])
  const pendingExternalRouteRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (isIntroOwed) return
    const runPendingRoute = pendingExternalRouteRef.current
    if (!runPendingRoute) return
    pendingExternalRouteRef.current = null
    runPendingRoute()
  }, [isIntroOwed])

  useEffect(() => {
    // Pre-load detail route modules so first navigation to each is instant.
    void import('./movie/[id]');
    void import('./friend-showtimes/[id]');
    void import('./cinema-showtimes/[id]');
  }, []);

  useEffect(() => {
    // Surface a 426 from the backend as a blocking update screen. Set once,
    // never cleared — there's no build-version change mid-session that would
    // make it stop applying.
    onUpdateRequired = (info) => {
      setUpdateRequiredInfo(info)
    }
    return () => {
      onUpdateRequired = null
    }
  }, [])

  useEffect(() => {
    // Resolve the saved theme before we reveal the UI (see themePreferenceReady).
    let active = true;
    void themePreferenceReady.finally(() => {
      if (active) setThemeReady(true);
    });
    return () => {
      active = false;
    };
  }, [])

  const hasTrackedAppOpenRef = useRef(false)
  useEffect(() => {
    // Fire once per cold start, the moment we know a session exists — this is
    // what actually reflects app usage, since most launches reuse the stored
    // token and never hit the LOGIN-tracked /login/access-token endpoint.
    if (isChecking || !isAuthenticated || hasTrackedAppOpenRef.current) return;
    hasTrackedAppOpenRef.current = true;
    trackEvent('app_open');
  }, [isChecking, isAuthenticated, trackEvent]);

  useEffect(() => {
    // Warm the caches the shell renders from (preset chips) so it appears fully
    // populated rather than streaming in. Bounded by a timeout so a slow network
    // never delays launch — the chips fall back to their own skeletons.
    if (isChecking) return;
    // The cinema list is public and identical for everyone, so it is pulled on
    // every launch — signed out included. That is the whole point: a brand-new
    // account reaches the intro's cinema picker seconds after the signup form,
    // and starting the fetch only once a session exists left it staring at
    // skeletons. Started while the login/signup screen is still on screen, it is
    // already in cache by the time the picker mounts.
    void prefetchCinemas(queryClient);
    if (!isAuthenticated) {
      setWarmupDone(true);
      return;
    }
    let cancelled = false;
    const warm = Promise.allSettled([
      queryClient.prefetchQuery({
        queryKey: displayPresetsQueryKey,
        queryFn: () => fetchDisplayPresets(),
      }),
      queryClient.prefetchQuery({
        queryKey: displayPresetOrderQueryKey,
        queryFn: () => loadDisplayPresetOrder(),
      }),
      // Companion to the unconditional cinema prefetch above: which of those
      // cinemas this account already has picked.
      prefetchSelectedCinemas(queryClient),
    ]);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1500));
    void Promise.race([warm, timeout]).then(() => {
      if (!cancelled) setWarmupDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [isChecking, isAuthenticated, queryClient])

  useEffect(() => {
    // The account is the authority, so it also lowers the gate: whatever the
    // sign-in that raised it believed, an account that turns out to have a
    // username is not held on the screen that asks for one.
    if (hasUsername(user)) markUsernameResolved()
  }, [user])

  // `useSegments` hands back a fresh array every render, so the guard below re-runs
  // on every render — not just when the route actually changed. A redirect takes a
  // few renders to land, and each of those renders used to fire the same
  // `router.replace` again, stacking two or three login screens on top of each other.
  const issuedRedirectRef = useRef<string | null>(null)
  const redirectTo = useCallback(
    (href: '/login' | '/(tabs)' | '/pick-username') => {
      if (issuedRedirectRef.current === href) return
      issuedRedirectRef.current = href
      // Deferred a frame: `navigationState?.key` above can already be
      // non-null while the native navigator is still mid-mount, and
      // router.replace() called synchronously in that window throws
      // "Attempted to navigate before mounting the Root Layout component"
      // — confirmed reproducing on every cold launch even with that guard
      // in place. Pushing past the current commit gives it time to finish.
      requestAnimationFrame(() => router.replace(href))
    },
    [router]
  )

  useEffect(() => {
    if (isChecking) return
    // Belt-and-suspenders with the `!rootSegment` check below: `key` is null
    // until the navigator has actually finished mounting, which is the
    // precise condition `router.replace` itself cares about — segments can
    // report a non-empty path slightly before that on a fast cold start.
    if (!navigationState?.key) return

    const segmentPath = segments as unknown as string[]
    const rootSegment = segmentPath[0]
    // No segment means the navigator has not mounted yet, so there is no route
    // to classify — and nothing may navigate before the root layout is up
    // (`router.replace` throws outright). This used to be unreachable only by
    // luck: the session was resolved by an async token read, which always landed
    // a tick or two after mount. It is read once at module load now, so on a
    // fast start this effect runs in the very same commit the navigator is
    // still rendering in, and the "authenticated but not in an auth route"
    // branch below fired against a navigator that did not exist.
    if (!rootSegment) return

    // Three explicit lists rather than one and its inverse. A route that is in
    // none is left alone, which is what `pick-username` needs: it is reached
    // *while* signing in, so it must neither demand a session it is halfway to
    // establishing nor be treated as a signed-out screen to be redirected away
    // from once one exists.
    //
    // `browseRoutes` is the catalogue — what is playing, where, and when. It is
    // the same for everyone and needs no account to be worth reading, so a guest
    // is let in. `accountRoutes` are the ones *about* a person: they cannot be
    // rendered for nobody, so they still send a guest to the login screen.
    //
    // `ping` sits with the browse routes despite being an invite link, because
    // the route itself does nothing but bow out (see its screen); the invite is
    // handled by the effect below, which shows a guest the screening and leaves
    // accepting it to the sheet's own gate.
    const browseRoutes = new Set(['(tabs)', 'movie', 'cinema-showtimes', 'ping'])
    const accountRoutes = new Set(['friend-showtimes', 'add-friend', 'blocked-users', 'default-visibility'])
    const signedOutRoutes = new Set(['login', 'signup', 'recover-password'])
    // Protected in release builds — the real flow only ever arrives already
    // signed in. In dev it stays neutral so the login screen's "Preview
    // pick-username screen" shortcut, taken while signed out, is not bounced
    // straight back to /login.
    if (!__DEV__) accountRoutes.add('pick-username')

    const isBlockedRoute = accountRoutes.has(rootSegment) || (!isGuest && browseRoutes.has(rootSegment))

    if (!isAuthenticated && isBlockedRoute) {
      // Not signed in, on a route that needs an account.
      // Remember the deep link (everything except the plain tabs home) so the
      // login flow can resume it after the user signs in.
      if (rootSegment !== '(tabs)') {
        void savePendingDeepLink(pathname)
      }
      redirectTo('/login')
    } else if (isAuthenticated && owesUsername && rootSegment !== 'pick-username') {
      // The one rule with no exceptions: an account without a username gets no
      // further than the screen that asks for one — no tabs, no deep link, no
      // intro. Enforced here rather than only where a social sign-in navigates,
      // because that is a single decision taken once, and it only has to lose a
      // race with another redirect (or be force-quit on the way) for an account
      // to exist that can never be found or recognised by anyone.
      redirectTo('/pick-username')
    } else if (isAuthenticated && signedOutRoutes.has(rootSegment)) {
      redirectTo('/(tabs)')
    } else {
      // Landed somewhere this guard is happy with, so the next redirect (a
      // logout, say) starts from a clean slate.
      issuedRedirectRef.current = null
    }
  }, [isAuthenticated, isGuest, owesUsername, router, segments, pathname, isChecking, navigationState, redirectTo])

  const handleNotificationResponse = useCallback(
    async (response: Notifications.NotificationResponse) => {
      const responseKey = `${response.notification.request.identifier}:${response.actionIdentifier}`
      if (handledNotificationResponsesRef.current.has(responseKey)) {
        return
      }
      handledNotificationResponsesRef.current.add(responseKey)

      const notificationData = response.notification.request.content.data
      trackEvent('notification_clicked', {
        type: (notificationData as { type?: string } | undefined)?.type,
      })

      try {
        await handleNotificationQuickAction(response)
      } catch (error) {
        console.error('Error handling notification quick action:', error)
      }

      if (canRouteFromNotificationAction(response.actionIdentifier)) {
        const data = response.notification.request.content.data
        // Showtime notifications open the modal in place (no page-jumping);
        // everything else still navigates via the resolved route.
        const modalShowtimeId = getModalShowtimeIdFromNotification(data)
        const runRoute = () => {
          // Same reason as the invite deep link below: a sheet still open from
          // before the tap would otherwise keep drawing over what the tap opens.
          closeAllBlockingOverlays()
          if (modalShowtimeId !== null) {
            openShowtimeModalById(modalShowtimeId)
          } else {
            const route = resolveNotificationRoute(data)
            if (route) {
              router.push(route)
            }
          }
        }
        // Mid-intro, this would open/navigate right underneath the walkthrough
        // and only be revealed once it ends. Hold it until the intro is done.
        if (isIntroOwedRef.current) {
          pendingExternalRouteRef.current = runRoute
        } else {
          runRoute()
        }
      }

      try {
        await Notifications.clearLastNotificationResponseAsync()
      } catch (error) {
        console.error('Error clearing last notification response:', error)
      }
    },
    [router, openShowtimeModalById, trackEvent]
  )

  // Release the deep links held back during launch, once the splash has faded
  // and the shell is the thing on screen. Keyed on `appReady` rather than the
  // splash's own onHidden, which is skipped outright if its fade is interrupted.
  useEffect(() => {
    if (!appReady) return
    const timer = setTimeout(markAppReady, SPLASH_FADE_DURATION_MS)
    return () => clearTimeout(timer)
  }, [appReady])

  // Invite links are handled here rather than on the `/ping` route they resolve
  // to. That route is not a reliable handler: on a cold start it can mount into
  // a shell that is still assembling (or never mount at all, if the launch URL
  // lands before the navigator does), and on a warm open it mounts on top of
  // whatever the user was already looking at. Reading the URL directly — the
  // launch one plus every one delivered while running — makes it one path that
  // works the same either way, and leaves the route with nothing to do but bow
  // out.
  useEffect(() => {
    if (!isAppReady || isChecking) return
    let cancelled = false

    const handleUrl = (url: string | null) => {
      if (cancelled || !url) return
      const invite = parseInviteLinkUrl(url)
      if (!invite) return

      if (!isAuthenticated) {
        // Stored so the login flow resumes where the link was headed. The
        // invite itself is picked up by this effect re-running once a session
        // exists, which re-reads the same launch URL — hence `isAuthenticated`
        // in the deps.
        void savePendingDeepLink(`/ping/${invite.showtimeId}/${invite.token}`)
        // A guest can still be shown the screening they were invited to — that
        // is public, and it is the thing the link is actually about. Accepting
        // the invite is not, so the sheet's own gate does the asking, at the
        // moment they reach for it rather than the moment they open the link.
        if (isGuest) {
          closeAllBlockingOverlays()
          openShowtimeModalById(invite.showtimeId, { requireUpcoming: true })
        }
        return
      }

      const openInvite = () => {
        // An invite arriving from outside the app has to end up in front of the
        // user, and a sheet left open from before would otherwise swallow it:
        // the showtime sheet's portal slot was fixed the first time it opened,
        // so one raised later (the notification centre, say) keeps drawing over
        // it.
        closeAllBlockingOverlays()
        // `requireUpcoming`: a link keeps working long after its showtime has
        // started, and opening a screening that is already over invites nothing.
        // The backend rejects the ping for the same reason, which
        // registerInviteLink swallows.
        // `awaitBeforeFetch`: the ping must be recorded server-side before the
        // showtime is fetched, or the sheet's first render (viewer.invited_by,
        // the "invited by" banner) misses the invite it was just opened for —
        // it would only show up after closing and reopening the sheet.
        openShowtimeModalById(invite.showtimeId, {
          requireUpcoming: true,
          awaitBeforeFetch: () => registerInviteLink({ ...invite, queryClient }),
        })
      }

      // Signing up *from* an invite link is the common case now that the web
      // install panel sends people here, and it lands mid-intro: the sheet would
      // open underneath the walkthrough and only be found once it ends.
      if (isIntroOwedRef.current) {
        pendingExternalRouteRef.current = openInvite
      } else {
        openInvite()
      }
    }

    void Linking.getInitialURL()
      .then(handleUrl)
      .catch((error) => {
        console.error('Error reading launch URL:', error)
      })

    // Android only: the link someone tapped before they had the app at all,
    // carried through the Play Store install. Read alongside the launch URL
    // rather than instead of it, and stable across this effect's re-runs for
    // the same reason `getInitialURL` is — the run that matters is the one
    // after a session exists.
    void getInstallReferrerPath()
      .then((path) => {
        if (cancelled || !path) return
        if (parseInviteLinkUrl(path)) {
          // `parseInviteLinkUrl` takes a bare path as happily as a full URL.
          handleUrl(path)
          return
        }
        // The other two shapes are ordinary routes that do their own work on
        // mount — `/add-friend` sends the request, `/movie` renders the film —
        // so they only need following. Stored rather than pushed: a referred
        // install arrives with no session at all, and the effect below is what
        // follows it once there is one.
        void savePendingDeepLink(path)
      })
      .catch((error) => {
        console.error('Error reading install referrer:', error)
      })

    const subscription = Linking.addEventListener('url', ({ url }) => handleUrl(url))

    return () => {
      cancelled = true
      subscription.remove()
    }
  }, [isAppReady, isChecking, isAuthenticated, isGuest, openShowtimeModalById, queryClient])

  // Follow the deep link that was waiting on a session, once there is one and
  // the walkthrough it may owe is over. `completeLogin` deliberately leaves the
  // path in storage rather than navigating to it itself: for a brand-new account
  // that would land them outside the tabs layout, where the intro they are owed
  // never starts.
  //
  // `owesUsername` is in the guard for the same reason the route guard has it —
  // an account without a username goes nowhere but the screen that asks for one.
  useEffect(() => {
    if (!isAppReady || isChecking || !isAuthenticated || owesUsername || isIntroOwed) return
    let cancelled = false

    void takePendingDeepLink().then((path) => {
      if (cancelled || !path) return
      // `/ping` paths are read but not followed: that route is a bouncer that
      // pops itself, and the invite is acted on by the effect above. Pushing it
      // would only shuffle the stack under a sheet that just opened.
      if (parseInviteLinkUrl(path)) return
      router.push(path as never)
    })

    return () => {
      cancelled = true
    }
  }, [isAppReady, isChecking, isAuthenticated, owesUsername, isIntroOwed, router])

  useEffect(() => {
    void configureNotificationCategories().catch((error) => {
      console.error('Error configuring notification categories:', error)
    })
  }, [])

  useEffect(() => {
    const responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      void handleNotificationResponse(response)
    })

    let isMounted = true
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!isMounted || !response) return
        void handleNotificationResponse(response)
      })
      .catch((error) => {
        console.error('Error loading last notification response:', error)
      })

    return () => {
      isMounted = false
      responseSubscription.remove()
    }
  }, [handleNotificationResponse])

  useEffect(() => {
    if (!isAuthenticated) return;

    const pushTokenListener = Notifications.addPushTokenListener(() => {
      void registerPushTokenForCurrentDevice({ userId }).catch((error) => {
        reportError('Error refreshing push token after token update', error)
      })
    })

    return () => {
      pushTokenListener.remove()
    }
  }, [isAuthenticated, userId])

  // A 426 means every API call from here on fails the same way — show the
  // blocking screen instead of the shell, regardless of auth/splash state.
  if (updateRequiredInfo) {
    return <UpdateRequiredScreen info={updateRequiredInfo} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      {!isChecking && (
        <>
      <JsStack
        // isAuthenticated is already resolved by the time this mounts (gated
        // on !isChecking above), so open directly on the right screen instead
        // of always defaulting to (tabs) and letting the auth-guard effect
        // below redirect afterwards — that redirect used to be visible as a
        // flash of (tabs) sliding away into /login on a logged-out cold start.
        initialRouteName={isInsideApp ? '(tabs)' : 'login'}
        screenOptions={{
          headerShown: false,
          // iOS-style card slide with the previous-screen parallax, run in JS so
          // there's no Android native-stack blank flash on back. Applies to all
          // pushed screens; the anchored (tabs) root has no entry transition.
          ...TransitionPresets.SlideFromRightIOS,
          // The incoming screen mounts fresh on push; the JS-driven slide starts
          // instantly while its content is still painting, so a same-coloured card
          // would slide in "empty" and the content would pop in at the end. A short
          // delay on the open lets React paint the screen's skeleton before the card
          // begins moving, so you see it slide in fully formed (WhatsApp-style). The
          // close keeps the default iOS spring — both screens are already painted.
          transitionSpec: {
            open: {
              animation: 'timing',
              config: { duration: 300, delay: 48, easing: Easing.out(Easing.poly(4)) },
            },
            close: TransitionSpecs.TransitionIOSSpec,
          },
          cardStyle: { backgroundColor: palette.background },
        }}
      >
        <JsStack.Screen name="(tabs)" />
        {/* Never animated. Expo Router builds the initial state from the launch
            URL, which on a normal cold start is the tabs home — so a signed-out
            launch always starts there and is redirected here a beat later, and
            with a transition that redirect reads as the app sliding the login
            screen in over a home screen the user was never meant to see. Logging
            out lands here the same way. */}
        <JsStack.Screen name="login" options={INSTANT_SCREEN_OPTIONS} />
        <JsStack.Screen name="movie/[id]" />
        <JsStack.Screen name="friend-showtimes/[id]" />
        <JsStack.Screen name="cinema-showtimes/[id]" />
        <JsStack.Screen name="add-friend/[receiverId]" />
        <JsStack.Screen name="blocked-users" />
        <JsStack.Screen name="default-visibility" />
        {/* Renders nothing and pops itself the moment it is handled, so it must
            never animate: sliding an empty card in and back out again was the
            whole of the invite link's "glitchy" open, and it happens over a
            screen the user is already looking at when the app was running. */}
        <JsStack.Screen name="ping/[showtimeId]/[sender]" options={INSTANT_SCREEN_OPTIONS} />
      </JsStack>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
        </>
      )}
      {/* Deliberately not gated on the splash being gone. The intro is a Modal,
          so it draws above the splash overlay rather than below it — which is
          the point: on a launch that owes the intro it goes up while the splash
          is still opaque, and the splash then fades out behind it. Waiting for
          the splash instead meant the app itself was revealed for a beat before
          the walkthrough covered it back up. */}
      {isAuthenticated && <IntroHost />}
      {isAuthenticated && <SignInNoticeHost />}
      {splashVisible && (
        <AppSplash
          active={!appReady}
          onHidden={() => setSplashVisible(false)}
          onReady={() => {
            if (hasHiddenNativeSplashRef.current) return;
            hasHiddenNativeSplashRef.current = true;
            // Our overlay is now painted on top — hand off from the native splash.
            void SplashScreen.hideAsync().catch(() => {});
          }}
        />
      )}
      {/* Last child, so the curtain over a theme change covers everything the
          re-render is visibly working through. Renders nothing until there is
          a switch to cover. */}
      <ThemeSwitchOverlay />
    </View>
  )
}








function RootLayout() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  // Theme mode selects the matching React Navigation theme object.
  const colorScheme = useColorScheme();
  const [themePreference] = useThemePreference();
  const palette = Colors[colorScheme ?? 'light'];
  const baseTheme = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = {
    ...baseTheme,
    colors: {
      ...baseTheme.colors,
      background: palette.background,
      card: palette.background,
      border: palette.divider,
      text: palette.text,
      primary: palette.tint,
    },
  };

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(palette.background);
  }, [palette.background]);

  useEffect(() => {
    // Push the chosen theme down to the native layer so OS-rendered widgets
    // (default-color ActivityIndicators, action sheets, the keyboard, text
    // carets, RefreshControl, etc.) follow the app's theme instead of the
    // device's system appearance. Without this, forcing dark mode on a
    // light-mode device leaves those widgets rendering in light mode (a dark,
    // near-invisible spinner on a dark background). `null` restores following
    // the system when the user picks "system".
    Appearance.setColorScheme(themePreference === 'system' ? null : themePreference);
  }, [themePreference]);

  // Render/output using the state and derived values prepared above.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* initialWindowMetrics provides safe-area insets synchronously on the very
          first frame, so screens don't render at inset 0 and then jump into place
          (a visible flash on tab switches). */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <BottomSheetModalProvider>
          <QueryClientProvider client={queryClient}>
            <ThemeProvider value={theme}>
              {/* Above the sheet and notification providers, so the sign-in
                  prompt it raises survives the surface the tap came from —
                  several of those close themselves on press. */}
              <SignInGateProvider>
                <ShowtimeModalProvider>
                  <NotificationCenterProvider>
                    <RootLayourContent />
                  </NotificationCenterProvider>
                </ShowtimeModalProvider>
              </SignInGateProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Adds the error boundary that catches render-phase crashes anywhere in the
// tree. No-op when initSentry() found no DSN.
export default Sentry.wrap(RootLayout);
