/**
 * Intro page 5 — turn on notifications.
 *
 * The OS prompt fires by itself a beat after the page appears, so the user
 * reads what they are being asked for and then answers it, rather than meeting
 * the system dialog cold on some other screen later. Everything the page can
 * end up in follows from the permission state:
 *  - not yet answered → ask (once, automatically), on both platforms: Android
 *    has no `undetermined`, it reports a permission it has never asked about as
 *    denied-but-askable, so "can still be asked" is the condition, not iOS's
 *    name for it;
 *  - refused but still askable → the button asks again;
 *  - denied for good → the button opens system settings, and the page updates
 *    itself when the user comes back (`useSystemNotificationPermission`
 *    re-reads on foreground);
 *  - granted → nothing left to do but move on.
 *
 * Asking through `registerPushTokenForCurrentDevice` rather than the
 * preferences controller's `requestSystemPermission`: that one raises native
 * Alerts on refusal, which over a walkthrough is a dialog answering a dialog.
 * Here the page itself is the fallback UI.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as Notifications from "expo-notifications";
import useAuth from "shared/hooks/useAuth";

import IntroPageShell from "@/components/intro/IntroPageShell";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import {
  openSystemSettings,
  useSystemNotificationPermission,
} from "@/hooks/useNotificationPreferences";
import { registerPushTokenForCurrentDevice } from "@/utils/push-notifications";

/**
 * Long enough for the page to have painted before the system dialog covers it
 * — the prompt has to look like the answer to what the page just said, not
 * like something that happened on a blank screen.
 */
const AUTO_PROMPT_DELAY_MS = 550;

/** What the permission actually buys, in the order the user meets them. */
const NOTIFICATION_EXAMPLES: readonly {
  icon: keyof typeof MaterialIcons.glyphMap;
  label: string;
  detail: string;
}[] = [
  { icon: "mail", label: "Invites", detail: "A friend asks you along to a showtime." },
  { icon: "person-add", label: "Friend requests", detail: "Someone wants to follow along." },
  { icon: "groups", label: "Friend activity", detail: "A friend is going to a film you want to see." },
  { icon: "alarm", label: "Reminders", detail: "Before a showtime you said you were interested in." },
];

export default function IntroNotificationsPage({ onDone }: { onDone: () => void }) {
  // Read flow: state and data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { user } = useAuth();

  const { status, isGranted, canAskAgain, apply } = useSystemNotificationPermission();
  const [isAsking, setIsAsking] = useState(false);
  // The automatic ask is a one-off. Without this, coming back from system
  // settings still undetermined would fire the prompt again under the user.
  const hasAutoAskedRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const askForPermission = useCallback(async () => {
    setIsAsking(true);
    try {
      // The registration path, not a bare `requestPermissionsAsync`: a yes here
      // has to leave the backend able to actually reach this device.
      await registerPushTokenForCurrentDevice({
        userId: user ? String(user.id) : undefined,
        force: true,
      });
    } catch (error) {
      console.error("Error registering this device for push notifications:", error);
    }
    // Read the answer even when registration failed afterwards: the prompt may
    // well have been granted before whatever went wrong.
    const permissions = await Notifications.getPermissionsAsync().catch(() => null);
    if (!isMountedRef.current) return;
    if (permissions) apply(permissions);
    setIsAsking(false);
  }, [apply, user]);

  useEffect(() => {
    // Anything the OS will still answer is asked automatically — the button is
    // there for a second try, not for the first. Gating this on `undetermined`
    // made it an iOS-only courtesy: Android has no such state, and reports a
    // POST_NOTIFICATIONS permission it has never been asked about as `denied`
    // with `canAskAgain`, so every Android user had to press the button
    // themselves to see a prompt the page had already explained.
    //
    // Still waits for the first read (`status === null`): asking before it
    // lands would prompt a user who has already granted it.
    if (status === null || isGranted || !canAskAgain || hasAutoAskedRef.current) return;
    hasAutoAskedRef.current = true;
    const timer = setTimeout(() => void askForPermission(), AUTO_PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [askForPermission, canAskAgain, isGranted, status]);

  const canRetryAsk = canAskAgain && status !== null;

  const handlePrimary = useCallback(() => {
    if (isGranted) {
      onDone();
      return;
    }
    // Once the OS has stopped asking, the prompt never appears again and the
    // system settings screen is the only way back.
    if (!canRetryAsk) {
      void openSystemSettings();
      return;
    }
    void askForPermission();
  }, [askForPermission, canRetryAsk, isGranted, onDone]);

  // Render/output using the state and handlers prepared above.
  const primaryLabel = isGranted
    ? "Finish"
    : canRetryAsk
      ? "Allow notifications"
      : "Open system settings";

  return (
    <IntroPageShell
      icon={isGranted ? "notifications-active" : "notifications"}
      title={isGranted ? "Notifications are on" : "Stay in the loop"}
      message={
        isGranted
          ? "You can change what you hear about, and whether it arrives by push or email, in Settings."
          : "Invites, friend requests and showtime reminders reach you as they happen. Nothing else."
      }
      primaryLabel={primaryLabel}
      onPrimary={handlePrimary}
      // Null status means the first permission read has not landed yet, so
      // there is nothing sensible for the button to do.
      isPrimaryDisabled={status === null}
      isPrimaryBusy={isAsking}
      secondaryLabel={isGranted ? undefined : "Not now"}
      onSecondary={isGranted ? undefined : onDone}
    >
      <View style={styles.examples}>
        {NOTIFICATION_EXAMPLES.map((example) => (
          <View key={example.label} style={styles.exampleRow}>
            <View style={styles.exampleIcon}>
              <MaterialIcons name={example.icon} size={18} color={colors.tint} />
            </View>
            <View style={styles.exampleText}>
              <ThemedText style={styles.exampleLabel}>{example.label}</ThemedText>
              <ThemedText style={styles.exampleDetail}>{example.detail}</ThemedText>
            </View>
          </View>
        ))}
      </View>
      {!isGranted && !canRetryAsk && status !== null ? (
        <ThemedText style={styles.blockedNote}>
          Your device has stopped asking, so notifications have to be switched on for MiKiNO in
          your system settings.
        </ThemedText>
      ) : null}
    </IntroPageShell>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    examples: {
      gap: 10,
      paddingTop: 4,
    },
    exampleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    exampleIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceMuted,
    },
    exampleText: {
      flex: 1,
      gap: 1,
    },
    exampleLabel: {
      fontSize: 14,
      // Explicit: `ThemedText`'s default line height is 24 and survives a
      // fontSize override, which would leave these two lines far apart.
      lineHeight: 18,
      fontWeight: "700",
      color: colors.text,
    },
    exampleDetail: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
    },
    blockedNote: {
      fontSize: 13,
      lineHeight: 18,
      textAlign: "center",
      color: colors.textSecondary,
      paddingTop: 14,
    },
  });
