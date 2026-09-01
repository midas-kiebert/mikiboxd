/**
 * Expo Router screen/module for (tabs) / settings. It controls navigation and screen-level state for this route.
 */
import {
  ActivityIndicator,
  Alert,
  Animated,
  LayoutAnimation,
  type LayoutChangeEvent,
  Linking,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { EXPAND_DURATION_MS, EXPAND_LAYOUT_ANIMATION } from '@/utils/expand-animation';
import { triggerSelectionHaptic } from '@/utils/long-press';
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import {
  CINEVILLE_DIGITS_LENGTH,
  CINEVILLE_PREFIX,
  deleteCinevilleCard,
  loadCinevilleCardDigits,
  saveCinevilleCardDigits,
  useCinevilleCardDigits,
} from '@/utils/cineville-card';
import {
  setCinevilleShortcutEnabled,
  useCinevilleShortcutEnabled,
} from '@/utils/cineville-shortcuts';

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
import { markSignedOut, useIsSignedIn } from '@/utils/auth-session';
import useAuth from 'shared/hooks/useAuth';
import { MeService, type ApiError, type UpdatePassword, type UserUpdate } from 'shared';
import { emailPattern, handleError, usernameMaxLength, usernamePattern } from 'shared/utils';
import { unregisterPushTokenForCurrentDevice } from '@/utils/push-notifications';
import NotificationPreferenceList from '@/components/notifications/NotificationPreferenceList';
import LetterboxdSection from '@/components/settings/LetterboxdSection';
import WatchlistDigestSourcesSection from '@/components/settings/WatchlistDigestSourcesSection';
import SignedOutPanel from '@/components/auth/SignedOutPanel';
import CinevilleCardModal from '@/components/cineville/CinevilleCardModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import AppSwitch from '@/components/ui/AppSwitch';
import SegmentedControl, { type SegmentedOption } from '@/components/ui/SegmentedControl';
import EmailVerificationRequiredDialog from '@/components/ui/EmailVerificationRequiredDialog';
import { useEmailVerificationPolling } from '@/hooks/useCurrentUser';
import { openSystemSettings, useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { PRIVACY_POLICY_URL, SUPPORT_PAGE_URL } from '@/constants/legal-links';
import TabScreenSkeleton from '@/components/layout/TabScreenSkeleton';
import { tabContentHoldMs } from '@/components/tab-bar';
import { useDeferredMount } from '@/utils/use-deferred-mount';

// Placeholder for the danger zone card's height until it has been measured
// once. Sized from the card's own styles (18pt padding top and bottom, roughly
// four 19pt lines of helper text, a 16pt gap, and the ~48pt delete button).
const DANGER_CARD_ESTIMATED_HEIGHT = 178;
// Vertical gap the section puts between the danger zone header and its card,
// mirroring `section.gap` — the card costs this on top of its own height.
const SECTION_GAP = 12;
// Bottom room the content always keeps, so the last card is never clipped under
// the tab bar / home indicator.
const CONTENT_PADDING_BOTTOM = 72;

const THEME_OPTIONS: readonly SegmentedOption<ThemePreference>[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

type ProfileState = {
  display_name: string;
  email: string;
  current_password: string;
};

type PasswordState = {
  current_password: string;
  new_password: string;
  confirm_password: string;
};

function SettingsScreen() {
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
  // Settings is two things stacked: preferences that belong to this device
  // (appearance, the Cineville card, the legal notices) and preferences that
  // belong to an account (profile, notifications, Letterboxd, the account
  // itself). A guest gets the first set, which works exactly as it does for
  // anyone else, and an offer where the second would be.
  const isSignedIn = useIsSignedIn();
  // The intro normally runs once, for a brand-new account. Superusers get the
  // replay button in release builds too, so it can be checked on a real device
  // without making an account for every run.
  const canReplayIntro = __DEV__ || Boolean(user?.is_superuser);

  // Editable form state for profile fields.
  const [profile, setProfile] = useState<ProfileState>({
    display_name: '',
    email: '',
    current_password: '',
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
  // Local state for the watchlist new-showtime email digest master switch.
  // Per-source settings (frequency, list, cinemas) live in
  // `WatchlistDigestSourcesSection` and its own `useWatchlistDigestSources`.
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestAdvancedOpen, setDigestAdvancedOpen] = useState(false);
  const [isUpdatingDigest, setIsUpdatingDigest] = useState(false);
  // "See friends of friends" privacy opt-in (Privacy section below).
  const [showFriendsOfFriends, setShowFriendsOfFriends] = useState(false);
  const [isUpdatingFriendsOfFriends, setIsUpdatingFriendsOfFriends] = useState(false);
  // True while logout request/cleanup is running.
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  // Cineville card number (9 digits only, CP$ prefix is added automatically).
  const [cinevilleDigits, setCinevilleDigits] = useState('');
  const [isSavingCineville, setIsSavingCineville] = useState(false);
  // The number as it is actually stored, which is what the barcode shows —
  // `cinevilleDigits` is the draft in the input and may not be saved yet.
  const savedCinevilleDigits = useCinevilleCardDigits();
  const [isCinevilleCardVisible, setIsCinevilleCardVisible] = useState(false);
  // Which feeds the floating pass shortcut is allowed to appear on.
  const isShortcutOnShowtimes = useCinevilleShortcutEnabled('showtimes');
  const isShortcutOnActivity = useCinevilleShortcutEnabled('activity');
  // Confirmations for the two irreversible actions on this screen. Themed
  // dialogs rather than Alert.alert, which is app-wide reserved for pure error
  // toasts — a native alert is the one surface in the app that ignores the
  // user's light/dark choice.
  const [isDeleteDialogVisible, setIsDeleteDialogVisible] = useState(false);
  const [isLogoutDialogVisible, setIsLogoutDialogVisible] = useState(false);
  const [isEmailVerificationRequired, setIsEmailVerificationRequired] = useState(false);
  // Shown after a save that changed the email: the backend sends a fresh
  // confirmation link to the new address, and nothing else on screen says so.
  const [verificationSentTo, setVerificationSentTo] = useState<string | null>(null);
  // The address the last save started from, so the mutation's success handler
  // can tell an email change from a username-only one. A ref rather than the
  // user object: by then the account query has been invalidated.
  const emailBeforeSaveRef = useRef('');
  // While the address is unconfirmed the account is re-read every few seconds,
  // so opening the link in a mail app turns the badge over while Settings is
  // still on screen. The returned flag drives the spinner next to it.
  // Only while Settings is the screen being looked at: this tab stays mounted
  // behind the others, and a poll nobody can see is just traffic.
  const isSettingsFocused = useIsFocused();
  const isCheckingVerification = useEmailVerificationPolling(
    isSettingsFocused && isSignedIn && user !== undefined && !user.email_verified
  );
  // The danger zone is collapsed by default so it takes an extra, deliberate
  // tap to reach account deletion.
  const [isDangerZoneOpen, setIsDangerZoneOpen] = useState(false);
  const dangerCaretRotation = useRef(new Animated.Value(0)).current;
  // The ScrollView is scrolled to the end once the danger zone expands, so the
  // newly revealed card is never left cut off below the fold.
  const scrollViewRef = useRef<ScrollView>(null);
  // While collapsed, the exact height the expanded card will take is held open
  // as blank space below the header, so expanding leaves the total content
  // height unchanged: someone already scrolled to the bottom sees the card
  // appear in place instead of being scrolled further. The height is measured
  // on the card's first layout; until then an estimate close to the real card
  // (18pt padding + ~4 lines of helper text + 16pt gap + 48pt button) keeps the
  // very first expansion from jumping either.
  const [dangerCardHeight, setDangerCardHeight] = useState(DANGER_CARD_ESTIMATED_HEIGHT);
  const handleDangerCardLayout = useCallback((event: LayoutChangeEvent) => {
    setDangerCardHeight(event.nativeEvent.layout.height);
  }, []);
  // Nothing to reserve room for when the danger zone isn't rendered at all,
  // which is the guest's Settings — the space would just be a gap at the end.
  const dangerZoneReservedSpace = isSignedIn ? dangerCardHeight + SECTION_GAP : 0;
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
    // Preserves whatever's currently typed into current_password — this
    // effect also re-fires on unrelated user-cache refreshes, and clearing a
    // field mid-edit that the user didn't just submit would be its own bug.
    setProfile((prev) => ({
      ...prev,
      display_name: user.display_name ?? '',
      email: user.email ?? '',
    }));
  }, [user]);

  useEffect(() => {
    setDigestEnabled(!!user?.notify_watchlist_digest_enabled);
  }, [user?.notify_watchlist_digest_enabled]);

  useEffect(() => {
    setShowFriendsOfFriends(!!user?.show_friends_of_friends_interest);
  }, [user?.show_friends_of_friends_interest]);

  // Load the saved Cineville card digits from device storage.
  useEffect(() => {
    loadCinevilleCardDigits()
      .then((digits) => setCinevilleDigits(digits ?? ''))
      .catch(() => {});
  }, []);

  // Profile updates are persisted to backend and then current-user cache is refreshed.
  const profileMutation = useMutation({
    mutationFn: (data: UserUpdate) => MeService.updateUserMe({ requestBody: data }),
    onSuccess: (_data, variables) => {
      setProfile((prev) => ({ ...prev, current_password: '' }));
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
      const newEmail = variables.email?.trim() ?? '';
      const emailChanged =
        newEmail !== '' &&
        newEmail.toLowerCase() !== emailBeforeSaveRef.current.trim().toLowerCase();
      // A changed address is unconfirmed again and gets a link sent to it. That
      // is the part the user has to act on, so it replaces the plain "saved"
      // notice rather than stacking a second dialog behind it.
      if (emailChanged) {
        setVerificationSentTo(newEmail);
        return;
      }
      Alert.alert('Success', 'Profile updated successfully.');
    },
    onError: (error) => {
      console.error('Error updating profile:', error);
      // The server's own words: "that username is taken" and "that email is
      // taken" are both things the user can act on, and a flat "could not
      // update profile" told them neither.
      Alert.alert('Error', handleError(error as ApiError));
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
    // Changing username or email now requires confirming the current
    // password, mirroring the password card below — an account with none
    // yet has nothing to confirm with, so it has to set one first.
    if (!hasPassword) {
      Alert.alert(
        'Password required',
        'Set a password below before you can change your username or email.'
      );
      return;
    }
    if (!profile.current_password) {
      Alert.alert('Missing fields', 'Enter your current password to save these changes.');
      return;
    }
    if (!profile.email || !emailPattern.value.test(profile.email)) {
      Alert.alert('Invalid email', 'Please enter a valid email address.');
      return;
    }
    const normalizedUsername = profile.display_name.trim();
    const normalizedCurrentUsername = user?.display_name?.trim() ?? '';
    const isUsernameChanged =
      normalizedUsername.toLowerCase() !== normalizedCurrentUsername.toLowerCase();
    // Saving an empty field used to clear the username, which is the one thing
    // an account may never be without — friends find and recognise each other
    // by it. The backend refuses it too; this is so the refusal is not the
    // first the user hears of it.
    if (!normalizedUsername) {
      Alert.alert('Username required', 'Your account needs a username.');
      return;
    }
    if (isUsernameChanged && !usernamePattern.value.test(normalizedUsername)) {
      Alert.alert('Invalid username', usernamePattern.message);
      return;
    }

    emailBeforeSaveRef.current = user?.email ?? '';
    profileMutation.mutate({
      display_name: normalizedUsername,
      email: profile.email,
      current_password: profile.current_password,
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

  const handleOpenPrivacyPolicy = () => {
    triggerSelectionHaptic();
    void Linking.openURL(PRIVACY_POLICY_URL);
  };

  const handleOpenSupport = () => {
    triggerSelectionHaptic();
    void Linking.openURL(SUPPORT_PAGE_URL);
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
    // Nothing is sent to an address nobody has confirmed, so the backend
    // refuses this until then (403). Said here rather than let through as a
    // failed save, because "could not update" would not tell the user the one
    // thing they need to do about it.
    if (enabled && !user?.email_verified) {
      setIsEmailVerificationRequired(true);
      return;
    }
    const previous = digestEnabled;
    void handleDigestUpdate(
      { notify_watchlist_digest_enabled: enabled },
      () => setDigestEnabled(enabled),
      () => setDigestEnabled(previous)
    );
  };

  const handleFriendsOfFriendsToggle = async (enabled: boolean) => {
    const previous = showFriendsOfFriends;
    setShowFriendsOfFriends(enabled);
    try {
      setIsUpdatingFriendsOfFriends(true);
      await digestMutation.mutateAsync({ show_friends_of_friends_interest: enabled });
    } catch (error) {
      setShowFriendsOfFriends(previous);
      console.error('Error updating friends-of-friends preference:', error);
      Alert.alert('Error', 'Could not update this setting.');
    } finally {
      setIsUpdatingFriendsOfFriends(false);
    }
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
      <TopBar title="Settings" icon="gearshape.fill" />
      {/* automaticallyAdjustKeyboardInsets (iOS-only) keeps the focused field
          above the keyboard — without it the password/Cineville fields near the
          bottom of this long form are covered on a small phone. */}
      <ScrollView
        ref={scrollViewRef}
        contentContainerStyle={[
          styles.content,
          !isDangerZoneOpen && { paddingBottom: CONTENT_PADDING_BOTTOM + dangerZoneReservedSpace },
        ]}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
      >
        {!isSignedIn ? (
          <View style={styles.section}>
            <SignedOutPanel feature="profile" variant="card" />
          </View>
        ) : null}

        {isSignedIn ? (
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
            <View style={styles.emailLabelRow}>
              <ThemedText style={styles.label}>Email</ThemedText>
              {user?.email_verified ? (
                <View style={styles.emailStatus}>
                  <MaterialIcons name="check-circle" size={13} color={colors.green.secondary} />
                  <ThemedText style={[styles.emailStatusText, { color: colors.green.secondary }]}>
                    Verified
                  </ThemedText>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.emailStatus}
                  onPress={() => setIsEmailVerificationRequired(true)}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  {/* The spinner takes the warning icon's place rather than
                      sitting beside it, so the row never shifts width as the
                      poll comes and goes. */}
                  <View style={styles.emailStatusIcon}>
                    {isCheckingVerification ? (
                      <ActivityIndicator
                        size="small"
                        color={colors.yellow.secondary}
                        style={styles.emailStatusSpinner}
                      />
                    ) : (
                      <MaterialIcons name="warning" size={13} color={colors.yellow.secondary} />
                    )}
                  </View>
                  <ThemedText style={[styles.emailStatusText, { color: colors.yellow.secondary }]}>
                    {isCheckingVerification ? 'Checking...' : 'Not verified'}
                  </ThemedText>
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              style={styles.input}
              value={profile.email}
              onChangeText={(value) => setProfile((prev) => ({ ...prev, email: value }))}
              placeholder="you@example.com"
              placeholderTextColor={colors.textSecondary}
              autoCapitalize="none"
              keyboardType="email-address"
            />
            {hasPassword ? (
              <>
                <ThemedText style={styles.label}>Current password</ThemedText>
                <TextInput
                  style={styles.input}
                  value={profile.current_password}
                  onChangeText={(value) =>
                    setProfile((prev) => ({ ...prev, current_password: value }))
                  }
                  placeholder="Required to change username or email"
                  placeholderTextColor={colors.textSecondary}
                  secureTextEntry
                />
              </>
            ) : (
              <ThemedText style={styles.helperText}>
                Set a password below before you can change your username or email.
              </ThemedText>
            )}
            <TouchableOpacity
              style={[
                styles.primaryButton,
                (isProfileSaving || (hasPassword && !profile.current_password)) &&
                  styles.buttonDisabled,
              ]}
              onPress={handleProfileSave}
              disabled={isProfileSaving || (hasPassword && !profile.current_password)}
            >
              <ThemedText style={styles.primaryButtonText}>
                {isProfileSaving ? 'Updating...' : 'Update profile'}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
        ) : null}

        {isSignedIn ? (
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Letterboxd</ThemedText>
          <LetterboxdSection />
        </View>
        ) : null}

        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Appearance</ThemedText>
          <View style={styles.card}>
            <SegmentedControl
              options={THEME_OPTIONS}
              value={themePreference}
              onChange={setThemePreference}
              accessibilityLabelPrefix="Appearance"
              stretch
              size="large"
            />
          </View>
        </View>

        {canReplayIntro && isSignedIn ? (
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
            {savedCinevilleDigits ? (
              <>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => setIsCinevilleCardVisible(true)}
                >
                  <ThemedText style={styles.secondaryButtonText}>Show barcode</ThemedText>
                </TouchableOpacity>
                <ThemedText style={styles.label}>Shortcut button</ThemedText>
                <View style={styles.cinevilleShortcutRow}>
                  <ThemedText style={styles.cinevilleShortcutLabel}>On the showtimes tab</ThemedText>
                  <AppSwitch
                    value={isShortcutOnShowtimes}
                    onValueChange={(value) => setCinevilleShortcutEnabled('showtimes', value)}
                  />
                </View>
                <View style={styles.cinevilleShortcutRow}>
                  <ThemedText style={styles.cinevilleShortcutLabel}>On the activity tab</ThemedText>
                  <AppSwitch
                    value={isShortcutOnActivity}
                    onValueChange={(value) => setCinevilleShortcutEnabled('activity', value)}
                  />
                </View>
              </>
            ) : null}
          </View>
        </View>

        {isSignedIn ? (
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
                  <ThemedText style={styles.notificationToggleTitle}>Notify on new films</ThemedText>
                  <ThemedText style={styles.notificationToggleDescription}>
                    Email me when a film from my Letterboxd watchlist, or a list I pick, becomes available.
                  </ThemedText>
                </View>
                <AppSwitch
                  value={digestEnabled}
                  onValueChange={(value) => handleDigestToggle(value)}
                  disabled={!user || isUpdatingDigest}
                />
              </View>
              {digestEnabled ? (
                <>
                  <TouchableOpacity
                    onPress={() => setDigestAdvancedOpen((previous) => !previous)}
                    activeOpacity={0.8}
                  >
                    <ThemedText style={styles.digestAdvancedToggle}>
                      {digestAdvancedOpen ? 'Hide advanced' : 'Advanced: sources'}
                    </ThemedText>
                  </TouchableOpacity>
                  {digestAdvancedOpen ? (
                    <WatchlistDigestSourcesSection
                      isSignedIn={isSignedIn}
                      enabled={digestEnabled}
                      letterboxdUsername={user?.letterboxd_username ?? null}
                    />
                  ) : null}
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
        ) : null}

        {isSignedIn ? (
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
              <AppSwitch
                value={featureTipsEnabled}
                onValueChange={setFeatureTipsEnabled}
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
        ) : null}

        {isSignedIn ? (
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
        ) : null}

        {isSignedIn ? (
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
        ) : null}

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
            <TouchableOpacity
              style={styles.aboutLinkRow}
              onPress={handleOpenPrivacyPolicy}
              activeOpacity={0.7}
              accessibilityRole="link"
              accessibilityLabel="Open the privacy policy"
            >
              <MaterialIcons name="privacy-tip" size={16} color={colors.textSecondary} />
              <ThemedText style={styles.aboutLinkText}>Privacy policy</ThemedText>
              <MaterialIcons name="open-in-new" size={13} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.aboutLinkRow}
              onPress={handleOpenSupport}
              activeOpacity={0.7}
              accessibilityRole="link"
              accessibilityLabel="Contact support"
            >
              <MaterialIcons name="mail-outline" size={16} color={colors.textSecondary} />
              <ThemedText style={styles.aboutLinkText}>Contact support</ThemedText>
              <MaterialIcons name="open-in-new" size={13} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {isSignedIn ? (
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Privacy</ThemedText>
          <View style={styles.card}>
            <View style={styles.notificationToggleHeader}>
              <View style={styles.notificationToggleTextContainer}>
                <ThemedText style={styles.notificationToggleTitle}>
                  Friends of friends
                </ThemedText>
                <ThemedText style={styles.notificationToggleDescription}>
                  On a showtime, also show friends of your friends who are going or
                  interested — only through a mutual friend who is too, and only if
                  they already let that friend see it.
                </ThemedText>
              </View>
              <AppSwitch
                value={showFriendsOfFriends}
                onValueChange={(value) => void handleFriendsOfFriendsToggle(value)}
                disabled={!user || isUpdatingFriendsOfFriends}
              />
            </View>
            <TouchableOpacity
              style={styles.aboutLinkRow}
              onPress={() => router.push('/blocked-users')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="View blocked accounts"
            >
              <MaterialIcons name="block" size={16} color={colors.textSecondary} />
              <ThemedText style={styles.aboutLinkText}>Blocked accounts</ThemedText>
              <MaterialIcons name="chevron-right" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
        ) : null}

        {isSignedIn ? (
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
            <View style={[styles.card, styles.dangerCard]} onLayout={handleDangerCardLayout}>
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
        ) : null}
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
      <EmailVerificationRequiredDialog
        visible={isEmailVerificationRequired}
        onClose={() => setIsEmailVerificationRequired(false)}
      />
      <ConfirmDialog
        visible={verificationSentTo !== null}
        icon="mark-email-unread"
        title="Confirm your new email"
        message={`Your profile is saved. We sent a confirmation link to ${verificationSentTo ?? ''} — open it to confirm the address is yours. Until then nothing can be emailed to you.`}
        confirmLabel="Got it"
        tone="primary"
        onConfirm={() => setVerificationSentTo(null)}
        onCancel={() => setVerificationSentTo(null)}
      />
      {savedCinevilleDigits ? (
        <CinevilleCardModal
          visible={isCinevilleCardVisible}
          digits={savedCinevilleDigits}
          onClose={() => setIsCinevilleCardVisible(false)}
        />
      ) : null}
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
      // While the danger zone is collapsed the screen adds the card's height on
      // top of this, see dangerZoneReservedSpace.
      paddingBottom: CONTENT_PADDING_BOTTOM,
      gap: 20,
    },
    section: {
      gap: SECTION_GAP,
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
    emailLabelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    emailStatus: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    emailStatusIcon: {
      width: 13,
      height: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emailStatusSpinner: {
      // RN's smallest spinner is ~20pt; scaled down to sit on the icon's line
      // without pushing the row taller.
      transform: [{ scale: 0.65 }],
    },
    emailStatusText: {
      fontSize: 12,
      fontWeight: '600',
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
    aboutLinkRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 10,
      marginTop: 2,
    },
    aboutLinkText: {
      flex: 1,
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
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
    digestAdvancedToggle: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.tint,
    },
    cinevilleShortcutRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 10,
      paddingLeft: 10,
      paddingRight: 6,
      paddingVertical: 4,
      backgroundColor: colors.background,
    },
    cinevilleShortcutLabel: {
      flex: 1,
      fontSize: 14,
      lineHeight: 18,
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
      backgroundColor: colors.surfaceMuted,
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
  });

/**
 * The shell in front of the screen above.
 *
 * A tab is built the first time it is opened, and until it is, the tab you
 * pressed away from stays on screen — which reads as the press being ignored.
 * The gate is a component of its own so that every hook the screen owns lives
 * *behind* it: an early return inside one component would only defer the
 * render, not the queries and subscriptions that set it up.
 *
 * The wait is whatever {@link tabContentHoldMs} still owes the tab bar's press
 * flash, so the mount takes the UI thread only once that movement is over
 * rather than stalling it half-way. Once a tab has been built it is never
 * gated again.
 */
export default function SettingsScreenTab() {
  const ready = useDeferredMount('tab:settings', tabContentHoldMs);
  if (!ready) return <TabScreenSkeleton title="Settings" icon="gearshape.fill" />;
  return <SettingsScreen />;
}
