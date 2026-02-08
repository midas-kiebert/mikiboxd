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

import { useColorScheme } from '@/hooks/use-color-scheme';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios, { AxiosRequestTransformer } from 'axios'
import * as qs from 'qs'

export const unstable_settings = {
  anchor: '(tabs)',
};

setStorage({
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
      const params: any = {}
      for (const [key, value] of data.entries()) {
        params[key] = value
      }
      return qs.stringify(params)
    }
    return data
  },
  ...defaultTransformers,
]

// OpenAPI.BASE = "http://192.168.1.121:8000";
OpenAPI.BASE = "https://api.mikino.nl";

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

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});



function RootLayourContent() {
  const segments = useSegments();
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const lastTokenRef = useRef<string | null>(null)

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
    checkAuth(true)
  }, [checkAuth])

  useEffect(() => {
    if (isChecking) return
    checkAuth(false)
  }, [segments, checkAuth, isChecking])

  useEffect(() => {
    if (isChecking) return

    const authRoutes = new Set(['(tabs)', 'movie'])
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
    return null; // or a loading spinner
  }
  return (
    <>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      <StatusBar style="auto" />
    </>
  )
}








export default function RootLayout() {
  const colorScheme = useColorScheme();

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <RootLayourContent />
      </ThemeProvider>
    </QueryClientProvider>
  );
}
