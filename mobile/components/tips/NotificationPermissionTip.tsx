/**
 * Feature tip: the system is blocking notifications, so nothing this app sends
 * can reach the user. Offers the OS prompt (or a route into system settings
 * once the OS stops asking) and, below it, the full set of notification
 * preferences, so the user can decide what they actually want to hear about in
 * the same breath as granting permission.
 *
 * Eligibility lives in `FeatureTipsHost`; this component renders and writes.
 */
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";

import NotificationPreferenceList from "@/components/notifications/NotificationPreferenceList";
import FeatureTipModal from "@/components/tips/FeatureTipModal";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import {
  openSystemSettings,
  useNotificationPreferences,
} from "@/hooks/useNotificationPreferences";
import { useDismissTip } from "@/utils/feature-tips";

export default function NotificationPermissionTip() {
  // Read flow: data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const dismissTip = useDismissTip("notification-permission");
  const controller = useNotificationPreferences();
  const { canAskSystemPermission, isSystemPermissionGranted, requestSystemPermission } = controller;

  const handleAllow = useCallback(() => {
    // Once the OS has stopped asking, the prompt never appears again and the
    // only way back is the system settings screen. Coming back from there
    // refreshes the permission (see `useSystemNotificationPermission`), so the
    // dialog switches to its granted state on its own.
    if (!canAskSystemPermission) {
      void openSystemSettings();
      return;
    }
    // Neither call rejects, so nothing here can raise an unhandled rejection.
    void requestSystemPermission();
  }, [canAskSystemPermission, requestSystemPermission]);

  // Render/output using the state and handlers prepared above.
  if (isSystemPermissionGranted) {
    return (
      <FeatureTipModal
        tipId="notification-permission"
        icon="notifications-active"
        title="Notifications are on"
        message="Choose what you want to hear about, and whether it arrives as a push notification or by email."
        actionLabel="Done"
        closeOnAction
        onDismiss={dismissTip}
      >
        <View style={styles.preferences}>
          <NotificationPreferenceList controller={controller} />
        </View>
      </FeatureTipModal>
    );
  }

  return (
    <FeatureTipModal
      tipId="notification-permission"
      icon="notifications-off"
      title="Notifications are blocked"
      message="Your device is not letting MiKiNO send notifications, so invites from friends and reminders for showtimes you are interested in will not reach you."
      actionLabel={canAskSystemPermission ? "Allow notifications" : "Open system settings"}
      onAction={handleAllow}
      onDismiss={dismissTip}
    >
      <View style={styles.preferences}>
        <ThemedText style={styles.preferencesLabel}>
          Choose what you want to hear about, and how it reaches you.
        </ThemedText>
        <NotificationPreferenceList controller={controller} />
      </View>
    </FeatureTipModal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    preferences: {
      gap: 10,
    },
    preferencesLabel: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
  });
