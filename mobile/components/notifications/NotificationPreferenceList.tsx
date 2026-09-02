/**
 * The four notification preferences, one line each: an icon, the label, and a
 * three-way Off / Push / Email control.
 *
 * On/off and the delivery channel are separate fields on the backend but a
 * single decision for the user, so they are one segmented control rather than a
 * switch plus a second row. That keeps the whole list short enough to sit
 * inside the notification-permission tip as well as in Settings.
 *
 * Presentational: all state and writes live in `useNotificationPreferences`.
 */
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import EmailVerificationRequiredDialog from "@/components/ui/EmailVerificationRequiredDialog";
import SegmentedControl, { type SegmentedOption } from "@/components/ui/SegmentedControl";
import { useThemeColors } from "@/hooks/use-theme-color";
import type {
  NotificationDelivery,
  NotificationPreferencesController,
} from "@/hooks/useNotificationPreferences";

type ThemeColors = typeof import("@/constants/theme").Colors.light;

type NotificationPreferenceListProps = {
  controller: NotificationPreferencesController;
};

export default function NotificationPreferenceList({
  controller,
}: NotificationPreferenceListProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // "Off" is the one selected state that should not read as "on", so it takes
  // the neutral thumb rather than the tint.
  const deliveryOptions = useMemo<readonly SegmentedOption<NotificationDelivery>[]>(
    () => [
      {
        value: "off",
        label: "Off",
        activeBackground: colors.cardBackground,
        activeForeground: colors.text,
      },
      { value: "push", label: "Push" },
      { value: "email", label: "Email" },
    ],
    [colors]
  );
  const {
    toggles,
    isReady,
    pendingKey,
    setDelivery,
    isEmailVerificationRequired,
    dismissEmailVerificationRequired,
  } = controller;

  return (
    <View style={styles.card}>
      <EmailVerificationRequiredDialog
        visible={isEmailVerificationRequired}
        onClose={dismissEmailVerificationRequired}
      />
      {toggles.map((toggle, index) => {
        const isOff = toggle.delivery === "off";
        const isDisabled = !isReady || pendingKey === toggle.key;
        return (
          <View
            key={toggle.key}
            style={[styles.row, index > 0 && styles.rowDivided, isDisabled && styles.rowBusy]}
          >
            <MaterialIcons
              name={toggle.icon}
              size={17}
              color={isOff ? colors.textSecondary : colors.tint}
            />
            <ThemedText style={[styles.label, isOff && styles.labelOff]} numberOfLines={1}>
              {toggle.label}
            </ThemedText>
            <SegmentedControl
              options={deliveryOptions}
              value={toggle.delivery}
              onChange={(delivery) => void setDelivery(toggle.key, delivery)}
              accessibilityLabelPrefix={toggle.label}
              disabled={isDisabled}
            />
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 12,
      backgroundColor: colors.background,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 7,
    },
    // Hairline between rows instead of a border around each one.
    rowDivided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    rowBusy: {
      opacity: 0.5,
    },
    label: {
      flex: 1,
      fontSize: 13,
      fontWeight: "600",
      color: colors.text,
    },
    labelOff: {
      color: colors.textSecondary,
    },
  });
