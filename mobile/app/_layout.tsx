/**
 * Expo Router root layout. It wires global providers, auth-based redirects, and app-wide API config.
 */
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useRouter, useSegments, usePathname, withLayoutContext } from 'expo-router';
import { createStackNavigator, TransitionPresets, TransitionSpecs } from '@react-navigation/stack';
import { Appearance, Easing , View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { ApiError, OpenAPI, installAuthRefreshInterceptor } from 'shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { storage, setStorage } from 'shared/storage';
import * as SecureStore from 'expo-secure-store';
import * as Notifications from 'expo-notifications';
import * as SystemUI from 'expo-system-ui';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';
import { loadThemePreference, useThemePreference } from '@/utils/theme-preference';
import { PENDING_DEEP_LINK_PATH_KEY } from '@/constants/pending-deep-link';
import AppSplash from '@/components/layout/AppSplash';
import {
  displayPresetOrderQueryKey,
  displayPresetsQueryKey,
  fetchDisplayPresets,
  loadDisplayPresetOrder,
} from '@/components/filters/saved-presets';
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
let onUnauthorized: (() => void) | null = null;
const handleUnauthorized = (error: unknown) => {
  if (!(error instanceof ApiError) || error.status !== 401) return;
  void storage.removeItem('access_token');
  onUnauthorized?.();
};

// Before a 401 becomes a logout, try to transparently refresh the access token.
// Only a failed refresh falls through to handleUnauthorized above.
installAuthRefreshInterceptor(() => {
  onUnauthorized?.();
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
  // Tracks whether auth state is still being resolved.
  const [isChecking, setIsChecking] = useState(true)
  // Tracks whether a valid access token exists.
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  // Splash gating: theme loaded, critical caches warmed, and whether the
  // branded overlay is still mounted.
  const [themeReady, setThemeReady] = useState(false)
  const [warmupDone, setWarmupDone] = useState(false)
  const [splashVisible, setSplashVisible] = useState(true)
  const queryClient = useQueryClient();
  const hasHiddenNativeSplashRef = useRef(false)
  const { user } = useAuth();
  const userId = user?.id ? String(user.id) : undefined;
  // Lets notification taps open the showtime modal in place instead of navigating.
  const { openShowtimeModalById } = useShowtimeModal();
  // Keeps the previous token for dev logging without causing rerenders.
  const lastTokenRef = useRef<string | null>(null)
  // Prevent duplicate handling when the same notification response is replayed.
  const handledNotificationResponsesRef = useRef<Set<string>>(new Set())

  // Shared auth check used on mount and whenever route segments change.
  const checkAuth = useCallback(async (shouldBlock = false) => {
    if (shouldBlock) setIsChecking(true)
    try {
      const token = await SecureStore.getItemAsync('access_token')
      if (__DEV__ && token !== lastTokenRef.current) {
        console.log('Checked auth token:', token)
        lastTokenRef.current = token
      }
      setIsAuthenticated(!!token)
    } catch {
      setIsAuthenticated(false)
    } finally {
      if (shouldBlock) setIsChecking(false)
    }
  }, [])

  useEffect(() => {
    // Pre-load detail route modules so first navigation to each is instant.
    void import('./movie/[id]');
    void import('./friend-showtimes/[id]');
    void import('./cinema-showtimes/[id]');
  }, []);

  useEffect(() => {
    // Initial blocking auth check before routing users.
    checkAuth(true)
  }, [checkAuth])

  useEffect(() => {
    // Let the query/mutation caches force a logout when the API returns 401
    // (the stored token has been removed by then). Flipping auth state here
    // triggers the redirect-to-login effect below.
    onUnauthorized = () => {
      lastTokenRef.current = null
      setIsAuthenticated(false)
    }
    return () => {
      onUnauthorized = null
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
    // Re-check auth after navigation to catch token changes from other flows.
    checkAuth(false)
  }, [segments, checkAuth, isChecking])

  useEffect(() => {
    if (isChecking) return

    const segmentPath = segments as unknown as string[]
    const rootSegment = segmentPath[0]
    // Only these route groups require an authenticated session.
    const authRoutes = new Set(['(tabs)', 'movie', 'friend-showtimes', 'cinema-showtimes', 'add-friend', 'ping'])
    const inAuthGroup = rootSegment ? authRoutes.has(rootSegment) : false

    if (!isAuthenticated && inAuthGroup) {
      // User is not authenticated but trying to access protected routes
      console.log('Redirecting to login because user is not authenticated')
      // Remember the deep link (everything except the plain tabs home) so the
      // login flow can resume it after the user signs in.
      if (rootSegment !== '(tabs)') {
        void storage.setItem(PENDING_DEEP_LINK_PATH_KEY, pathname)
      }
      router.replace('/login')
    } else if (isAuthenticated && !inAuthGroup) {
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
        if (modalShowtimeId !== null) {
          openShowtimeModalById(modalShowtimeId)
        } else {
          const route = resolveNotificationRoute(data)
          if (route) {
            router.push(route)
          }
        }
      }

      try {
        await Notifications.clearLastNotificationResponseAsync()
      } catch (error) {
        console.error('Error clearing last notification response:', error)
      }
    },
    [router, openShowtimeModalById]
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

  return (
    <View style={{ flex: 1, backgroundColor: palette.background }}>
      {!isChecking && (
        <>
      <JsStack
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
