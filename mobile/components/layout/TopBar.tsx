/**
 * Mobile layout/navigation component: Top Bar.
 */
import { StyleSheet, Text, View } from "react-native";

import { useThemeColors } from "@/hooks/use-theme-color";

type TopBarProps = {
  title?: string;
};

export default function TopBar({ title = "MIKINO" }: TopBarProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  // Reused top bar keeps the app title layout consistent across tab screens.
  const colors = useThemeColors();
  const styles = createStyles(colors);

  // Render/output using the state and derived values prepared above.
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      alignItems: "center",
      backgroundColor: colors.background,
    },
    title: {
      fontSize: 24,
      fontWeight: "bold",
      color: colors.tint,
    },
  });
