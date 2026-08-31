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
import { useFetchLetterboxdLists } from 'shared/hooks/useLetterboxdLists';
import useAuth from 'shared/hooks/useAuth';
import { storage } from 'shared/storage';
import { DateTime } from 'luxon';

import { HapticTab, TabIcon, TabLabel } from '@/components/tab-bar';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  clearPushTokenRegistrationState,
  registerPushTokenForCurrentDevice,
} from '@/utils/push-notifications';
import { FiltersModalProvider } from '@/components/filters/FiltersModalProvider';
import { useIsIntroOwed } from '@/utils/intro';

const NOTIFICATION_PERMISSION_PROMPTED_KEY = 'mobile.notifications.permission_prompted_v3';
const NOTIFICATION_PREFS_INITIALIZED_KEY = 'mobile.notifications.preferences_initialized_v1';
const NOTIFICATION_PROMPT_DELAY_MS = 700;


// A Letterboxd sync that is throttled (429, still inside its cooldown) or that
// Letterboxd itself refused (503) is an expected outcome of foregrounding the
// app, not a bug: the server kept the previous data and will sync later.
const EXPECTED_SYNC_ERROR_STATUSES = [429, 503];

const isExpectedSyncError = (error: unknown): boolean =>
  error instanceof ApiError && EXPECTED_SYNC_ERROR_STATUSES.includes(error.status);

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
  // Every badge below counts something that belongs to an account, so for a
  // guest they are not merely empty — the queries behind them would 401 on a
  // fifteen-second loop. `user` is undefined without a session (useAuth reads
  // the stored token), which is what the rest of this file already gates on.
  const { data: receivedRequests } = useFetchReceivedRequests({
    enabled: !!user,
    refetchIntervalMs: 15000,
  });
  const { data: unseenPingCount = 0 } = useFetchUnseenShowtimePingCount({
    enabled: !!user,
    refetchIntervalMs: 15000,
  });
  const { data: letterboxdLists } = useFetchLetterboxdLists(!!user);
  const isSyncingListsRef = useRef(false);
  // Friends tab badge shows pending received requests, capped at "99+".
  const receivedCount = receivedRequests?.length ?? 0;
  const showFriendRequestsBadge = receivedCount > 0;
  const friendRequestsBadgeLabel = receivedCount > 99 ? '99+' : String(receivedCount);
  const showPingBadge = unseenPingCount > 0;
  const pingBadgeLabel = unseenPingCount > 99 ? '99+' : String(unseenPingCount);
  const isSyncingWatchlistRef = useRef(false);
  const lastRegisteredUserIdRef = useRef<string | null>(null);
  // A brand-new account still owes the intro, including the final filters
  // highlight; the OS permission prompt this effect can trigger waits for
  // both to be done, so a first run isn't interrupted by it.
  const isIntroOwed = useIsIntroOwed();

  // Keep server watchlist state in sync when entering or returning to the app.
  useEffect(() => {
    if (!user || !user.letterboxd_username) return;

    const maybeSyncWatchlist = async () => {
      if (isSyncingWatchlistRef.current) return;

      try {
        isSyncingWatchlistRef.current = true;

        try {
          await MeService.syncWatchlist();
        } catch (error) {
          if (!isExpectedSyncError(error)) {
            console.error('Error syncing watchlist:', error);
          }
        }

        try {
          await MeService.syncWatched();
        } catch (error) {
          if (!isExpectedSyncError(error)) {
            console.error('Error syncing watched list:', error);
          }
        }

        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['movies'] }),
          queryClient.invalidateQueries({ queryKey: ['movie'] }),
          queryClient.invalidateQueries({ queryKey: ['showtimes'] }),
        ]);
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

  // Refresh custom (non-curated) Letterboxd lists weekly, but only lazily: when
  // the user opens the app and a list hasn't been synced in over a week. Curated
  // lists are kept fresh server-side, so they are skipped here. The backend also
  // throttles, so an over-eager call is a cheap no-op.
  useEffect(() => {
    if (!user || !letterboxdLists) return;

    const staleCustomLists = letterboxdLists.filter(
      (list) =>
        !list.is_curated &&
        (!list.last_synced ||
          DateTime.now().diff(DateTime.fromISO(list.last_synced), 'days').days >= 7)
    );
    if (staleCustomLists.length === 0) return;

    const syncStaleLists = async () => {
      if (isSyncingListsRef.current) return;
      try {
        isSyncingListsRef.current = true;
        for (const list of staleCustomLists) {
          try {
            await MeService.syncLetterboxdList({ listId: list.id });
          } catch (error) {
            if (!(error instanceof ApiError && error.status === 429)) {
              console.error('Error syncing Letterboxd list:', error);
            }
          }
        }
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['me', 'letterboxd-lists'] }),
          queryClient.invalidateQueries({ queryKey: ['movies'] }),
          queryClient.invalidateQueries({ queryKey: ['showtimes'] }),
        ]);
      } finally {
        isSyncingListsRef.current = false;
      }
    };

    void syncStaleLists();
  }, [queryClient, user, letterboxdLists]);

  // Ask for notification permission once the user is known and the intro (if
  // any is owed) has fully finished, filters highlight included.
  useEffect(() => {
    if (!user || isIntroOwed) return;

    const maybePromptForNotificationPermission = async () => {
      const currentUserId = String(user.id);
      const hasSwitchedAccount = lastRegisteredUserIdRef.current !== currentUserId;
      const storageKey = `${NOTIFICATION_PERMISSION_PROMPTED_KEY}:${user.id}`;
      try {
        const prefsStorageKey = `${NOTIFICATION_PREFS_INITIALIZED_KEY}:${user.id}`;

        if (hasSwitchedAccount) {
          await storage.removeItem(storageKey);
          await storage.removeItem(prefsStorageKey);
          clearPushTokenRegistrationState();
          lastRegisteredUserIdRef.current = currentUserId;
        }

        // Registration prompts when permission is missing, so a refusal is
        // taken as an answer rather than asked again here: the intro's
        // notifications page and the notification-permission tip are where
        // the user gets asked a second time, both on purpose and with an
        // explanation attached. Without this, denying on the intro's last
        // page was followed by a bare system prompt seconds later.
        const permissionsBefore = await Notifications.getPermissionsAsync();
        if (permissionsBefore.status === 'denied') {
          await storage.setItem(storageKey, '1');
          return;
        }

        // Always attempt registration once user context exists.
        // This handles fresh installs, account switches, and OS-level permission changes.
        await registerPushTokenForCurrentDevice({ userId: currentUserId, force: true });
        const currentPermissions = await Notifications.getPermissionsAsync();
        if (currentPermissions.status !== 'undetermined') {
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
  }, [user, isIntroOwed]);

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
          user.notify_on_interest_reminder ||
          user.notify_on_seat_alert ||
          user.notify_on_sold_out;

        if (!hasAnyNotificationPreferenceEnabled) {
          await MeService.updateUserMe({
            requestBody: {
              notify_on_friend_showtime_match: true,
              notify_on_friend_requests: true,
              notify_on_showtime_ping: true,
              notify_on_interest_reminder: true,
              notify_on_seat_alert: true,
              notify_on_sold_out: true,
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
    <FiltersModalProvider>
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: palette.tabIconSelected,
        // Without this, React Navigation falls back to the navigation theme's
        // text colour for unselected tabs — near-black on the light theme, so
        // the selected tab barely stood out from the other four.
        tabBarInactiveTintColor: palette.tabIconDefault,
        headerShown: false,
        // The screens do not animate, and that is a decision rather than a
        // default. A slide was tried and dropped: the navigator's scenes are
        // absolutely stacked, clipped and re-ordered by focus, and every
        // variation on moving them produced an artifact — a cross-fade let the
        // container background show through both, no cross-fade let every
        // parked screen show through the gap, and a full-width slide left one
        // Android frame of bare background at the end, where the native driver
        // hands the transform back. What answers the tap is the bar itself
        // (see `tab-bar`), which moves in the frame it is pressed and owes
        // nothing to the screen underneath.
        sceneStyle: { backgroundColor: palette.background },
        tabBarStyle: {
          backgroundColor: palette.background,
          borderTopColor: palette.divider,
        },
      }}>
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarButton: (props) => <HapticTab {...props} tabKey="settings" />,
          tabBarIcon: () => <TabIcon tabKey="settings" name="gearshape.fill" />,
          tabBarLabel: () => <TabLabel tabKey="settings">Settings</TabLabel>,
        }}
      />
      <Tabs.Screen
        name="movies"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="index"
        options={{
          title: 'Showtimes',
          tabBarButton: (props) => <HapticTab {...props} tabKey="index" />,
          tabBarIcon: () => <TabIcon tabKey="index" name="list.bullet.rectangle" />,
          tabBarLabel: () => <TabLabel tabKey="index">Showtimes</TabLabel>,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarButton: (props) => <HapticTab {...props} tabKey="activity" />,
          tabBarLabel: () => <TabLabel tabKey="activity">Activity</TabLabel>,
          tabBarIcon: () => (
            <TabIcon tabKey="activity" name="bolt.fill">
              {/* An unseen invite is only visible in this tab's "You" mode
                  now that Agenda is gone, but it's still worth surfacing here. */}
              {showPingBadge ? (
                <View style={[styles.badge, { backgroundColor: palette.notificationBadge }]}>
                  <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
                    {pingBadgeLabel}
                  </Text>
                </View>
              ) : null}
            </TabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="friends"
        options={{
          title: 'Friends',
          tabBarButton: (props) => <HapticTab {...props} tabKey="friends" />,
          tabBarLabel: () => <TabLabel tabKey="friends">Friends</TabLabel>,
          tabBarIcon: () => (
            <TabIcon tabKey="friends" name="person.2.fill">
              {/* Small notification badge on top of the tab icon. */}
              {showFriendRequestsBadge ? (
                <View style={[styles.badge, { backgroundColor: palette.notificationBadge }]}>
                  {/* Capped: the badge is a fixed 18pt circle, so unbounded
                      font scaling pushes the count outside it. */}
                  <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
                    {friendRequestsBadgeLabel}
                  </Text>
                </View>
              ) : null}
            </TabIcon>
          ),
        }}
      />
    </Tabs>
    </FiltersModalProvider>
  );
}

const styles = StyleSheet.create({
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
