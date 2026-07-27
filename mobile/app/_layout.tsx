/**
 * Expo Router root layout. It wires global providers, auth-based redirects, and app-wide API config.
 */
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useRouter, useSegments, usePathname, withLayoutContext } from 'expo-router';
import { createStackNavigator, TransitionPresets, TransitionSpecs } from '@react-navigation/stack';
import { Appearance, Easing, Platform, View } from 'react-native';
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
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import UpdateRequiredScreen from '@/components/layout/UpdateRequiredScreen';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { loadThemePreference, useThemePreference } from '@/utils/theme-preference';
import { loadFeatureTips } from '@/utils/feature-tips';
import { loadIntroState, useIsIntroActive } from '@/utils/intro';
import { loadAuthSession, markSignedOut, useAuthStatus } from '@/utils/auth-session';
import IntroHost from '@/components/intro/IntroHost';
import { PENDING_DEEP_LINK_PATH_KEY } from '@/constants/pending-deep-link';
import AppSplash from '@/components/layout/AppSplash';
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
import useAuth from 'shared/hooks/useAuth';
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

// Configured once at startup so GoogleSignin.signIn() is ready wherever a
// sign-in button is rendered. webClientId sets the ID token audience, which
// the backend checks against settings.GOOGLE_CLIENT_IDS. Skipped entirely in
// Expo Go, which doesn't bundle this native module.
const googleWebClientId = Constants.expoConfig?.extra?.googleWebClientId as string | undefined;
if (isGoogleSignInAvailable && googleWebClientId) {
  getGoogleSignin().GoogleSignin.configure({ webClientId: googleWebClientId });
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

// When the backend rejects our stored token (401), the session is dead — the
// token is invalid/expired (or was issued by a different backend). Clear it and
// let the component-level redirect send the user back to login, rather than
// leaving them stuck on a blank screen that re-fires 401s forever.
const handleUnauthorized = (error: unknown) => {
  if (!(error instanceof ApiError) || error.status !== 401) return;
  void storage.removeItem('access_token');
  markSignedOut();
};

// Before a 401 becomes a logout, try to transparently refresh the access token.
// Only a failed refresh falls through to handleUnauthorized above.
installAuthRefreshInterceptor(() => {
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

// The one and only read of the stored token. Everything after this point is
// announced synchronously by whoever signs in or out — see `auth-session.ts`.
void loadAuthSession();

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
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  // Single source of truth for "is there a session", shared with the screens
  // that start and end one so this never disagrees with them mid-navigation.
  const authStatus = useAuthStatus()
  // True only until the stored token has been read once, at startup.
  const isChecking = authStatus === 'unknown'
  const isAuthenticated = authStatus === 'signed-in'
  // Splash gating: theme loaded, critical caches warmed, and whether the
  // branded overlay is still mounted.
  const [themeReady, setThemeReady] = useState(false)
  const [warmupDone, setWarmupDone] = useState(false)
  const [splashVisible, setSplashVisible] = useState(true)
  // Set once the backend 426s this build; renders UpdateRequiredScreen instead
  // of the app shell for the rest of the session (see onUpdateRequired above).
  const [updateRequiredInfo, setUpdateRequiredInfo] = useState<UpdateRequiredInfo | null>(null)
  const queryClient = useQueryClient();
  const hasHiddenNativeSplashRef = useRef(false)
  const { user } = useAuth();
  const userId = user?.id ? String(user.id) : undefined;
  const { trackEvent } = useTrackEvent();
  // Lets notification taps open the showtime modal in place instead of navigating.
  const { openShowtimeModalById } = useShowtimeModal();
  // Prevent duplicate handling when the same notification response is replayed.
  const handledNotificationResponsesRef = useRef<Set<string>>(new Set())
  // A notification tapped mid-walkthrough would otherwise navigate or open the
  // showtime modal right underneath the intro, which only reveals it once the
  // intro ends — so its routing waits for the intro to be out of the way.
  const isIntroActive = useIsIntroActive()
  const isIntroActiveRef = useRef(isIntroActive)
  useEffect(() => {
    isIntroActiveRef.current = isIntroActive
  }, [isIntroActive])
  const pendingNotificationRouteRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (isIntroActive) return
    const runPendingRoute = pendingNotificationRouteRef.current
    if (!runPendingRoute) return
    pendingNotificationRouteRef.current = null
    runPendingRoute()
  }, [isIntroActive])

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
      // The intro's first page is a full-screen cinema picker, and the cinema
      // filter needs the same list. Fetched here rather than when either one
      // mounts, so they open on a complete list instead of an empty box that
      // fills in a second later.
      prefetchCinemas(queryClient),
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
    if (isChecking) return

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

    // Two explicit lists rather than one and its inverse. A route that is in
    // neither is left alone, which is what `pick-username` needs: it is reached
    // *while* signing in, so it must neither demand a session it is halfway to
    // establishing nor be treated as a signed-out screen to be redirected away
    // from once one exists.
    const authRoutes = new Set(['(tabs)', 'movie', 'friend-showtimes', 'cinema-showtimes', 'add-friend', 'ping'])
    const signedOutRoutes = new Set(['login', 'signup', 'recover-password'])
    // Protected in release builds — the real flow only ever arrives already
    // signed in. In dev it stays neutral so the login screen's "Preview
    // pick-username screen" shortcut, taken while signed out, is not bounced
    // straight back to /login.
    if (!__DEV__) authRoutes.add('pick-username')

    if (!isAuthenticated && authRoutes.has(rootSegment)) {
      // User is not authenticated but trying to access protected routes
      console.log('Redirecting to login because user is not authenticated')
      // Remember the deep link (everything except the plain tabs home) so the
      // login flow can resume it after the user signs in.
      if (rootSegment !== '(tabs)') {
        void storage.setItem(PENDING_DEEP_LINK_PATH_KEY, pathname)
      }
      router.replace('/login')
    } else if (isAuthenticated && signedOutRoutes.has(rootSegment)) {
      console.log('Redirecting to home because user is authenticated')
      router.replace('/(tabs)')
    }
  }, [isAuthenticated, router, segments, pathname, isChecking])

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
        if (isIntroActiveRef.current) {
          pendingNotificationRouteRef.current = runRoute
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
        console.error('Error refreshing push token after token update:', error)
      })
    })

    return () => {
      pushTokenListener.remove()
    }
  }, [isAuthenticated, userId])

  // Reveal the app only once the shell is stable: theme resolved, auth known,
  // and critical caches warmed. The branded overlay covers everything until then.
  const appReady = themeReady && !isChecking && warmupDone;

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
        initialRouteName={isAuthenticated ? '(tabs)' : 'login'}
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
        <JsStack.Screen name="movie/[id]" />
        <JsStack.Screen name="friend-showtimes/[id]" />
        <JsStack.Screen name="cinema-showtimes/[id]" />
        <JsStack.Screen name="add-friend/[receiverId]" />
        <JsStack.Screen name="ping/[showtimeId]/[sender]" />
        <JsStack.Screen
          name="modal"
          options={{ presentation: 'modal', title: 'Modal', ...TransitionPresets.ModalSlideFromBottomIOS }}
        />
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
    </View>
  )
}








export default function RootLayout() {
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
              <ShowtimeModalProvider>
                <NotificationCenterProvider>
                  <RootLayourContent />
                </NotificationCenterProvider>
              </ShowtimeModalProvider>
            </ThemeProvider>
          </QueryClientProvider>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
