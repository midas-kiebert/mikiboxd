/**
 * The notification preferences shared by the Settings screen and the
 * notification-permission tip: the four preference toggles, each one's delivery
 * channel, the OS permission status, and the writes that keep them in sync.
 *
 * Each preference is one three-way choice (off, push, email) rather than a
 * boolean plus a channel, so the UI can be a single segmented control and the
 * two backend fields move in one request.
 *
 * Choosing push registers a push token first, so the system prompt appears
 * exactly when the user asks for the notification, and the control rolls back
 * if permission is refused. Every write is optimistic and reverts on failure,
 * so the controls never lie about what the server holds.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, AppState, Linking } from "react-native";
import * as Notifications from "expo-notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type NotificationChannel, MeService, type UserUpdate } from "shared/client";
import useAuth from "shared/hooks/useAuth";

import { registerPushTokenForCurrentDevice } from "@/utils/push-notifications";

export type NotificationPreferenceKey =
  | "notify_on_friend_showtime_match"
  | "notify_on_friend_requests"
  | "notify_on_showtime_ping"
  | "notify_on_interest_reminder";

export type NotificationChannelPreferenceKey =
  | "notify_channel_friend_showtime_match"
  | "notify_channel_friend_requests"
  | "notify_channel_showtime_ping"
  | "notify_channel_interest_reminder";

type NotificationPreferencesState = Record<NotificationPreferenceKey, boolean>;
type NotificationChannelsState = Record<NotificationChannelPreferenceKey, NotificationChannel>;

type NotificationPreferenceSource = Partial<Record<NotificationPreferenceKey, boolean>> | null | undefined;

type NotificationChannelSource =
  | Partial<Record<NotificationChannelPreferenceKey, NotificationChannel | null>>
  | null
  | undefined;

/**
 * How one notification type reaches the user. Off and the delivery channel are
 * two backend fields, but they are one decision, so the UI treats them as one
 * three-way choice and this type is what the list reads and writes.
 */
export type NotificationDelivery = "off" | NotificationChannel;

/** One row of the list: the preference, its wording and its current setting. */
export type NotificationToggleDescriptor = {
  key: NotificationPreferenceKey;
  label: string;
  icon: "groups" | "mail" | "alarm" | "person-add";
  delivery: NotificationDelivery;
};

const DEFAULT_NOTIFICATION_CHANNEL: NotificationChannel = "push";

const preferenceToChannelKey: Record<NotificationPreferenceKey, NotificationChannelPreferenceKey> = {
  notify_on_friend_showtime_match: "notify_channel_friend_showtime_match",
  notify_on_friend_requests: "notify_channel_friend_requests",
  notify_on_showtime_ping: "notify_channel_showtime_ping",
  notify_on_interest_reminder: "notify_channel_interest_reminder",
};

// Labels carry the whole explanation now that the rows are one line each, so
// they have to stand on their own next to the icon.
const TOGGLE_COPY: Record<
  NotificationPreferenceKey,
  Pick<NotificationToggleDescriptor, "label" | "icon">
> = {
  notify_on_friend_showtime_match: { label: "Friend activity", icon: "groups" },
  notify_on_showtime_ping: { label: "Invites", icon: "mail" },
  notify_on_interest_reminder: { label: "Interest reminders", icon: "alarm" },
  notify_on_friend_requests: { label: "Friend requests", icon: "person-add" },
};

// Fixed display order, which is not the declaration order of the copy above.
const TOGGLE_ORDER: readonly NotificationPreferenceKey[] = [
  "notify_on_friend_showtime_match",
  "notify_on_showtime_ping",
  "notify_on_interest_reminder",
  "notify_on_friend_requests",
];

const normalizeChannel = (channel: NotificationChannel | null | undefined): NotificationChannel =>
  channel === "email" ? "email" : DEFAULT_NOTIFICATION_CHANNEL;

export const buildNotificationPreferencesState = (
  source: NotificationPreferenceSource
): NotificationPreferencesState => ({
  notify_on_friend_showtime_match: !!source?.notify_on_friend_showtime_match,
  notify_on_friend_requests: !!source?.notify_on_friend_requests,
  notify_on_showtime_ping: !!source?.notify_on_showtime_ping,
  notify_on_interest_reminder: !!source?.notify_on_interest_reminder,
});

export const buildNotificationChannelsState = (
  source: NotificationChannelSource
): NotificationChannelsState => ({
  notify_channel_friend_showtime_match: normalizeChannel(
    source?.notify_channel_friend_showtime_match
  ),
  notify_channel_friend_requests: normalizeChannel(source?.notify_channel_friend_requests),
  notify_channel_showtime_ping: normalizeChannel(source?.notify_channel_showtime_ping),
  notify_channel_interest_reminder: normalizeChannel(source?.notify_channel_interest_reminder),
});

/**
 * True when at least one enabled preference is set to arrive as a push. Someone
 * who turned everything off, or routed it all to email, does not need the OS
 * permission and should not be nagged about it.
 */
export const wantsPushNotifications = (
  source:
    | (Partial<Record<NotificationPreferenceKey, boolean>> &
        Partial<Record<NotificationChannelPreferenceKey, NotificationChannel | null>>)
    | null
    | undefined
): boolean =>
  TOGGLE_ORDER.some(
    (key) => !!source?.[key] && normalizeChannel(source?.[preferenceToChannelKey[key]]) === "push"
  );

/**
 * Hand the user off to the OS settings screen. Never rejects: this can fail on
 * a locked-down device and there is nothing a caller could do about it, so a
 * failure is logged rather than thrown at code that only wanted to open a link.
 */
export const openSystemSettings = async (): Promise<void> => {
  try {
    await Linking.openSettings();
  } catch (error) {
    console.error("Error opening system notification settings:", error);
  }
};

export type SystemNotificationPermission = {
  /** Null until the first read resolves. */
  status: Notifications.PermissionStatus | null;
  isGranted: boolean;
  /** False once the user has refused and the OS will not prompt again. */
  canAskAgain: boolean;
  apply: (permissions: Notifications.NotificationPermissionsStatus) => void;
};

/**
 * Just the OS permission state, for callers that need to know whether
 * notifications can arrive without taking on the whole preferences controller.
 *
 * Re-read whenever the app comes back to the foreground: the permission is
 * routinely changed outside the app, in system settings, and a UI that still
 * claims notifications are blocked after the user has just unblocked them is
 * worse than no UI at all.
 */
export const useSystemNotificationPermission = (): SystemNotificationPermission => {
  const [status, setStatus] = useState<Notifications.PermissionStatus | null>(null);
  const [canAskAgain, setCanAskAgain] = useState(true);

  const apply = useCallback((permissions: Notifications.NotificationPermissionsStatus) => {
    setStatus(permissions.status);
    setCanAskAgain(permissions.canAskAgain);
  }, []);

  useEffect(() => {
    const read = () => {
      Notifications.getPermissionsAsync()
        .then(apply)
        .catch((error) => {
          console.error("Error reading notification permissions:", error);
          setStatus(null);
        });
    };

    read();
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (nextAppState === "active") read();
    });
    return () => subscription.remove();
  }, [apply]);

  return { status, isGranted: status === "granted", canAskAgain, apply };
};

export type NotificationPreferencesController = {
  toggles: NotificationToggleDescriptor[];
  /** Null until the first permission read resolves. */
  permissionStatus: Notifications.PermissionStatus | null;
  isSystemPermissionGranted: boolean;
  /** False once the user has refused and the OS will not prompt again. */
  canAskSystemPermission: boolean;
  /** The row currently being written; only that row is disabled. */
  pendingKey: NotificationPreferenceKey | null;
  /** True once the user is loaded and the controls can be operated. */
  isReady: boolean;
  setDelivery: (key: NotificationPreferenceKey, delivery: NotificationDelivery) => Promise<void>;
  /** Prompts, or sends the user to system settings once the OS stops asking. */
  requestSystemPermission: () => Promise<boolean>;
  /** True while the "confirm your email first" dialog should be shown. */
  isEmailVerificationRequired: boolean;
  dismissEmailVerificationRequired: () => void;
};

export const useNotificationPreferences = (): NotificationPreferencesController => {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [preferences, setPreferences] = useState<NotificationPreferencesState>(() =>
    buildNotificationPreferencesState(user)
  );
  const [channels, setChannels] = useState<NotificationChannelsState>(() =>
    buildNotificationChannelsState(user)
  );
  const [pendingKey, setPendingKey] = useState<NotificationPreferenceKey | null>(null);
  const [isEmailVerificationRequired, setIsEmailVerificationRequired] = useState(false);
  const permission = useSystemNotificationPermission();
  const { apply: applyPermission } = permission;

  useEffect(() => {
    setPreferences(buildNotificationPreferencesState(user));
    setChannels(buildNotificationChannelsState(user));
  }, [user]);

  const { mutateAsync: savePreference } = useMutation({
    mutationFn: (data: UserUpdate) => MeService.updateUserMe({ requestBody: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["currentUser"] });
    },
  });

  /**
   * Runs the OS prompt via token registration, which is the only path that both
   * asks and leaves the backend able to reach this device.
   *
   * Never rejects: registration throws on its own for reasons that have nothing
   * to do with the user's answer (no project id, Expo Go on Android, a network
   * blip), and every caller treats this as a yes/no question.
   */
  const requestSystemPermission = useCallback(async (): Promise<boolean> => {
    if (!user) return false;

    let token: string | null = null;
    try {
      token = await registerPushTokenForCurrentDevice({
        userId: String(user.id),
        force: true,
      });
    } catch (error) {
      console.error("Error registering this device for push notifications:", error);
    }

    // Read the permission even when registration failed: the prompt may well
    // have been answered before whatever went wrong afterwards.
    const permissions = await Notifications.getPermissionsAsync().catch(() => null);
    if (permissions) applyPermission(permissions);
    if (token) return true;

    // Permission but no token means the device could not be registered, which
    // is not something the system settings screen can fix.
    if (permissions?.granted) {
      Alert.alert(
        "Notifications unavailable",
        "This device could not be registered for notifications. Please try again later."
      );
      return false;
    }

    Alert.alert(
      "Enable notifications",
      "To receive notifications, allow them in your system settings.",
      [
        { text: "Not now", style: "cancel" },
        { text: "Open settings", onPress: () => void openSystemSettings() },
      ]
    );
    return false;
  }, [applyPermission, user]);

  /**
   * Off and the delivery channel are one decision for the user, so they travel
   * as one write: flipping a preference straight to Email is a single request
   * rather than an enable followed by a channel change.
   */
  const setDelivery = useCallback(
    async (key: NotificationPreferenceKey, delivery: NotificationDelivery): Promise<void> => {
      if (!user) return;
      const channelKey = preferenceToChannelKey[key];
      const previousEnabled = preferences[key];
      const previousChannel = channels[channelKey];
      const nextEnabled = delivery !== "off";
      // Turning a preference off leaves its channel alone, so switching it back
      // on later restores the channel the user last picked.
      const nextChannel = delivery === "off" ? previousChannel : delivery;
      if (previousEnabled === nextEnabled && previousChannel === nextChannel) return;

      // Nothing is sent to an address nobody has confirmed, so the backend
      // refuses this (403). Said here instead, because a failed save would put
      // the control back without ever explaining why. Turning email *off* is
      // never blocked — only routing something to it.
      if (delivery === "email" && !user.email_verified) {
        setIsEmailVerificationRequired(true);
        return;
      }

      const rollback = () => {
        setPreferences((previous) => ({ ...previous, [key]: previousEnabled }));
        setChannels((previous) => ({ ...previous, [channelKey]: previousChannel }));
      };

      setPreferences((previous) => ({ ...previous, [key]: nextEnabled }));
      setChannels((previous) => ({ ...previous, [channelKey]: nextChannel }));
      try {
        setPendingKey(key);
        // A push is worthless without permission, so ask up front and put the
        // control back where it was if the user says no.
        if (delivery === "push") {
          const granted = await requestSystemPermission();
          if (!granted) {
            rollback();
            return;
          }
        }
        const updatedUser = await savePreference({ [key]: nextEnabled, [channelKey]: nextChannel });
        setPreferences(buildNotificationPreferencesState(updatedUser));
        setChannels(buildNotificationChannelsState(updatedUser));
      } catch (error) {
        console.error("Error updating notification preference:", error);
        rollback();
        Alert.alert(
          "Error",
          error instanceof Error ? error.message : "Could not update notification preferences."
        );
      } finally {
        setPendingKey(null);
      }
    },
    [channels, preferences, requestSystemPermission, savePreference, user]
  );

  const toggles = useMemo<NotificationToggleDescriptor[]>(
    () =>
      TOGGLE_ORDER.map((key) => ({
        key,
        label: TOGGLE_COPY[key].label,
        icon: TOGGLE_COPY[key].icon,
        delivery: preferences[key] ? channels[preferenceToChannelKey[key]] : "off",
      })),
    [channels, preferences]
  );

  return {
    toggles,
    permissionStatus: permission.status,
    isSystemPermissionGranted: permission.isGranted,
    canAskSystemPermission: permission.canAskAgain,
    pendingKey,
    isReady: !!user,
    setDelivery,
    requestSystemPermission,
    isEmailVerificationRequired,
    dismissEmailVerificationRequired: useCallback(() => setIsEmailVerificationRequired(false), []),
  };
};
