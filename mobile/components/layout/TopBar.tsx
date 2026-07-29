/**
 * Mobile layout/navigation component: Top Bar.
 */
import { Image, Linking, TouchableOpacity, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useFetchNotificationUnseenCount } from "shared/hooks/useFetchNotificationUnseenCount";

import { useThemeColors } from "@/hooks/use-theme-color";
import { useNotificationCenter } from "@/components/notifications/NotificationCenterProvider";
import { useUnseenSnoozedTipCount } from "@/utils/feature-tips";

/**
 * Horizontal space (from the screen edge) taken by the back button / bell, which
 * are absolutely positioned over the centred title. The title row pads itself by
 * this much so a long title truncates instead of running under them.
 */
const SIDE_BUTTON_RESERVED_WIDTH = 50;

/** Title shown on the app's own screens; other screens name themselves. */
const APP_TITLE = "MiKiNO";

type TopBarProps = {
  title?: string;
  titleSuffix?: string;
  showBackButton?: boolean;
  /** Hides the notification bell (e.g. on screens where it's redundant). */
  showNotificationBell?: boolean;
  /** Tints the title and the titleSuffix pill (e.g. a cinema's badge color). */
  accentColor?: { background: string; text: string };
  /** Makes the titleSuffix pill (e.g. a cinema's city) tappable. */
  onTitleSuffixPress?: () => void;
  /** Makes the title itself tappable, opening this URL (e.g. a cinema's website). */
  linkUrl?: string;
};

export default function TopBar({
  title = APP_TITLE,
  titleSuffix,
  showBackButton = false,
  showNotificationBell = true,
  accentColor,
  onTitleSuffixPress,
  linkUrl,
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
  // Snoozed feature tips are local reminders that sit in the same feed, so they
  // count towards the same badge.
  const unseenTipCount = useUnseenSnoozedTipCount();
  const totalUnseenCount = unseenCount + unseenTipCount;
  const showBadge = totalUnseenCount > 0;
  const badgeLabel = totalUnseenCount > 99 ? "99+" : String(totalUnseenCount);

  const handleOpenLink = async () => {
    if (!linkUrl) return;
    try {
      await Linking.openURL(linkUrl);
    } catch {
      // Ignore open failures to keep the header interaction non-blocking.
    }
  };

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
        {title === APP_TITLE ? (
          <Image
            source={require("../../assets/images/mikino-logo.png")}
            style={styles.logo}
            resizeMode="contain"
            accessible={false}
          />
        ) : null}
        {titleSuffix ? (
          <View style={styles.titleStack}>
            <TouchableOpacity
              onPress={handleOpenLink}
              disabled={!linkUrl}
              hitSlop={6}
              activeOpacity={0.6}
              accessibilityRole={linkUrl ? "button" : undefined}
              accessibilityLabel={linkUrl ? `Open ${title} website` : undefined}
            >
              <Text
                style={[styles.title, accentColor ? { color: accentColor.text } : null]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {title}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.subtitleRow,
                accentColor ? { backgroundColor: accentColor.background } : null,
              ]}
              onPress={onTitleSuffixPress}
              disabled={!onTitleSuffixPress}
              hitSlop={6}
              activeOpacity={0.6}
              accessibilityRole={onTitleSuffixPress ? "button" : undefined}
              accessibilityLabel={onTitleSuffixPress ? `Open ${titleSuffix} in Maps` : undefined}
            >
              <MaterialIcons
                name="place"
                size={11}
                color={accentColor?.text ?? colors.textSecondary}
              />
              <Text
                style={[
                  styles.subtitleText,
                  accentColor ? { color: accentColor.text } : null,
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {titleSuffix}
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.title} numberOfLines={1} ellipsizeMode="tail">
            {title}
          </Text>
        )}
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
    logo: {
      // Sized to sit just under the 24pt title's cap height; the width keeps the
      // ticket's 241x144 aspect ratio so it never squashes.
      height: 20,
      width: 34,
      alignSelf: "center",
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
    titleStack: {
      flexShrink: 1,
      alignItems: "center",
      gap: 2,
    },
    subtitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      maxWidth: "100%",
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 8,
    },
    subtitleText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textSecondary,
      flexShrink: 1,
    },
  });
