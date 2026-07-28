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
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import type {
  NotificationDelivery,
  NotificationPreferenceKey,
  NotificationPreferencesController,
} from "@/hooks/useNotificationPreferences";
import { triggerSelectionHaptic } from "@/utils/long-press";

type ThemeColors = typeof import("@/constants/theme").Colors.light;

const DELIVERY_OPTIONS: readonly { value: NotificationDelivery; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "push", label: "Push" },
  { value: "email", label: "Email" },
];

type NotificationPreferenceListProps = {
  controller: NotificationPreferencesController;
};

export default function NotificationPreferenceList({
  controller,
}: NotificationPreferenceListProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { toggles, isReady, pendingKey, setDelivery } = controller;

  const handlePress = (key: NotificationPreferenceKey, delivery: NotificationDelivery) => {
    triggerSelectionHaptic();
    void setDelivery(key, delivery);
  };

  return (
    <View style={styles.card}>
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
            <View style={styles.segmentedControl}>
              {DELIVERY_OPTIONS.map((option) => {
                const isActive = toggle.delivery === option.value;
                // Off is the one active state that should not read as "on", so
                // it gets the neutral thumb rather than the tint.
                const isActiveOff = isActive && option.value === "off";
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.segment,
                      isActive && (isActiveOff ? styles.segmentActiveOff : styles.segmentActiveOn),
                    ]}
                    onPress={() => handlePress(toggle.key, option.value)}
                    disabled={isDisabled}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive, disabled: isDisabled }}
                    accessibilityLabel={`${toggle.label}: ${option.label}`}
                  >
                    <ThemedText
                      style={[
                        styles.segmentText,
                        isActive &&
                          (isActiveOff ? styles.segmentTextActiveOff : styles.segmentTextActiveOn),
                      ]}
                    >
                      {option.label}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>
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
    segmentedControl: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 999,
      backgroundColor: colors.surfaceMuted,
      padding: 2,
    },
    segment: {
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 999,
    },
    segmentActiveOn: {
      backgroundColor: colors.tint,
    },
    segmentActiveOff: {
      backgroundColor: colors.cardBackground,
    },
    segmentText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    segmentTextActiveOn: {
      color: colors.pillActiveText,
    },
    segmentTextActiveOff: {
      color: colors.text,
    },
  });
