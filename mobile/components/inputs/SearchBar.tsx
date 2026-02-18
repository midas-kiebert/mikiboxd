/**
 * Mobile input component: Search Bar.
 */
import { StyleSheet, TextInput, View } from "react-native";

import { useThemeColors } from "@/hooks/use-theme-color";

type SearchBarProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
};

export default function SearchBar({ value, onChangeText, placeholder = "Search" }: SearchBarProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  // Theme-aware colors keep this input readable in both light and dark modes.
  const colors = useThemeColors();
  const styles = createStyles(colors);

  // Render/output using the state and derived values prepared above.
  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
        // Placeholder text communicates screen-specific search context (movies, users, showtimes).
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        value={value}
        onChangeText={onChangeText}
      />
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.background,
    },
    input: {
      backgroundColor: colors.searchBackground,
      borderRadius: 12,
      paddingHorizontal: 16,
      paddingVertical: 12,
      fontSize: 16,
      color: colors.text,
    },
  });
