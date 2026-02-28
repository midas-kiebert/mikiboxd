/**
 * Expo Router screen/module for (tabs) / _layout. It controls navigation and screen-level state for this route.
 */
import { Tabs } from 'expo-router';
import React, { useEffect, useRef } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';

import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { ApiError, MeService } from 'shared';
import { useFetchReceivedRequests } from 'shared/hooks/useFetchReceivedRequests';
import { useFetchUnseenShowtimePingCount } from 'shared/hooks/useFetchUnseenShowtimePingCount';
import useAuth from 'shared/hooks/useAuth';
import { storage } from 'shared/storage';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { registerPushTokenForCurrentDevice } from '@/utils/push-notifications';

const NOTIFICATION_PERMISSION_PROMPTED_KEY = 'mobile.notifications.permission_prompted_v3';
const NOTIFICATION_PREFS_INITIALIZED_KEY = 'mobile.notifications.preferences_initialized_v1';
const NOTIFICATION_PROMPT_DELAY_MS = 700;

export default function TabLayout() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  // Choose tab colors from the active light/dark palette.
  const colorScheme = useColorScheme();
  const palette = Colors[colorScheme ?? 'light'];
  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();
  // Data hooks keep this module synced with backend data and shared cache state.
  const { user } = useAuth();
  // Data hooks keep this module synced with backend data and shared cache state.
  const { data: receivedRequests } = useFetchReceivedRequests({ refetchIntervalMs: 15000 });
  const { data: unseenPingCount = 0 } = useFetchUnseenShowtimePingCount({
    enabled: !!user,
    refetchIntervalMs: 15000,
  });
  // Friends tab badge shows pending received requests, capped at "99+".
  const receivedCount = receivedRequests?.length ?? 0;
  const showFriendRequestsBadge = receivedCount > 0;
  const friendRequestsBadgeLabel = receivedCount > 99 ? '99+' : String(receivedCount);
  const showPingBadge = unseenPingCount > 0;
  const pingBadgeLabel = unseenPingCount > 99 ? '99+' : String(unseenPingCount);
  const isSyncingWatchlistRef = useRef(false);

  // Keep server watchlist state in sync when entering or returning to the app.
  useEffect(() => {
    if (!user || !user.letterboxd_username) return;

    const maybeSyncWatchlist = async () => {
      if (isSyncingWatchlistRef.current) return;

      try {
        isSyncingWatchlistRef.current = true;
        await MeService.syncWatchlist();

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['movies'] }),
          queryClient.invalidateQueries({ queryKey: ['movie'] }),
          queryClient.invalidateQueries({ queryKey: ['showtimes'] }),
        ]);
      } catch (error) {
        if (error instanceof ApiError && error.status === 429) {
          return;
        }
        console.error('Error syncing watchlist:', error);
      } finally {
        isSyncingWatchlistRef.current = false;
      }
    };

    void maybeSyncWatchlist();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void maybeSyncWatchlist();
    });

    return () => {
      appStateSubscription.remove();
    };
  }, [queryClient, user]);

  // Ask for notification permission right after login (when user context is available).
  useEffect(() => {
    if (!user) return;

    const maybePromptForNotificationPermission = async () => {
      const storageKey = `${NOTIFICATION_PERMISSION_PROMPTED_KEY}:${user.id}`;
      try {
        const alreadyPrompted = await storage.getItem(storageKey);
        const existingPermissions = await Notifications.getPermissionsAsync();
        if (alreadyPrompted === '1' && existingPermissions.status !== 'granted') {
          return;
        }

        await registerPushTokenForCurrentDevice();

        const finalPermissions = await Notifications.getPermissionsAsync();
        if (finalPermissions.status !== 'undetermined') {
          await storage.setItem(storageKey, '1');
        }
      } catch (error) {
        console.error('Error running notification permission onboarding:', error);
      }
    };

    // Delay slightly so the OS permission sheet is requested after initial tab mount/render.
    const timeout = setTimeout(() => {
      void maybePromptForNotificationPermission();
    }, NOTIFICATION_PROMPT_DELAY_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [user]);

  // Initialize default notification toggles once per user after profile data is loaded.
  useEffect(() => {
    if (!user) return;

    const maybeInitializeNotificationPreferences = async () => {
      const storageKey = `${NOTIFICATION_PREFS_INITIALIZED_KEY}:${user.id}`;
      try {
        const alreadyInitialized = await storage.getItem(storageKey);
        if (alreadyInitialized === '1') return;

        const hasAnyNotificationPreferenceEnabled =
          user.notify_on_friend_showtime_match ||
          user.notify_on_friend_requests ||
          user.notify_on_showtime_ping ||
          user.notify_on_interest_reminder;

        if (!hasAnyNotificationPreferenceEnabled) {
          await MeService.updateUserMe({
            requestBody: {
              notify_on_friend_showtime_match: true,
              notify_on_friend_requests: true,
              notify_on_showtime_ping: true,
              notify_on_interest_reminder: true,
            },
          });
          queryClient.invalidateQueries({ queryKey: ['currentUser'] });
        }

        await storage.setItem(storageKey, '1');
      } catch (error) {
        console.error('Error initializing notification preferences:', error);
      }
    };

    void maybeInitializeNotificationPreferences();
  }, [queryClient, user]);

  // Render/output using the state and derived values prepared above.
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.tint,
        headerShown: false,
        tabBarButton: HapticTab,
        sceneStyle: { backgroundColor: palette.background },
      }}>
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="movies"
        options={{
          title: 'Movies',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="film.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Showtimes',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="list.bullet.rectangle" color={color} />,
        }}
      />
      <Tabs.Screen
        name="pings"
        options={{
          title: 'Pings',
          tabBarIcon: ({ color }) => (
            <View style={styles.iconContainer}>
              <IconSymbol size={28} name="bell.fill" color={color} />
              {showPingBadge ? (
                <View style={[styles.badge, { backgroundColor: palette.notificationBadge }]}>
                  <Text style={styles.badgeText}>{pingBadgeLabel}</Text>
                </View>
              ) : null}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarIcon: ({ color }) => (
            <View style={styles.iconContainer}>
              <IconSymbol size={28} name="person.2.fill" color={color} />
              {/* Small notification badge on top of the tab icon. */}
              {showFriendRequestsBadge ? (
                <View style={[styles.badge, { backgroundColor: palette.notificationBadge }]}>
                  <Text style={styles.badgeText}>{friendRequestsBadgeLabel}</Text>
                </View>
              ) : null}
            </View>
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    position: 'relative',
    width: 28,
    height: 28,
  },
  badge: {
    position: 'absolute',
    top: -5,
    right: -8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    elevation: 2,
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
});
