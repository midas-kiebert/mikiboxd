/**
 * Expo Router screen/module for (tabs) / settings. It controls navigation and screen-level state for this route.
 */
import {
  Alert,
  Animated,
  LayoutAnimation,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { EXPAND_DURATION_MS, EXPAND_LAYOUT_ANIMATION } from '@/utils/expand-animation';
import { triggerSelectionHaptic } from '@/utils/long-press';
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  CINEVILLE_DIGITS_LENGTH,
  CINEVILLE_PREFIX,
  deleteCinevilleCard,
  loadCinevilleCardDigits,
  saveCinevilleCardDigits,
} from '@/utils/cineville-card';

import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/hooks/use-theme-color';
import TopBar from '@/components/layout/TopBar';
import { type ThemePreference, useThemePreference } from '@/utils/theme-preference';
import {
  restoreDismissedTips,
  useDismissedTipCount,
  useFeatureTipsEnabled,
} from '@/utils/feature-tips';
import { startIntro } from '@/utils/intro';
import { markSignedOut } from '@/utils/auth-session';
import useAuth from 'shared/hooks/useAuth';
import {
  MeService,
  type CinemaPresetPublic,
  type DigestFrequency,
  type UpdatePassword,
  type UserUpdate,
} from 'shared';
import { useFetchLetterboxdLists } from 'shared/hooks/useLetterboxdLists';
import { emailPattern, usernameMaxLength, usernamePattern } from 'shared/utils';
import { unregisterPushTokenForCurrentDevice } from '@/utils/push-notifications';
import NotificationPreferenceList from '@/components/notifications/NotificationPreferenceList';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { openSystemSettings, useNotificationPreferences } from '@/hooks/useNotificationPreferences';

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

export default function SettingsScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [themePreference, setThemePreference] = useThemePreference();
  const [featureTipsEnabled, setFeatureTipsEnabled] = useFeatureTipsEnabled();
  const dismissedTipCount = useDismissedTipCount();
  // Router instance used for in-app navigation actions.
  const router = useRouter();
  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();
  // Data hooks keep this module synced with backend data and shared cache state.
  // markSignedOut and the navigation go together, in that order: the route
  // guard has to agree the session is over before it sees us on /login, or it
  // will bounce straight back into the tabs. See utils/auth-session.ts.
  const { user, logout } = useAuth(undefined, () => {
    markSignedOut();
    router.replace('/login');
  });
  // The intro normally runs once, for a brand-new account. Superusers get the
  // replay button in release builds too, so it can be checked on a real device
  // without making an account for every run.
  const canReplayIntro = __DEV__ || Boolean(user?.is_superuser);

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
  // The notification preferences, their delivery channels and the OS permission
  // state, shared with the notification-permission tip.
  const notificationPreferences = useNotificationPreferences();
  // Local state for the watchlist new-showtime email digest setting.
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestFrequency, setDigestFrequency] =
    useState<DigestFrequency>('weekly_or_urgent');
  const [digestListId, setDigestListId] = useState<string | null>(null);
  // null = follow the favorite cinema preset; a uuid = pin a specific preset.
  const [digestCinemaPresetId, setDigestCinemaPresetId] = useState<string | null>(null);
  const [digestAdvancedOpen, setDigestAdvancedOpen] = useState(false);
  const [isUpdatingDigest, setIsUpdatingDigest] = useState(false);
  // Lists and cinema presets are only needed once the advanced picker is opened.
  const { data: digestLists = [] } = useFetchLetterboxdLists(digestAdvancedOpen);
  const { data: cinemaPresets = [] } = useQuery<CinemaPresetPublic[]>({
    queryKey: ['cinema-presets'],
    queryFn: () => MeService.getCinemaPresets(),
    enabled: digestAdvancedOpen,
  });
  // The preset the digest follows when no specific one is pinned.
  const favoriteCinemaPreset = cinemaPresets.find((preset) => preset.is_favorite);
  // The backend prepends a synthetic "All Cinemas" preset to every list, and it
  // is not a real row — `_resolve_digest_cinema_ids` cannot look it up, so
  // picking it did nothing except sit next to this section's own "all cinemas"
  // option as a case-mismatched duplicate. The sentinel below already covers
  // it, so it is dropped here rather than offered twice.
  const selectableCinemaPresets = useMemo(
    () => cinemaPresets.filter((preset) => !preset.is_default),
    [cinemaPresets]
  );
  // True while logout request/cleanup is running.
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // Cineville card number (9 digits only, CP$ prefix is added automatically).
  const [cinevilleDigits, setCinevilleDigits] = useState('');
  const [isSavingCineville, setIsSavingCineville] = useState(false);
  // Confirmations for the two irreversible actions on this screen. Themed
  // dialogs rather than Alert.alert, which is app-wide reserved for pure error
  // toasts — a native alert is the one surface in the app that ignores the
  // user's light/dark choice.
  const [isDeleteDialogVisible, setIsDeleteDialogVisible] = useState(false);
  const [isLogoutDialogVisible, setIsLogoutDialogVisible] = useState(false);
  // The danger zone is collapsed by default so it takes an extra, deliberate
  // tap to reach account deletion.
  const [isDangerZoneOpen, setIsDangerZoneOpen] = useState(false);
  const dangerCaretRotation = useRef(new Animated.Value(0)).current;
  // The ScrollView is scrolled to the end once the danger zone expands, so the
  // newly revealed card is never left cut off below the fold.
  const scrollViewRef = useRef<ScrollView>(null);
  const dangerCaretSpin = useMemo(
    () => dangerCaretRotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }),
    [dangerCaretRotation]
  );
  const toggleDangerZone = useCallback(() => {
    triggerSelectionHaptic();
    const next = !isDangerZoneOpen;
    Animated.timing(dangerCaretRotation, {
      toValue: next ? 1 : 0,
      duration: EXPAND_DURATION_MS,
      useNativeDriver: true,
    }).start();
    LayoutAnimation.configureNext(EXPAND_LAYOUT_ANIMATION);
    setIsDangerZoneOpen(next);
    if (next) {
      setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), EXPAND_DURATION_MS);
    }
  }, [isDangerZoneOpen, dangerCaretRotation]);
  // Whether the account already has a password set (false for social-only sign-in).
  const hasPassword = user?.has_password ?? true;

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
    setDigestEnabled(!!user?.notify_watchlist_digest_enabled);
    setDigestFrequency(user?.notify_watchlist_digest_frequency ?? 'weekly_or_urgent');
    setDigestListId(user?.notify_watchlist_digest_list_id ?? null);
    setDigestCinemaPresetId(user?.notify_watchlist_digest_cinema_preset_id ?? null);
  }, [
    user?.notify_watchlist_digest_enabled,
    user?.notify_watchlist_digest_frequency,
    user?.notify_watchlist_digest_list_id,
    user?.notify_watchlist_digest_cinema_preset_id,
  ]);

  // Load the saved Cineville card digits from device storage.
  useEffect(() => {
    loadCinevilleCardDigits()
      .then((digits) => setCinevilleDigits(digits ?? ''))
      .catch(() => {});
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

  // Generic user-update used by the watchlist digest controls below.
  const digestMutation = useMutation({
    mutationFn: (data: UserUpdate) =>
      MeService.updateUserMe({
        requestBody: data,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    },
    onError: (error) => {
      console.error('Error updating watchlist digest settings:', error);
      Alert.alert('Error', 'Could not update watchlist digest settings.');
    },
  });

  // Basic client-side validation prevents obvious round trips before API calls.
  const handleProfileSave = () => {
    if (!profile.email || !emailPattern.value.test(profile.email)) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    const normalizedUsername = profile.display_name.trim();
    const normalizedCurrentUsername = user?.display_name?.trim() ?? '';
    const isUsernameChanged =
      normalizedUsername.toLowerCase() !== normalizedCurrentUsername.toLowerCase();
    if (isUsernameChanged && normalizedUsername && !usernamePattern.value.test(normalizedUsername)) {
      Alert.alert('Invalid username', usernamePattern.message);
      return;
    }

    profileMutation.mutate({
      display_name: normalizedUsername || null,
      email: profile.email,
      letterboxd_username: profile.letterboxd_username || null,
    });
  };

  // Keep password validation local so users get immediate feedback.
  const handlePasswordSave = () => {
    if ((hasPassword && !passwords.current_password) || !passwords.new_password) {
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
      current_password: hasPassword ? passwords.current_password : null,
      new_password: passwords.new_password,
    });
  };

  // Run a confirmed destructive action and handle the result.
  const handleConfirmDeleteAccount = () => {
    setIsDeleteDialogVisible(false);
    deleteMutation.mutate();
  };

  // Confirm logout and clear the local auth session.
  const handleConfirmLogout = async () => {
    setIsLogoutDialogVisible(false);
    try {
      // Painted before the request goes out, so the button reflects the tap
      // rather than the round trip.
      setIsLoggingOut(true);
      await unregisterPushTokenForCurrentDevice();
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  // Applies a watchlist-digest field optimistically, then persists it; rolls back on failure.
  const handleDigestUpdate = async (
    data: UserUpdate,
    applyOptimistic: () => void,
    rollback: () => void
  ) => {
    applyOptimistic();
    try {
      setIsUpdatingDigest(true);
      await digestMutation.mutateAsync(data);
    } catch (error) {
      rollback();
      console.error('Error updating watchlist digest settings:', error);
      Alert.alert('Error', 'Could not update watchlist digest settings.');
    } finally {
      setIsUpdatingDigest(false);
    }
  };

  const handleDigestToggle = (enabled: boolean) => {
    const previous = digestEnabled;
    void handleDigestUpdate(
      { notify_watchlist_digest_enabled: enabled },
      () => setDigestEnabled(enabled),
      () => setDigestEnabled(previous)
    );
  };

  const handleDigestFrequencyChange = (frequency: DigestFrequency) => {
    if (frequency === digestFrequency) return;
    const previous = digestFrequency;
    void handleDigestUpdate(
      { notify_watchlist_digest_frequency: frequency },
      () => setDigestFrequency(frequency),
      () => setDigestFrequency(previous)
    );
  };

  const handleDigestListChange = (listId: string | null) => {
    if (listId === digestListId) return;
    const previous = digestListId;
    void handleDigestUpdate(
      { notify_watchlist_digest_list_id: listId },
      () => setDigestListId(listId),
      () => setDigestListId(previous)
    );
  };

  const handleDigestCinemaPresetChange = (presetId: string | null) => {
    if (presetId === digestCinemaPresetId) return;
    const previous = digestCinemaPresetId;
    void handleDigestUpdate(
      { notify_watchlist_digest_cinema_preset_id: presetId },
      () => setDigestCinemaPresetId(presetId),
      () => setDigestCinemaPresetId(previous)
    );
  };

  const handleSaveCinevilleCard = async () => {
    const trimmed = cinevilleDigits.trim();
    if (trimmed && !/^\d{9}$/.test(trimmed)) {
      Alert.alert('Invalid card number', `Card number must be exactly ${CINEVILLE_DIGITS_LENGTH} digits.`);
      return;
    }
    try {
      setIsSavingCineville(true);
      if (trimmed) {
        await saveCinevilleCardDigits(trimmed);
      } else {
        await deleteCinevilleCard();
      }
      Alert.alert('Saved', trimmed ? 'Cineville card saved on this device.' : 'Cineville card removed.');
    } catch {
      Alert.alert('Error', 'Could not save Cineville card.');
    } finally {
      setIsSavingCineville(false);
    }
  };

  const isProfileSaving = profileMutation.isPending;
  const isPasswordSaving = passwordMutation.isPending;

  // Render/output using the state and derived values prepared above.
  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar title="Settings" />
      {/* automaticallyAdjustKeyboardInsets (iOS-only) keeps the focused field
          above the keyboard — without it the password/Cineville fields near the
          bottom of this long form are covered on a small phone. */}
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.content}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>My profile</ThemedText>
          <View style={styles.card}>
            <ThemedText style={styles.label}>Username</ThemedText>
            <TextInput
              style={styles.input}
              value={profile.display_name}
              onChangeText={(value) => setProfile((prev) => ({ ...prev, display_name: value }))}
              placeholder="username"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={usernameMaxLength}
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
            <ThemedText style={styles.label}>Letterboxd username for watchlist (will update periodically)</ThemedText>
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
          <ThemedText style={styles.sectionTitle}>Appearance</ThemedText>
          <View style={styles.card}>
            <View style={styles.appearanceRow}>
              {(['light', 'dark', 'system'] as ThemePreference[]).map((option, index, arr) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.appearanceOption,
                    index === 0 && styles.appearanceOptionLeft,
                    index === arr.length - 1 && styles.appearanceOptionRight,
                    themePreference === option && styles.appearanceOptionActive,
                  ]}
                  onPress={() => setThemePreference(option)}
                  activeOpacity={0.8}
                >
                  <ThemedText
                    style={[
                      styles.appearanceOptionText,
                      themePreference === option && styles.appearanceOptionTextActive,
                    ]}
                  >
                    {option === 'light' ? 'Light' : option === 'dark' ? 'Dark' : 'System'}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {canReplayIntro ? (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Developer</ThemedText>
            <View style={styles.card}>
              <ThemedText style={styles.helperText}>
                Replays the first-run intro from page one. The last step (the Filters highlight)
                appears on the showtimes tab once its list has loaded.
              </ThemedText>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => {
                  // Settings is its own tab; land on showtimes first so the
                  // walkthrough starts and ends in the same place it would
                  // for a real first run.
                  router.replace('/(tabs)');
                  startIntro();
                }}
              >
                <ThemedText style={styles.secondaryButtonText}>Replay the intro</ThemedText>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Cineville</ThemedText>
          <View style={styles.card}>
            <ThemedText style={styles.helperText}>
              Your Cineville card number is stored only on this device and never shared. It will be copied into your clipboard when you press a ticket link.
            </ThemedText>
            <ThemedText style={styles.label}>Card number</ThemedText>
            <View style={styles.cinevilleInputRow}>
              <View style={styles.cinevillePrefix}>
                <ThemedText style={styles.cinevillePrefixText}>{CINEVILLE_PREFIX}</ThemedText>
              </View>
              <TextInput
                style={[styles.input, styles.cinevilleInput]}
                value={cinevilleDigits}
                onChangeText={(value) => setCinevilleDigits(value.replace(/\D/g, '').slice(0, CINEVILLE_DIGITS_LENGTH))}
                placeholder="000000000"
                placeholderTextColor={colors.textSecondary}
                keyboardType="number-pad"
                maxLength={CINEVILLE_DIGITS_LENGTH}
                autoCorrect={false}
              />
            </View>
            <TouchableOpacity
              style={[styles.primaryButton, isSavingCineville && styles.buttonDisabled]}
              onPress={() => void handleSaveCinevilleCard()}
              disabled={isSavingCineville}
            >
              <ThemedText style={styles.primaryButtonText}>
                {isSavingCineville ? 'Saving...' : 'Save card'}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Notifications</ThemedText>
          <View style={styles.card}>
            <ThemedText style={styles.helperText}>
              Choose which notification types you want to receive.
            </ThemedText>
            <NotificationPreferenceList controller={notificationPreferences} />
            <View style={styles.notificationToggleRow}>
              <View style={styles.notificationToggleHeader}>
                <View style={styles.notificationToggleTextContainer}>
                  <ThemedText style={styles.notificationToggleTitle}>Watchlist digest</ThemedText>
                  <ThemedText style={styles.notificationToggleDescription}>
                    Email me when a watchlisted movie gets a showtime it didn&apos;t have before.
                  </ThemedText>
                </View>
                {/* No thumbColor override: a hardcoded white grip vanished
                    against the light theme's near-white "off" track (and lost
                    its iOS drop shadow). The platform default follows the
                    app's scheme, which _layout pushes to the native layer. */}
                <Switch
                  value={digestEnabled}
                  onValueChange={(value) => handleDigestToggle(value)}
                  disabled={!user || isUpdatingDigest}
                  trackColor={{ false: colors.divider, true: colors.tint }}
                />
              </View>
              <View style={styles.notificationChannelRow}>
                <ThemedText style={styles.notificationChannelLabel}>Frequency</ThemedText>
                <View style={styles.notificationChannelPill}>
                  <TouchableOpacity
                    style={[
                      styles.notificationChannelOption,
                      styles.notificationChannelOptionLeft,
                      digestFrequency === 'daily' && styles.notificationChannelOptionActive,
                    ]}
                    onPress={() => handleDigestFrequencyChange('daily')}
                    disabled={!user || isUpdatingDigest}
                    activeOpacity={0.8}
                  >
                    <ThemedText
                      style={[
                        styles.notificationChannelOptionText,
                        digestFrequency === 'daily' && styles.notificationChannelOptionTextActive,
                      ]}
                    >
                      Daily
                    </ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.notificationChannelOption,
                      styles.notificationChannelOptionRight,
                      digestFrequency === 'weekly_or_urgent' &&
                        styles.notificationChannelOptionActive,
                    ]}
                    onPress={() => handleDigestFrequencyChange('weekly_or_urgent')}
                    disabled={!user || isUpdatingDigest}
                    activeOpacity={0.8}
                  >
                    <ThemedText
                      style={[
                        styles.notificationChannelOptionText,
                        digestFrequency === 'weekly_or_urgent' &&
                          styles.notificationChannelOptionTextActive,
                      ]}
                    >
                      Smart
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => setDigestAdvancedOpen((previous) => !previous)}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.digestAdvancedToggle}>
                  {digestAdvancedOpen ? 'Hide advanced' : 'Advanced: list & cinemas'}
                </ThemedText>
              </TouchableOpacity>
              {digestAdvancedOpen ? (
                <>
                  <ThemedText style={styles.notificationChannelLabel}>Source</ThemedText>
                  <View style={styles.digestListOptions}>
                    <TouchableOpacity
                      style={[
                        styles.digestListOption,
                        digestListId === null && styles.digestListOptionActive,
                      ]}
                      onPress={() => handleDigestListChange(null)}
                      disabled={!user || isUpdatingDigest}
                      activeOpacity={0.8}
                    >
                      <ThemedText
                        style={[
                          styles.digestListOptionText,
                          digestListId === null && styles.digestListOptionTextActive,
                        ]}
                      >
                        My watchlist
                      </ThemedText>
                    </TouchableOpacity>
                    {digestLists.map((list) => (
                      <TouchableOpacity
                        key={list.id}
                        style={[
                          styles.digestListOption,
                          digestListId === list.id && styles.digestListOptionActive,
                        ]}
                        onPress={() => handleDigestListChange(list.id)}
                        disabled={!user || isUpdatingDigest}
                        activeOpacity={0.8}
                      >
                        <ThemedText
                          style={[
                            styles.digestListOptionText,
                            digestListId === list.id && styles.digestListOptionTextActive,
                          ]}
                        >
                          {list.title ?? list.list_slug}
                          {list.is_curated ? ' (curated)' : ''}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                  <ThemedText style={styles.notificationChannelLabel}>Cinemas</ThemedText>
                  <View style={styles.digestListOptions}>
                    <TouchableOpacity
                      style={[
                        styles.digestListOption,
                        digestCinemaPresetId === null && styles.digestListOptionActive,
                      ]}
                      onPress={() => handleDigestCinemaPresetChange(null)}
                      disabled={!user || isUpdatingDigest}
                      activeOpacity={0.8}
                    >
                      <ThemedText
                        style={[
                          styles.digestListOptionText,
                          digestCinemaPresetId === null && styles.digestListOptionTextActive,
                        ]}
                      >
                        {favoriteCinemaPreset
                          ? `Default (${favoriteCinemaPreset.name})`
                          : 'All cinemas'}
                      </ThemedText>
                    </TouchableOpacity>
                    {selectableCinemaPresets.map((preset) => (
                      <TouchableOpacity
                        key={preset.id}
                        style={[
                          styles.digestListOption,
                          digestCinemaPresetId === preset.id && styles.digestListOptionActive,
                        ]}
                        onPress={() => handleDigestCinemaPresetChange(preset.id)}
                        disabled={!user || isUpdatingDigest}
                        activeOpacity={0.8}
                      >
                        <ThemedText
                          style={[
                            styles.digestListOptionText,
                            digestCinemaPresetId === preset.id &&
                              styles.digestListOptionTextActive,
                          ]}
                        >
                          {preset.name}
                          {preset.is_favorite ? ' (favorite)' : ''}
                        </ThemedText>
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              ) : null}
            </View>
            {notificationPreferences.permissionStatus === 'denied' ? (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => void openSystemSettings()}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.secondaryButtonText}>Open system notification settings</ThemedText>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Tips</ThemedText>
          <View style={styles.card}>
            <View style={styles.notificationToggleHeader}>
              <View style={styles.notificationToggleTextContainer}>
                <ThemedText style={styles.notificationToggleTitle}>Feature tips</ThemedText>
                <ThemedText style={styles.notificationToggleDescription}>
                  Occasional reminders about features you are not using yet.
                </ThemedText>
              </View>
              <Switch
                value={featureTipsEnabled}
                onValueChange={setFeatureTipsEnabled}
                trackColor={{ false: colors.divider, true: colors.tint }}
              />
            </View>
            {dismissedTipCount > 0 ? (
              <TouchableOpacity style={styles.secondaryButton} onPress={restoreDismissedTips}>
                <ThemedText style={styles.secondaryButtonText}>
                  {`Show the ${dismissedTipCount} hidden tip${dismissedTipCount === 1 ? '' : 's'} again`}
                </ThemedText>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>{hasPassword ? 'Password' : 'Add password'}</ThemedText>
          <View style={styles.card}>
            {hasPassword ? (
              <>
                <ThemedText style={styles.label}>Current password</ThemedText>
                <TextInput
                  style={styles.input}
                  value={passwords.current_password}
                  onChangeText={(value) => setPasswords((prev) => ({ ...prev, current_password: value }))}
                  placeholder="Current password"
                  placeholderTextColor={colors.textSecondary}
                  secureTextEntry
                />
              </>
            ) : (
              <ThemedText style={styles.helperText}>
                Your account signed in with Apple or Google and has no password yet. Add
                one to also be able to log in with your email.
              </ThemedText>
            )}
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
                {isPasswordSaving ? 'Saving...' : hasPassword ? 'Update password' : 'Add password'}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Account</ThemedText>
          <View style={styles.card}>
            <TouchableOpacity
              style={[styles.secondaryButton, isLoggingOut && styles.buttonDisabled]}
              onPress={() => setIsLogoutDialogVisible(true)}
              disabled={isLoggingOut}
            >
              <ThemedText style={styles.secondaryButtonText}>
                {isLoggingOut ? 'Logging out...' : 'Log out'}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>About</ThemedText>
          <View style={styles.card}>
            <ThemedText style={styles.helperText}>
              This product uses the TMDB API but is not endorsed or certified by TMDB.
            </ThemedText>
            <ThemedText style={styles.helperText}>
              MiKiNO is not affiliated with Letterboxd, Cineville, or any of the cinemas listed in
              the app.
            </ThemedText>
          </View>
        </View>

        <View style={styles.section}>
          <TouchableOpacity
            style={styles.dangerZoneHeader}
            onPress={toggleDangerZone}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: isDangerZoneOpen }}
          >
            <ThemedText style={styles.sectionTitle}>Danger zone</ThemedText>
            <Animated.View style={{ transform: [{ rotate: dangerCaretSpin }] }}>
              <MaterialIcons name="expand-more" size={22} color={colors.textSecondary} />
            </Animated.View>
          </TouchableOpacity>
          {isDangerZoneOpen ? (
            <View style={[styles.card, styles.dangerCard]}>
              <ThemedText style={styles.dangerHelperText}>
                Permanently delete your account and all associated data. Your friends,
                showtime selections and invites go with it. This cannot be undone.
              </ThemedText>
              <TouchableOpacity
                style={[styles.dangerButton, deleteMutation.isPending && styles.buttonDisabled]}
                onPress={() => setIsDeleteDialogVisible(true)}
                disabled={deleteMutation.isPending}
                activeOpacity={0.8}
                accessibilityRole="button"
              >
                <ThemedText style={styles.dangerButtonText}>
                  {deleteMutation.isPending ? 'Deleting...' : 'Delete account'}
                </ThemedText>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <ConfirmDialog
        visible={isLogoutDialogVisible}
        icon="logout"
        title="Log out?"
        message="You will need to sign in again on this device."
        confirmLabel="Log out"
        cancelLabel="Cancel"
        onConfirm={() => void handleConfirmLogout()}
        onCancel={() => setIsLogoutDialogVisible(false)}
      />
      <ConfirmDialog
        visible={isDeleteDialogVisible}
        icon="delete-forever"
        title="Delete account?"
        message="This permanently deletes your account and everything in it. It cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDeleteAccount}
        onCancel={() => setIsDeleteDialogVisible(false)}
      />
    </TopSafeAreaView>
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
      // Extra bottom room so the expanded danger zone card is never left
      // clipped under the tab bar / home indicator, and so its button is not
      // pressed up against the edge of the screen once it has scrolled to.
      paddingBottom: 72,
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
    // A bare text+caret row was a cramped target at the very bottom of a long
    // form. Padded out to a full-height row so it can be hit without aiming.
    dangerZoneHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 48,
      paddingHorizontal: 4,
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
      color: colors.pillActiveText,
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
    // Roomier than the shared card: this is the one place in Settings where a
    // mis-tap is unrecoverable, so the explanation and the button each get
    // space of their own instead of being packed into a 12pt box.
    dangerCard: {
      padding: 18,
      gap: 16,
      borderColor: colors.red.secondary,
    },
    dangerHelperText: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textSecondary,
    },
    dangerButton: {
      backgroundColor: colors.red.primary,
      borderWidth: 1,
      borderColor: colors.red.secondary,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dangerButtonText: {
      fontSize: 15,
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
      lineHeight: 15,
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
      color: colors.pillActiveText,
    },
    digestAdvancedToggle: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.tint,
    },
    digestListOptions: {
      gap: 6,
    },
    digestListOption: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      backgroundColor: colors.pillBackground,
    },
    digestListOptionActive: {
      borderColor: colors.tint,
      backgroundColor: colors.tint,
    },
    digestListOptionText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
    },
    digestListOptionTextActive: {
      color: colors.pillActiveText,
    },
    cinevilleInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 0,
    },
    cinevillePrefix: {
      borderWidth: 1,
      borderRightWidth: 0,
      borderColor: colors.cardBorder,
      borderTopLeftRadius: 8,
      borderBottomLeftRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 10,
      backgroundColor: colors.pillBackground,
      justifyContent: 'center',
    },
    cinevillePrefixText: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    cinevilleInput: {
      flex: 1,
      borderTopLeftRadius: 0,
      borderBottomLeftRadius: 0,
    },
    appearanceRow: {
      flexDirection: 'row' as const,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 999,
      backgroundColor: colors.pillBackground,
      padding: 2,
    },
    appearanceOption: {
      flex: 1,
      paddingVertical: 8,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderRadius: 999,
    },
    appearanceOptionLeft: {},
    appearanceOptionRight: {},
    appearanceOptionActive: {
      backgroundColor: colors.tint,
    },
    appearanceOptionText: {
      fontSize: 13,
      fontWeight: '700' as const,
      color: colors.textSecondary,
    },
    appearanceOptionTextActive: {
      color: colors.pillActiveText,
    },
  });
