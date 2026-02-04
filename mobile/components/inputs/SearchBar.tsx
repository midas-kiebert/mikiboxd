import { StyleSheet, TextInput, View } from "react-native";

import { useThemeColors } from "@/hooks/use-theme-color";

type SearchBarProps = {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
};

export default function SearchBar({ value, onChangeText, placeholder = "Search" }: SearchBarProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.input}
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
