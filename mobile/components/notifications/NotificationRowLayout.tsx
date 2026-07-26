/**
 * The visual shell of a notification-centre row: accent icon circle, title and
 * subtitle, relative timestamp, unseen dot, and a dismiss ✕.
 *
 * Both the backend feed (`NotificationRow`) and the local feature-tip reminders
 * (`FeatureTipNotificationRow`) render through this, so the two sources stay
 * indistinguishable in the list.
 */
import type { ReactNode } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { DateTime } from "luxon";

import { useThemeColors } from "@/hooks/use-theme-color";

type ThemeColors = typeof import("@/constants/theme").Colors.light;

export const formatRelativeTime = (isoString: string): string => {
  const parsed = DateTime.fromISO(isoString);
  if (!parsed.isValid) return "";
  return parsed.toRelative({ style: "short" }) ?? "";
};

type NotificationRowLayoutProps = {
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  /** A palette pair from the theme, e.g. `colors.teal`. */
  accent: ThemeColors["blue"];
  title: string;
  subtitle?: string | null;
  /** ISO timestamp; rendered as a relative time. */
  timestamp: string;
  isUnseen: boolean;
  /** Omit to make the row inert (rows whose only actions are inline buttons). */
  onPress?: () => void;
  /** Omit to leave the ✕ out. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Inline actions rendered under the subtitle. */
  children?: ReactNode;
};

export default function NotificationRowLayout({
  icon,
  accent,
  title,
  subtitle,
  timestamp,
  isUnseen,
  onPress,
  onDismiss,
  dismissLabel = "Dismiss notification",
  children,
}: NotificationRowLayoutProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const relativeTime = formatRelativeTime(timestamp);

  const content = (
    <View style={styles.row}>
      <View style={[styles.iconCircle, { backgroundColor: accent.primary }]}>
        <MaterialIcons name={icon} size={18} color={accent.secondary} />
      </View>
      <View style={styles.body}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
        {children}
      </View>
      <View style={styles.trailing}>
        {relativeTime ? <Text style={styles.time}>{relativeTime}</Text> : null}
        {isUnseen ? <View style={[styles.unseenDot, { backgroundColor: colors.tint }]} /> : null}
        {onDismiss ? (
          <TouchableOpacity
            onPress={onDismiss}
            hitSlop={8}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityLabel={dismissLabel}
          >
            <MaterialIcons name="close" size={18} color={colors.textSecondary} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );

  if (!onPress) {
    return <View style={styles.container}>{content}</View>;
  }

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
    >
      {content}
    </TouchableOpacity>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      backgroundColor: colors.background,
    },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
    },
    iconCircle: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
    },
    body: {
      flex: 1,
      gap: 2,
    },
    title: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.text,
    },
    subtitle: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    trailing: {
      alignItems: "flex-end",
      gap: 6,
    },
    time: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    unseenDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
  });
