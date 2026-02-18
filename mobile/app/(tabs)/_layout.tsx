/**
 * Expo Router screen/module for (tabs) / _layout. It controls navigation and screen-level state for this route.
 */
import { Tabs } from 'expo-router';
import React, { useEffect } from 'react';
import { Alert, Linking, StyleSheet, Text, View } from 'react-native';

import { useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { MeService } from 'shared';
import { useFetchReceivedRequests } from 'shared/hooks/useFetchReceivedRequests';
import useAuth from 'shared/hooks/useAuth';
import { storage } from 'shared/storage';

import { HapticTab } from '@/components/haptic-tab';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { registerPushTokenForCurrentDevice } from '@/utils/push-notifications';

const NOTIFICATION_ONBOARDING_KEY = 'mobile.notifications.onboarding_prompted';

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
  // Friends tab badge shows pending received requests, capped at "99+".
  const receivedCount = receivedRequests?.length ?? 0;
  const showBadge = receivedCount > 0;
  const badgeLabel = receivedCount > 99 ? '99+' : String(receivedCount);

  // One-time friendly prompt to enable notifications for new installs.
  useEffect(() => {
    if (!user) return;

    const maybePrompt = async () => {
      try {
        const storageKey = `${NOTIFICATION_ONBOARDING_KEY}:${user.id}`;
        const alreadyPrompted = await storage.getItem(storageKey);
        if (alreadyPrompted === '1') return;

        // Mark as prompted immediately to prevent repeat alerts across rerenders/restarts.
        await storage.setItem(storageKey, '1');

        if (user.notify_on_friend_showtime_match) return;

        Alert.alert(
          'Enable notifications?',
          'Get a notification when a friend marks Going or Interested for a showtime you also selected.',
          [
            { text: 'Not now', style: 'cancel' },
            {
              text: 'Enable',
              onPress: async () => {
                try {
                  const token = await registerPushTokenForCurrentDevice();
                  const permissions = await Notifications.getPermissionsAsync();

                  if (!token) {
                    Alert.alert(
                      'Permission required',
                      'To receive notifications, allow them in your system settings.',
                      permissions.status === 'denied'
                        ? [
                            { text: 'Not now', style: 'cancel' },
                            { text: 'Open settings', onPress: () => Linking.openSettings() },
                          ]
                        : [{ text: 'OK' }]
                    );
                    return;
                  }

                  await MeService.updateUserMe({
                    requestBody: { notify_on_friend_showtime_match: true },
                  });
                  queryClient.invalidateQueries({ queryKey: ['currentUser'] });
                  Alert.alert('Notifications enabled', 'You’ll get friend overlap updates.');
                } catch (error) {
                  console.error('Error enabling notifications:', error);
                  Alert.alert('Error', 'Could not enable notifications.');
                }
              },
            },
          ]
        );
      } catch (error) {
        console.error('Error running notification onboarding prompt:', error);
      }
    };

    void maybePrompt();
  }, [queryClient, user]);

  // Render/output using the state and derived values prepared above.
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.tint,
        headerShown: false,
        tabBarButton: HapticTab,
      }}>
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="gearshape.fill" color={color} />,
        }}
      />

      <Tabs.Screen
        name="agenda"
        options={{
          title: 'Agenda',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="calendar" color={color} />,
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
        name="movies"
        options={{
          title: 'Movies',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="film.fill" color={color} />,
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
              {showBadge ? (
                <View style={[styles.badge, { backgroundColor: palette.notificationBadge }]}>
                  <Text style={styles.badgeText}>{badgeLabel}</Text>
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
