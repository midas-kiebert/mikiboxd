/**
 * Mobile layout/navigation component: Top Bar.
 */
import { TouchableOpacity, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";

import { useThemeColors } from "@/hooks/use-theme-color";
import { IconSymbol } from "@/components/ui/icon-symbol";

type TopBarProps = {
  title?: string;
  titleSuffix?: string;
  showBackButton?: boolean;
};

export default function TopBar({
  title = "MIKINO",
  titleSuffix,
  showBackButton = false,
}: TopBarProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const router = useRouter();
  // Reused top bar keeps the app title layout consistent across tab screens.
  const colors = useThemeColors();
  const styles = createStyles(colors);

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
          activeOpacity={0.75}
        >
          <IconSymbol size={20} name="chevron.left" color={colors.tint} />
        </TouchableOpacity>
      ) : null}
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {titleSuffix ? <Text style={styles.titleSuffix}>{titleSuffix}</Text> : null}
      </View>
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
    title: {
      fontSize: 24,
      fontWeight: "bold",
      color: colors.tint,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "flex-end",
      columnGap: 4,
    },
    titleSuffix: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.tint,
      opacity: 0.85,
      paddingBottom: 2,
    },
  });
