/**
 * Mobile filter UI component: Filters Button Row.
 * A minimal row with just the "Filters" button — no preset buttons.
 * Used on sub-pages (movie, cinema, friend) where presets are not shown.
 * Accepts an optional rightSlot for extra controls (e.g. the Interested toggle).
 *
 * Renders the shared `FiltersButton`, so the sub-pages' filter entry point is
 * the same control as the one beside the search field on the main feeds.
 */
import { StyleSheet, View } from "react-native";

import { useThemeColors } from "@/hooks/use-theme-color";
import FiltersButton from "@/components/filters/FiltersButton";

type Props = {
  onPress: () => void;
  rightSlot?: React.ReactNode;
};

export default function FiltersButtonRow({ onPress, rightSlot }: Props) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  return (
    <View style={styles.container}>
      <FiltersButton onPress={onPress} />
      {rightSlot}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    container: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      backgroundColor: colors.background,
      paddingVertical: 10,
      paddingHorizontal: 16,
    },
  });
