/**
 * Expo Router root layout. It wires global providers, auth-based redirects, and app-wide API config.
 */
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { OpenAPI } from 'shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { storage, setStorage } from 'shared/storage';
import * as SecureStore from 'expo-secure-store';
import { useSegments, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SystemUI from 'expo-system-ui';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { Colors } from '@/constants/theme';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios, { AxiosRequestTransformer } from 'axios'
import * as qs from 'qs'

export const unstable_settings = {
  anchor: '(tabs)',
};

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
        const reactNativeParts = (data as FormData & { _parts?: Array<[string, unknown]> })._parts
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
OpenAPI.BASE = "https://api.mikino.nl";

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

const queryClient = new QueryClient();

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
  // Router instance used for in-app navigation actions.
  const router = useRouter();
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  // Tracks whether auth state is still being resolved.
  const [isChecking, setIsChecking] = useState(true)
  // Tracks whether a valid access token exists.
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  // Keeps the previous token for dev logging without causing rerenders.
  const lastTokenRef = useRef<string | null>(null)

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
    } catch (error) {
      setIsAuthenticated(false)
    } finally {
      if (shouldBlock) setIsChecking(false)
    }
  }, [])

  useEffect(() => {
    // Initial blocking auth check before routing users.
    checkAuth(true)
  }, [checkAuth])

  useEffect(() => {
    if (isChecking) return
    // Re-check auth after navigation to catch token changes from other flows.
    checkAuth(false)
  }, [segments, checkAuth, isChecking])

  useEffect(() => {
    if (isChecking) return

    // Only these route groups require an authenticated session.
    const authRoutes = new Set(['(tabs)', 'movie', 'friend-showtimes', 'cinema-showtimes'])
    const inAuthGroup = authRoutes.has(segments[0])

    if (!isAuthenticated && inAuthGroup) {
      // User is not authenticated but trying to access protected routes
      console.log('Redirecting to login because user is not authenticated')
      router.replace('/login')
    } else if (isAuthenticated && !inAuthGroup) {
      console.log('Redirecting to home because user is authenticated')
      router.replace('/(tabs)')
    }
  }, [isAuthenticated, segments, isChecking])

  if (isChecking) {
    // Avoid flashing protected screens before auth status is known.
    return <View style={{ flex: 1, backgroundColor: palette.background }} />;
  }
  return (
    <>
      <Stack
        screenOptions={{
          contentStyle: { backgroundColor: palette.background },
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="movie/[id]"
          options={{
            headerShown: false,
            animation: 'none',
            contentStyle: { backgroundColor: palette.background },
          }}
        />
        <Stack.Screen
          name="friend-showtimes/[id]"
          options={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.background },
          }}
        />
        <Stack.Screen
          name="cinema-showtimes/[id]"
          options={{
            headerShown: false,
            contentStyle: { backgroundColor: palette.background },
          }}
        />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
    </>
  )
}








export default function RootLayout() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  // Theme mode selects the matching React Navigation theme object.
  const colorScheme = useColorScheme();
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

  // Render/output using the state and derived values prepared above.
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider value={theme}>
          <RootLayourContent />
        </ThemeProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
