/**
 * Turning push notifications on, start to finish, for every place that offers
 * it: the intro's notifications page, the notification tips and Settings.
 *
 * `request()` asks the OS when it still can. Once it has stopped asking (the
 * user denied it before), the prompt can never appear again and the only way
 * back is the system settings screen, so the flow shows a dialog with the exact
 * steps for this platform instead of silently doing nothing. Coming back from
 * settings with notifications allowed finishes the flow by itself: the dialog
 * closes and `onGranted` runs, with no second tap needed.
 *
 * Success always means a push token was registered, not merely that the OS
 * said yes — a permission with no token reaches nobody.
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { AppState, Linking, Platform, StyleSheet, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import useAuth from "shared/hooks/useAuth";

import { ThemedText } from "@/components/themed-text";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useThemeColors } from "@/hooks/use-theme-color";
import { notePushDenied } from "@/utils/feature-tips";
import { Notifications } from "@/utils/notifications-module";
import { registerPushTokenForCurrentDevice } from "@/utils/push-notifications";

/** What the user has to do in system settings, in their own OS's words. */
const SETTINGS_STEPS: readonly string[] =
  Platform.OS === "ios"
    ? [
        "Tap “Open settings” below.",
        "Tap “Notifications”.",
        "Switch on “Allow Notifications”.",
        "Come back to MiKiNO — that's it.",
      ]
    : [
        "Tap “Open settings” below.",
        "Tap “Notifications”.",
        "Switch on “All MiKiNO notifications”.",
        "Come back to MiKiNO — that's it.",
      ];

/** Never rejects: nothing a caller could do about a locked-down device. */
const openSystemSettings = (): void => {
  Linking.openSettings().catch((error: unknown) => {
    console.error("Error opening system notification settings:", error);
  });
};

type PushPermissionFlowOptions = {
  /** Runs once a push token is registered for this device. */
  onGranted: () => void;
  /**
   * Whether a fresh "Don't allow" goes straight on to the settings steps.
   * The intro turns this off: it answers a refusal with its own choices
   * (try again, email, none) rather than a dialog on top of the page.
   */
  showHelpOnDenial?: boolean;
  /** An extra way out of the settings dialog, e.g. "Use email instead". */
  helpAlternative?: { label: string; onPress: () => void };
};

export type PushPermissionFlow = {
  /** Resolves true when push is on, false when it was refused or failed. */
  request: () => Promise<boolean>;
  /** Straight to the settings steps, for a "try again" after a refusal. */
  showHelp: () => void;
  isRequesting: boolean;
  /** Render this somewhere in the caller's tree. */
  helpDialog: ReactNode;
};

export const usePushPermissionFlow = ({
  onGranted,
  showHelpOnDenial = true,
  helpAlternative,
}: PushPermissionFlowOptions): PushPermissionFlow => {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isRequesting, setIsRequesting] = useState(false);
  const [isHelpVisible, setIsHelpVisible] = useState(false);
  // The latest callback, for the settings round trip that finishes long after
  // the render that started it.
  const onGrantedRef = useRef(onGranted);
  useEffect(() => {
    onGrantedRef.current = onGranted;
  });

  /** Registers this device; true when a token came back. Never rejects. */
  const register = useCallback(
    async (prompt: boolean): Promise<boolean> => {
      if (!user) return false;
      let token: string | null = null;
      try {
        token = await registerPushTokenForCurrentDevice({
          userId: String(user.id),
          force: true,
          prompt,
        });
      } catch (error) {
        console.error("Error registering this device for push notifications:", error);
      }
      if (!token) return false;
      // `has_push_token` decides whether push is offered anywhere.
      void queryClient.invalidateQueries({ queryKey: ["currentUser"] });
      return true;
    },
    [queryClient, user]
  );

  const request = useCallback(async (): Promise<boolean> => {
    setIsRequesting(true);
    try {
      const before = await Notifications.getPermissionsAsync().catch(() => null);
      // Denied for good: the OS will not show its prompt again, so asking is
      // a no-op the user never sees. The steps are the only way forward.
      if (before && !before.granted && !before.canAskAgain) {
        notePushDenied();
        setIsHelpVisible(true);
        return false;
      }
      if (await register(true)) {
        onGrantedRef.current();
        return true;
      }
      const after = await Notifications.getPermissionsAsync().catch(() => null);
      if (!after?.granted) {
        notePushDenied();
        if (showHelpOnDenial) setIsHelpVisible(true);
      }
      return false;
    } finally {
      setIsRequesting(false);
    }
  }, [register, showHelpOnDenial]);

  useEffect(() => {
    if (!isHelpVisible) return;
    // Back from system settings: finish the job if they switched it on.
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      void (async () => {
        const permissions = await Notifications.getPermissionsAsync().catch(() => null);
        if (!permissions?.granted) return;
        if (await register(false)) {
          setIsHelpVisible(false);
          onGrantedRef.current();
        }
      })();
    });
    return () => subscription.remove();
  }, [isHelpVisible, register]);

  const closeHelp = useCallback(() => setIsHelpVisible(false), []);

  const helpDialog = (
    <ConfirmDialog
      visible={isHelpVisible}
      icon="notifications-off"
      tone="primary"
      title="Turn on notifications in Settings"
      message="Your phone is blocking notifications from MiKiNO, so it won't ask again. It takes a few seconds to switch them on:"
      confirmLabel="Open settings"
      onConfirm={openSystemSettings}
      secondaryLabel={helpAlternative?.label}
      onSecondary={
        helpAlternative
          ? () => {
              setIsHelpVisible(false);
              helpAlternative.onPress();
            }
          : undefined
      }
      cancelLabel="Not now"
      onCancel={closeHelp}
    >
      <View style={styles.steps}>
        {SETTINGS_STEPS.map((step, index) => (
          <View key={step} style={styles.step}>
            <View style={styles.stepNumber}>
              <ThemedText style={styles.stepNumberText}>{index + 1}</ThemedText>
            </View>
            <ThemedText style={styles.stepText}>{step}</ThemedText>
          </View>
        ))}
      </View>
    </ConfirmDialog>
  );

  return {
    request,
    showHelp: useCallback(() => setIsHelpVisible(true), []),
    isRequesting,
    helpDialog,
  };
};

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    steps: {
      alignSelf: "stretch",
      gap: 8,
      marginTop: 4,
    },
    step: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    stepNumber: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceMuted,
    },
    stepNumberText: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "700",
      color: colors.tint,
    },
    stepText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      color: colors.text,
    },
  });
