/**
 * Mobile friends feature component: the "Share Invite Link" call to action.
 * Shared between the Friends tab and the add-friends feature tip so the two
 * never drift in style.
 */
import { Share, StyleSheet, TouchableOpacity } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

type ShareInviteLinkButtonProps = {
  inviteUrl: string | null;
};

export default function ShareInviteLinkButton({ inviteUrl }: ShareInviteLinkButtonProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const handlePress = async () => {
    if (!inviteUrl) return;
    triggerSelectionHaptic();
    try {
      await Share.share({
        message: `Add me on MiKiNO: ${inviteUrl}`,
        url: inviteUrl,
      });
    } catch (error) {
      console.error("Error sharing friend invite link:", error);
    }
  };

  if (!inviteUrl) return null;

  return (
    <TouchableOpacity
      style={styles.button}
      onPress={handlePress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel="Share invite link"
    >
      <MaterialIcons name="ios-share" size={17} color={colors.pillActiveText} />
      <ThemedText style={styles.text}>Share Invite Link</ThemedText>
    </TouchableOpacity>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    button: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      borderRadius: 14,
      backgroundColor: colors.tint,
      paddingHorizontal: 20,
      paddingVertical: 12,
      shadowColor: colors.tint,
      shadowOpacity: 0.35,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    text: {
      color: colors.pillActiveText,
      fontSize: 14,
      fontWeight: "700",
      letterSpacing: 0.2,
    },
  });
