/**
 * The include/exclude pill that sits above an agenda list — your own on the
 * Agenda tab, a friend's on their agenda screen.
 *
 * It matches the app's filter pills: filled with the category colour when on, a
 * muted outline when off. The fill-vs-outline contrast (and the leading icon
 * switching between its filled/outline form) signals on/off, and the label spells
 * out which of the two states you are looking at rather than leaving the user to
 * work out what the pill would do — "Interested Included" vs "Interested
 * Excluded", not a bare "Interested" that could mean either.
 *
 * Shared rather than copied so a friend's agenda cannot drift away from your own:
 * the same filter, on the same kind of list, should read the same on both.
 */
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerLongPressHaptic } from "@/utils/long-press";

type ThemeColors = typeof import("@/constants/theme").Colors.light;
/** One of the palette's accent trios (orange for interested, blue for invites, …). */
type AccentColor = ThemeColors["orange"];

type AgendaTogglePillProps = {
  /** The thing being included/excluded, e.g. "Interested". */
  label: string;
  iconOn: React.ComponentProps<typeof MaterialIcons>["name"];
  iconOff: React.ComponentProps<typeof MaterialIcons>["name"];
  active: boolean;
  accent: AccentColor;
  onToggle: () => void;
};

export default function AgendaTogglePill({
  label,
  iconOn,
  iconOff,
  active,
  accent,
  onToggle,
}: AgendaTogglePillProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const handlePress = () => {
    triggerLongPressHaptic();
    onToggle();
  };

  return (
    <TouchableOpacity
      onPress={handlePress}
      activeOpacity={0.7}
      accessibilityRole="switch"
      accessibilityState={{ checked: active }}
      accessibilityLabel={`${label} ${active ? "included" : "excluded"}`}
      style={[
        styles.toggle,
        active
          ? { backgroundColor: accent.primary, borderColor: accent.primary }
          : { backgroundColor: colors.pillBackground, borderColor: colors.cardBorder },
      ]}
    >
      <MaterialIcons
        name={active ? iconOn : iconOff}
        size={15}
        color={active ? accent.secondary : colors.textSecondary}
      />
      <ThemedText
        style={[styles.toggleLabel, { color: active ? accent.secondary : colors.textSecondary }]}
      >
        {label} {active ? "Included" : "Excluded"}
      </ThemedText>
    </TouchableOpacity>
  );
}

/** The row these pills sit in, so both agendas space and separate them alike. */
export function AgendaToggleRow({ children }: { children: React.ReactNode }) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  return <View style={styles.row}>{children}</View>;
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: "row",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      backgroundColor: colors.background,
    },
    toggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 18,
      borderWidth: 1,
    },
    toggleLabel: {
      fontSize: 13,
      fontWeight: "500",
    },
  });
