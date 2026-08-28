/**
 * Shown under an empty result when the search ran against something other than
 * the title.
 *
 * A search field other than Title is easy to leave behind: it is set once from
 * a dropdown and then only shows up in the field's placeholder, so a later
 * search for a film by name comes back empty with nothing on screen explaining
 * why. This says which field was searched and offers the same query back
 * against titles, since that is what almost every empty non-title search
 * actually meant.
 */
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { SearchField } from "shared/client";

import { ThemedText } from "@/components/themed-text";
import { getSearchFieldLabel } from "@/components/inputs/SearchBar";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

type SearchFieldFallbackProps = {
  searchField: SearchField;
  /** The query as searched — with nothing typed, nothing was searched for. */
  query: string;
  onSearchByTitle: () => void;
};

export default function SearchFieldFallback({
  searchField,
  query,
  onSearchByTitle,
}: SearchFieldFallbackProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  if (searchField === "title" || query.trim().length === 0) return null;

  return (
    <View style={styles.container}>
      <View style={styles.noticeRow}>
        <MaterialIcons name="info-outline" size={15} color={colors.textSecondary} />
        <ThemedText style={styles.notice}>
          You are searching by {getSearchFieldLabel(searchField).toLowerCase()}, not by title.
        </ThemedText>
      </View>
      <TouchableOpacity
        style={styles.button}
        onPress={() => {
          triggerSelectionHaptic();
          onSearchByTitle();
        }}
        activeOpacity={0.8}
        accessibilityRole="button"
      >
        <MaterialIcons name="search" size={16} color={colors.pillText} />
        <ThemedText style={styles.buttonLabel}>Search titles instead</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    container: {
      marginTop: 14,
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 24,
    },
    noticeRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      // Wraps as a block under the icon rather than running past it.
      flexShrink: 1,
    },
    notice: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
      flexShrink: 1,
    },
    button: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 10,
      backgroundColor: colors.pillBackground,
      borderWidth: 1,
      borderColor: colors.pillBorder,
    },
    buttonLabel: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "500",
      color: colors.pillText,
    },
  });
