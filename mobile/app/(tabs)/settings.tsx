/**
 * Expo Router screen/module for (tabs) / settings. It controls navigation and screen-level state for this route.
 */
import { Alert, Linking, ScrollView, StyleSheet, Switch, TextInput, TouchableOpacity, View } from 'react-native';
import { useEffect, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';

import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/hooks/use-theme-color';
import TopBar from '@/components/layout/TopBar';
import useAuth from 'shared/hooks/useAuth';
import {
  MeService,
  type NotificationChannel,
  type UpdatePassword,
  type UserUpdate,
} from 'shared';
import { emailPattern } from 'shared/utils';
import { registerPushTokenForCurrentDevice } from '@/utils/push-notifications';

type ProfileState = {
  display_name: string;
  email: string;
  letterboxd_username: string;
};

type PasswordState = {
  current_password: string;
  new_password: string;
  confirm_password: string;
};

type NotificationPreferenceKey =
  | 'notify_on_friend_showtime_match'
  | 'notify_on_friend_requests'
  | 'notify_on_showtime_ping'
  | 'notify_on_interest_reminder';

type NotificationChannelPreferenceKey =
  | 'notify_channel_friend_showtime_match'
  | 'notify_channel_friend_requests'
  | 'notify_channel_showtime_ping'
  | 'notify_channel_interest_reminder';

type NotificationPreferencesState = Record<NotificationPreferenceKey, boolean>;
type NotificationChannelsState = Record<
  NotificationChannelPreferenceKey,
  NotificationChannel
>;

type NotificationPreferenceSource =
  | Partial<Record<NotificationPreferenceKey, boolean>>
  | null
  | undefined;

type NotificationChannelSource =
  | Partial<Record<NotificationChannelPreferenceKey, NotificationChannel | null>>
  | null
  | undefined;

const notificationPreferenceToChannelKey: Record<
  NotificationPreferenceKey,
  NotificationChannelPreferenceKey
> = {
  notify_on_friend_showtime_match: 'notify_channel_friend_showtime_match',
  notify_on_friend_requests: 'notify_channel_friend_requests',
  notify_on_showtime_ping: 'notify_channel_showtime_ping',
  notify_on_interest_reminder: 'notify_channel_interest_reminder',
};

const buildNotificationPreferencesState = (
  source: NotificationPreferenceSource
): NotificationPreferencesState => ({
  notify_on_friend_showtime_match: !!source?.notify_on_friend_showtime_match,
  notify_on_friend_requests: !!source?.notify_on_friend_requests,
  notify_on_showtime_ping: !!source?.notify_on_showtime_ping,
  notify_on_interest_reminder: !!source?.notify_on_interest_reminder,
});

const normalizeNotificationChannel = (
  value: NotificationChannel | null | undefined
): NotificationChannel => (value === 'email' ? 'email' : 'push');

const buildNotificationChannelsState = (
  source: NotificationChannelSource
): NotificationChannelsState => ({
  notify_channel_friend_showtime_match: normalizeNotificationChannel(
    source?.notify_channel_friend_showtime_match
  ),
  notify_channel_friend_requests: normalizeNotificationChannel(
    source?.notify_channel_friend_requests
  ),
  notify_channel_showtime_ping: normalizeNotificationChannel(
    source?.notify_channel_showtime_ping
  ),
  notify_channel_interest_reminder: normalizeNotificationChannel(
    source?.notify_channel_interest_reminder
  ),
});

export default function SettingsScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // Router instance used for in-app navigation actions.
  const router = useRouter();
  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();
  // Data hooks keep this module synced with backend data and shared cache state.
  const { user, logout } = useAuth(undefined, () => router.replace('/login'));

  // Editable form state for profile fields.
  const [profile, setProfile] = useState<ProfileState>({
    display_name: '',
    email: '',
    letterboxd_username: '',
  });
  // Editable form state for password fields.
  const [passwords, setPasswords] = useState<PasswordState>({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  // Current OS permission status for notifications.
  const [notificationPermissionStatus, setNotificationPermissionStatus] =
    useState<Notifications.PermissionStatus | null>(null);
  // Local notification toggle state so switches respond instantly.
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferencesState>(() => buildNotificationPreferencesState(user));
  // Local notification channel state per preference (push/email).
  const [notificationChannels, setNotificationChannels] =
    useState<NotificationChannelsState>(() => buildNotificationChannelsState(user));
  // Identifies which notification toggle is currently updating.
  const [pendingNotificationToggle, setPendingNotificationToggle] =
    useState<NotificationPreferenceKey | null>(null);
  // Identifies which notification channel is currently updating.
  const [pendingNotificationChannel, setPendingNotificationChannel] =
    useState<NotificationChannelPreferenceKey | null>(null);
  // True while logout request/cleanup is running.
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Populate editable form state once user data has loaded.
  useEffect(() => {
    if (!user) return;
    setProfile({
      display_name: user.display_name ?? '',
      email: user.email ?? '',
      letterboxd_username: user.letterboxd_username ?? '',
    });
  }, [user]);

  useEffect(() => {
    setNotificationPreferences(buildNotificationPreferencesState(user));
    setNotificationChannels(buildNotificationChannelsState(user));
  }, [user]);

  // Read the current OS-level notification permission status for friendly UI feedback.
  useEffect(() => {
    Notifications.getPermissionsAsync()
      .then((permissions) => setNotificationPermissionStatus(permissions.status))
      .catch((error) => {
        console.error('Error reading notification permissions:', error);
        setNotificationPermissionStatus(null);
      });
  }, []);

  // Profile updates are persisted to backend and then current-user cache is refreshed.
  const profileMutation = useMutation({
    mutationFn: (data: UserUpdate) => MeService.updateUserMe({ requestBody: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      Alert.alert('Success', 'Profile updated successfully.');
    },
    onError: (error) => {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Could not update profile.');
    },
  });

  // Password changes are isolated from profile updates so errors stay scoped.
  const passwordMutation = useMutation({
    mutationFn: (data: UpdatePassword) => MeService.updatePasswordMe({ requestBody: data }),
    onSuccess: () => {
      setPasswords({ current_password: '', new_password: '', confirm_password: '' });
      Alert.alert('Success', 'Password updated successfully.');
    },
    onError: (error) => {
      console.error('Error updating password:', error);
      Alert.alert('Error', 'Could not update password.');
    },
  });

  // Account deletion is destructive, so the user is logged out immediately after success.
  const deleteMutation = useMutation({
    mutationFn: () => MeService.deleteUserMe(),
    onSuccess: async () => {
      Alert.alert('Account deleted', 'Your account has been deleted.');
      await logout();
    },
    onError: (error) => {
      console.error('Error deleting account:', error);
      Alert.alert('Error', 'Could not delete account.');
    },
  });

  // Notification preference updates are persisted to the backend.
  const notificationPreferenceMutation = useMutation({
    mutationFn: (data: UserUpdate) =>
      MeService.updateUserMe({
        requestBody: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    },
    onError: (error) => {
      console.error('Error updating notification preferences:', error);
      Alert.alert('Error', 'Could not update notification preferences.');
    },
  });

  // Basic client-side validation prevents obvious round trips before API calls.
  const handleProfileSave = () => {
    if (!profile.email || !emailPattern.value.test(profile.email)) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }

    profileMutation.mutate({
      display_name: profile.display_name || null,
      email: profile.email,
      letterboxd_username: profile.letterboxd_username || null,
    });
  };

  // Keep password validation local so users get immediate feedback.
  const handlePasswordSave = () => {
    if (!passwords.current_password || !passwords.new_password) {
      Alert.alert('Missing fields', 'Please fill in all password fields.');
      return;
    }
    if (passwords.new_password.length < 8) {
      Alert.alert('Password too short', 'Password must be at least 8 characters.');
      return;
    }
    if (passwords.new_password !== passwords.confirm_password) {
      Alert.alert('Passwords do not match', 'Please confirm the new password.');
      return;
    }

    passwordMutation.mutate({
      current_password: passwords.current_password,
      new_password: passwords.new_password,
    });
  };

  // Run a confirmed destructive action and handle the result.
  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account',
      'This will permanently delete your account. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteMutation.mutate() },
      ]
    );
  };

  // Confirm logout and clear the local auth session.
  const handleLogout = () => {
    Alert.alert(
      'Log out',
      'Are you sure you want to log out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Log out',
          style: 'destructive',
          onPress: async () => {
            try {
              setIsLoggingOut(true);
              await logout();
            } finally {
              setIsLoggingOut(false);
            }
          },
        },
      ]
    );
  };

  const handleNotificationToggle = async (
    key: NotificationPreferenceKey,
    enabled: boolean
  ) => {
    if (!user) return;
    const channelKey = notificationPreferenceToChannelKey[key];
    const channel = notificationChannels[channelKey];
    const previousValue = notificationPreferences[key];
    setNotificationPreferences((previous) => ({
      ...previous,
      [key]: enabled,
    }));
    try {
      setPendingNotificationToggle(key);
      if (enabled && channel === 'push') {
        const token = await registerPushTokenForCurrentDevice();
        const permissions = await Notifications.getPermissionsAsync();
        setNotificationPermissionStatus(permissions.status);
        if (!token) {
          Alert.alert(
            'Enable notifications',
            'To receive notifications, allow them in your system settings.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open settings', onPress: () => Linking.openSettings() },
            ]
          );
          setNotificationPreferences((previous) => ({
            ...previous,
            [key]: previousValue,
          }));
          return;
        }
      }

      const updatedUser = await notificationPreferenceMutation.mutateAsync({
        [key]: enabled,
      });
      setNotificationPreferences(buildNotificationPreferencesState(updatedUser));
      setNotificationChannels(buildNotificationChannelsState(updatedUser));
    } catch (error) {
      console.error('Error toggling notification preference:', error);
      setNotificationPreferences((previous) => ({
        ...previous,
        [key]: previousValue,
      }));
      Alert.alert('Error', 'Could not update notification preferences.');
    } finally {
      setPendingNotificationToggle(null);
    }
  };

  const handleNotificationChannelChange = async (
    preferenceKey: NotificationPreferenceKey,
    channel: NotificationChannel
  ) => {
    if (!user) return;
    const channelKey = notificationPreferenceToChannelKey[preferenceKey];
    const previousChannel = notificationChannels[channelKey];
    if (previousChannel === channel) return;

    setNotificationChannels((previous) => ({
      ...previous,
      [channelKey]: channel,
    }));

    try {
      setPendingNotificationChannel(channelKey);
      if (channel === 'push' && notificationPreferences[preferenceKey]) {
        const token = await registerPushTokenForCurrentDevice();
        const permissions = await Notifications.getPermissionsAsync();
        setNotificationPermissionStatus(permissions.status);
        if (!token) {
          Alert.alert(
            'Enable notifications',
            'To receive push notifications, allow them in your system settings.',
            [
              { text: 'Not now', style: 'cancel' },
              { text: 'Open settings', onPress: () => Linking.openSettings() },
            ]
          );
          setNotificationChannels((previous) => ({
            ...previous,
            [channelKey]: previousChannel,
          }));
          return;
        }
      }

      const updatedUser = await notificationPreferenceMutation.mutateAsync({
        [channelKey]: channel,
      });
      setNotificationPreferences(buildNotificationPreferencesState(updatedUser));
      setNotificationChannels(buildNotificationChannelsState(updatedUser));
    } catch (error) {
      console.error('Error changing notification channel:', error);
      setNotificationChannels((previous) => ({
        ...previous,
        [channelKey]: previousChannel,
      }));
      Alert.alert('Error', 'Could not update notification delivery channel.');
    } finally {
      setPendingNotificationChannel(null);
    }
  };

  const isProfileSaving = profileMutation.isPending;
  const isPasswordSaving = passwordMutation.isPending;
  const isUpdatingNotifications = notificationPreferenceMutation.isPending;
  const notificationToggles: {
    key: NotificationPreferenceKey;
    channelKey: NotificationChannelPreferenceKey;
    label: string;
    description: string;
    value: boolean;
    channel: NotificationChannel;
  }[] = [
    {
      key: 'notify_on_friend_showtime_match',
      channelKey: 'notify_channel_friend_showtime_match',
      label: 'Friend showtime updates',
      description: 'When friends change Going/Interested status on your shared showtimes.',
      value: notificationPreferences.notify_on_friend_showtime_match,
      channel: notificationChannels.notify_channel_friend_showtime_match,
    },
    {
      key: 'notify_on_showtime_ping',
      channelKey: 'notify_channel_showtime_ping',
      label: 'Showtime pings',
      description: 'When a friend pings you to join a specific showtime.',
      value: notificationPreferences.notify_on_showtime_ping,
      channel: notificationChannels.notify_channel_showtime_ping,
    },
    {
      key: 'notify_on_interest_reminder',
      channelKey: 'notify_channel_interest_reminder',
      label: 'Interested reminders',
      description: 'Reminder before showtimes you marked as Interested.',
      value: notificationPreferences.notify_on_interest_reminder,
      channel: notificationChannels.notify_channel_interest_reminder,
    },
    {
      key: 'notify_on_friend_requests',
      channelKey: 'notify_channel_friend_requests',
      label: 'Friend requests',
      description: 'When you receive a friend request or someone accepts yours.',
      value: notificationPreferences.notify_on_friend_requests,
      channel: notificationChannels.notify_channel_friend_requests,
    },
  ];

  // Render/output using the state and derived values prepared above.
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title="Settings" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>My profile</ThemedText>
          <View style={styles.card}>
            <ThemedText style={styles.label}>Full name</ThemedText>
            <TextInput
              style={styles.input}
              value={profile.display_name}
              onChangeText={(value) => setProfile((prev) => ({ ...prev, display_name: value }))}
              placeholder="Your name"
              placeholderTextColor={colors.textSecondary}
            />
            <ThemedText style={styles.label}>Email</ThemedText>
            <TextInput
              style={styles.input}
              value={profile.email}
              onChangeText={(value) => setProfile((prev) => ({ ...prev, email: value }))}
              placeholder="you@example.com"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            <ThemedText style={styles.label}>Letterboxd username</ThemedText>
            <TextInput
              style={styles.input}
              value={profile.letterboxd_username}
              onChangeText={(value) =>
                setProfile((prev) => ({ ...prev, letterboxd_username: value }))
              }
              placeholder="letterboxd"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[styles.primaryButton, isProfileSaving && styles.buttonDisabled]}
              onPress={handleProfileSave}
              disabled={isProfileSaving}
            >
              <ThemedText style={styles.primaryButtonText}>
                {isProfileSaving ? 'Saving...' : 'Save profile'}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Password</ThemedText>
          <View style={styles.card}>
            <ThemedText style={styles.label}>Current password</ThemedText>
            <TextInput
              style={styles.input}
              value={passwords.current_password}
              onChangeText={(value) => setPasswords((prev) => ({ ...prev, current_password: value }))}
              placeholder="Current password"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
            />
            <ThemedText style={styles.label}>New password</ThemedText>
            <TextInput
              style={styles.input}
              value={passwords.new_password}
              onChangeText={(value) => setPasswords((prev) => ({ ...prev, new_password: value }))}
              placeholder="New password"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
            />
            <ThemedText style={styles.label}>Confirm password</ThemedText>
            <TextInput
              style={styles.input}
              value={passwords.confirm_password}
              onChangeText={(value) => setPasswords((prev) => ({ ...prev, confirm_password: value }))}
              placeholder="Confirm password"
              placeholderTextColor={colors.textSecondary}
              secureTextEntry
            />
            <TouchableOpacity
              style={[styles.primaryButton, isPasswordSaving && styles.buttonDisabled]}
              onPress={handlePasswordSave}
              disabled={isPasswordSaving}
            >
              <ThemedText style={styles.primaryButtonText}>
                {isPasswordSaving ? 'Saving...' : 'Update password'}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Appearance</ThemedText>
          <View style={styles.card}>
            <ThemedText style={styles.helperText}>Appearance follows your system setting.</ThemedText>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Notifications</ThemedText>
          <View style={styles.card}>
            <ThemedText style={styles.helperText}>
              Choose which notification types you want to receive.
            </ThemedText>
            {notificationPermissionStatus ? (
              <ThemedText style={styles.helperText}>
                System permission: {notificationPermissionStatus === 'granted' ? 'Allowed' : 'Not allowed'}.
              </ThemedText>
            ) : null}
            {notificationToggles.map((toggle) => (
              <View key={toggle.key} style={styles.notificationToggleRow}>
                <View style={styles.notificationToggleHeader}>
                  <View style={styles.notificationToggleTextContainer}>
                    <ThemedText style={styles.notificationToggleTitle}>{toggle.label}</ThemedText>
                    <ThemedText style={styles.notificationToggleDescription}>
                      {toggle.description}
                    </ThemedText>
                  </View>
                  <Switch
                    value={toggle.value}
                    onValueChange={(value) => void handleNotificationToggle(toggle.key, value)}
                    disabled={
                      !user || isUpdatingNotifications || pendingNotificationToggle === toggle.key
                    }
                    trackColor={{ false: colors.divider, true: colors.tint }}
                    thumbColor="#ffffff"
                  />
                </View>
                <View style={styles.notificationChannelRow}>
                  <ThemedText style={styles.notificationChannelLabel}>Delivery</ThemedText>
                  <View style={styles.notificationChannelPill}>
                    <TouchableOpacity
                      style={[
                        styles.notificationChannelOption,
                        styles.notificationChannelOptionLeft,
                        toggle.channel === 'push' && styles.notificationChannelOptionActive,
                      ]}
                      onPress={() => void handleNotificationChannelChange(toggle.key, 'push')}
                      disabled={
                        !user ||
                        isUpdatingNotifications ||
                        pendingNotificationChannel === toggle.channelKey
                      }
                      activeOpacity={0.8}
                    >
                      <ThemedText
                        style={[
                          styles.notificationChannelOptionText,
                          toggle.channel === 'push' && styles.notificationChannelOptionTextActive,
                        ]}
                      >
                        Push
                      </ThemedText>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.notificationChannelOption,
                        styles.notificationChannelOptionRight,
                        toggle.channel === 'email' && styles.notificationChannelOptionActive,
                      ]}
                      onPress={() => void handleNotificationChannelChange(toggle.key, 'email')}
                      disabled={
                        !user ||
                        isUpdatingNotifications ||
                        pendingNotificationChannel === toggle.channelKey
                      }
                      activeOpacity={0.8}
                    >
                      <ThemedText
                        style={[
                          styles.notificationChannelOptionText,
                          toggle.channel === 'email' && styles.notificationChannelOptionTextActive,
                        ]}
                      >
                        Email
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}
            {notificationPermissionStatus === 'denied' ? (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => Linking.openSettings()}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.secondaryButtonText}>Open system notification settings</ThemedText>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Account</ThemedText>
          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.secondaryButton, isLoggingOut && styles.buttonDisabled]}
              onPress={handleLogout}
              disabled={isLoggingOut}
            >
              <ThemedText style={styles.secondaryButtonText}>
                {isLoggingOut ? 'Logging out...' : 'Log out'}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Danger zone</ThemedText>
          <View style={styles.card}>
            <ThemedText style={styles.helperText}>
              Permanently delete your account and all associated data.
            </ThemedText>
            <TouchableOpacity
              style={[styles.dangerButton, deleteMutation.isPending && styles.buttonDisabled]}
              onPress={handleDeleteAccount}
              disabled={deleteMutation.isPending}
            >
              <ThemedText style={styles.dangerButtonText}>
                {deleteMutation.isPending ? 'Deleting...' : 'Delete account'}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: 16,
      gap: 20,
    },
    section: {
      gap: 12,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 12,
      gap: 10,
    },
    label: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      color: colors.text,
      backgroundColor: colors.background,
    },
    primaryButton: {
      marginTop: 4,
      backgroundColor: colors.tint,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
    },
    primaryButtonText: {
      color: '#fff',
      fontWeight: '700',
    },
    secondaryButton: {
      marginTop: 4,
      backgroundColor: colors.pillBackground,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
    },
    secondaryButtonText: {
      color: colors.text,
      fontWeight: '700',
    },
    dangerButton: {
      marginTop: 4,
      backgroundColor: colors.red.primary,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
    },
    dangerButtonText: {
      color: colors.red.secondary,
      fontWeight: '700',
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    helperText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    notificationToggleRow: {
      gap: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 9,
      backgroundColor: colors.background,
    },
    notificationToggleHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    notificationToggleTextContainer: {
      flex: 1,
      gap: 2,
    },
    notificationToggleTitle: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
    notificationToggleDescription: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    notificationChannelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    notificationChannelLabel: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    notificationChannelPill: {
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 999,
      backgroundColor: colors.pillBackground,
      padding: 2,
    },
    notificationChannelOption: {
      minWidth: 72,
      paddingVertical: 6,
      paddingHorizontal: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 999,
    },
    notificationChannelOptionLeft: {
      marginRight: 2,
    },
    notificationChannelOptionRight: {
      marginLeft: 2,
    },
    notificationChannelOptionActive: {
      backgroundColor: colors.tint,
    },
    notificationChannelOptionText: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    notificationChannelOptionTextActive: {
      color: '#ffffff',
    },
  });
