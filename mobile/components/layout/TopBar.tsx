/**
 * Mobile layout/navigation component: Top Bar.
 */
import { TouchableOpacity, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFetchNotificationUnseenCount } from "shared/hooks/useFetchNotificationUnseenCount";

import { useThemeColors } from "@/hooks/use-theme-color";
import { useNotificationCenter } from "@/components/notifications/NotificationCenterProvider";

/**
 * Horizontal space (from the screen edge) taken by the back button / bell, which
 * are absolutely positioned over the centred title. The title row pads itself by
 * this much so a long title truncates instead of running under them.
 */
const SIDE_BUTTON_RESERVED_WIDTH = 50;

type TopBarProps = {
  title?: string;
  titleSuffix?: string;
  showBackButton?: boolean;
  /** Hides the notification bell (e.g. on screens where it's redundant). */
  showNotificationBell?: boolean;
};

export default function TopBar({
  title = "MiKiNO",
  titleSuffix,
  showBackButton = false,
  showNotificationBell = true,
}: TopBarProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const router = useRouter();
  // Reused top bar keeps the app title layout consistent across tab screens.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { openNotificationCenter } = useNotificationCenter();
  const { data: unseenCount = 0 } = useFetchNotificationUnseenCount({
    enabled: showNotificationBell,
  });
  const showBadge = unseenCount > 0;
  const badgeLabel = unseenCount > 99 ? "99+" : String(unseenCount);

  // Render/output using the state and derived values prepared above.
  return (
    <View style={styles.container}>
      {showBackButton ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          style={styles.backButton}
          hitSlop={8}
          activeOpacity={0.6}
        >
          <MaterialIcons name="arrow-back" size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      ) : null}
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
          {title}
        </Text>
        {titleSuffix ? (
          <Text style={styles.titleSuffix} numberOfLines={1} ellipsizeMode="tail">
            {titleSuffix}
          </Text>
        ) : null}
      </View>
      {showNotificationBell ? (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Open notifications"
          onPress={openNotificationCenter}
          style={styles.bellButton}
          hitSlop={8}
          activeOpacity={0.75}
        >
          <MaterialIcons name="notifications-none" size={24} color={colors.tint} />
          {showBadge ? (
            <View style={[styles.badge, { backgroundColor: colors.notificationBadge }]}>
              {/* Capped: the badge is a fixed 18pt circle, so unbounded font
                  scaling pushes the count outside it. */}
              <Text style={styles.badgeText} maxFontSizeMultiplier={1.2}>
                {badgeLabel}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      position: "relative",
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      alignItems: "center",
      backgroundColor: colors.background,
      minHeight: 56,
    },
    backButton: {
      position: "absolute",
      left: 12,
      top: 0,
      bottom: 0,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 6,
    },
    bellButton: {
      position: "absolute",
      right: 12,
      top: 0,
      bottom: 0,
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 6,
    },
    badge: {
      position: "absolute",
      top: 8,
      right: 0,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 5,
      alignItems: "center",
      justifyContent: "center",
    },
    badgeText: {
      color: "#fff",
      fontSize: 10,
      fontWeight: "700",
    },
    title: {
      fontSize: 24,
      fontWeight: "bold",
      color: colors.tint,
      flexShrink: 1,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      columnGap: 4,
      // The back button and bell are absolutely positioned over this row, so the
      // title has to keep clear of them itself. Without this reservation a long
      // cinema/friend name runs underneath both on ~360dp and narrower.
      maxWidth: "100%",
      paddingHorizontal: SIDE_BUTTON_RESERVED_WIDTH - 16,
    },
    titleSuffix: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.tint,
      opacity: 0.85,
      paddingBottom: 2,
      flexShrink: 1,
    },
  });
