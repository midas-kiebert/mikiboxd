/**
 * A compact, grouped list of cinemas with a checkbox each, sized to sit inside a
 * dialog rather than a full sheet. Cities with enough cinemas get their own
 * section and a select-all shortcut; the rest share an "Other cinemas" bucket.
 *
 * Per-city deselecting is opt-in (`onDeselectCinemas`): in a dialog one global
 * clear is easier to find than a row of per-section clear links, but the full
 * cinema sheet is long enough that walking back up to it is a chore.
 *
 * Presentational: the caller owns the selection and decides what it means.
 */
import { memo, useMemo } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import type { CinemaPublic } from "shared";

import { groupCinemas } from "@/components/filters/cinema-grouping";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

type ThemeColors = typeof import("@/constants/theme").Colors.light;
type Styles = ReturnType<typeof createStyles>;

type CinemaChipProps = {
  cinema: CinemaPublic;
  showCity: boolean;
  isSelected: boolean;
  styles: Styles;
  accentColor: string;
  checkColor: string;
  onToggle: (cinemaId: number) => void;
};

const CinemaChip = memo(function CinemaChip({
  cinema,
  showCity,
  isSelected,
  styles,
  accentColor,
  checkColor,
  onToggle,
}: CinemaChipProps) {
  return (
    <TouchableOpacity
      style={[styles.chip, isSelected && styles.chipSelected]}
      onPress={() => {
        triggerSelectionHaptic();
        onToggle(cinema.id);
      }}
      activeOpacity={0.8}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isSelected }}
      accessibilityLabel={cinema.name}
    >
      <View style={styles.chipText}>
        <ThemedText numberOfLines={1} style={styles.chipName}>
          {cinema.name}
        </ThemedText>
        {showCity ? (
          <ThemedText numberOfLines={1} style={styles.chipCity}>
            {cinema.city.name}
          </ThemedText>
        ) : null}
      </View>
      <View
        style={[
          styles.checkbox,
          isSelected && { borderColor: accentColor, backgroundColor: accentColor },
        ]}
      >
        {isSelected ? <MaterialIcons name="check" size={11} color={checkColor} /> : null}
      </View>
    </TouchableOpacity>
  );
});

type CinemaPickerListProps = {
  cinemas: readonly CinemaPublic[];
  selectedIds: ReadonlySet<number>;
  onToggleCinema: (cinemaId: number) => void;
  /** Add a whole city at once. */
  onSelectCinemas: (cinemaIds: readonly number[]) => void;
  /** Drop a whole city at once. Omit to leave clearing to the caller's own control. */
  onDeselectCinemas?: (cinemaIds: readonly number[]) => void;
};

export default function CinemaPickerList({
  cinemas,
  selectedIds,
  onToggleCinema,
  onSelectCinemas,
  onDeselectCinemas,
}: CinemaPickerListProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { groupedCities, ungrouped } = useMemo(() => groupCinemas(cinemas), [cinemas]);

  const sections = useMemo(
    () => [
      ...groupedCities.map((group) => ({
        key: `city-${group.city.id}`,
        title: group.city.name,
        cinemas: group.cinemas,
        canSelectAll: true,
        showCity: false,
      })),
      // The leftovers span several cities, so "select all" there would not mean
      // anything a user could predict.
      ...(ungrouped.length > 0
        ? [
            {
              key: "other-cinemas",
              title: "Other cinemas",
              cinemas: ungrouped,
              canSelectAll: false,
              showCity: true,
            },
          ]
        : []),
    ],
    [groupedCities, ungrouped]
  );

  const accentColorByCinemaId = useMemo(
    () =>
      new Map(
        cinemas.map((cinema) => {
          const palette = (colors as Record<string, { primary: string; secondary: string }>)[
            cinema.badge_bg_color
          ];
          return [cinema.id, palette?.secondary ?? colors.textSecondary] as const;
        })
      ),
    [cinemas, colors]
  );

  return (
    <View style={styles.container}>
      {sections.map((section) => {
        const sectionIds = section.cinemas.map((cinema) => cinema.id);
        const isSectionSelected = sectionIds.every((id) => selectedIds.has(id));
        const sectionToggle = !section.canSelectAll
          ? null
          : isSectionSelected
            ? onDeselectCinemas && { label: "Deselect all", apply: onDeselectCinemas }
            : { label: "Select all", apply: onSelectCinemas };
        return (
          <View key={section.key} style={styles.section}>
            <View style={styles.sectionHeader}>
              <ThemedText style={styles.sectionTitle}>{section.title}</ThemedText>
              {sectionToggle ? (
                <TouchableOpacity
                  onPress={() => {
                    triggerSelectionHaptic();
                    sectionToggle.apply(sectionIds);
                  }}
                  activeOpacity={0.7}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`${sectionToggle.label} cinemas in ${section.title}`}
                >
                  <ThemedText style={styles.sectionAction}>{sectionToggle.label}</ThemedText>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={styles.chipRow}>
              {section.cinemas.map((cinema) => (
                <CinemaChip
                  key={cinema.id}
                  cinema={cinema}
                  showCity={section.showCity}
                  isSelected={selectedIds.has(cinema.id)}
                  styles={styles}
                  accentColor={accentColorByCinemaId.get(cinema.id) ?? colors.textSecondary}
                  checkColor={colors.pillActiveText}
                  onToggle={onToggleCinema}
                />
              ))}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      gap: 12,
    },
    section: {
      gap: 6,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    sectionAction: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.tint,
    },
    sectionTitle: {
      fontSize: 11,
      fontWeight: "700",
      textTransform: "uppercase",
      letterSpacing: 0.6,
      color: colors.textSecondary,
    },
    chipRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      maxWidth: "100%",
      columnGap: 6,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      // Unselected chips are outlines, so the list looks the same whichever
      // surface it sits on (a tip's dialog, or the nested cinema sheet).
      backgroundColor: "transparent",
    },
    chipSelected: {
      backgroundColor: colors.pillBackground,
    },
    chipText: {
      flexShrink: 1,
      gap: 1,
    },
    chipName: {
      fontSize: 12,
      fontWeight: "600",
    },
    chipCity: {
      fontSize: 10,
      color: colors.textSecondary,
    },
    checkbox: {
      width: 13,
      height: 13,
      borderRadius: 6.5,
      borderWidth: 1.2,
      borderColor: colors.divider,
      backgroundColor: "transparent",
      alignItems: "center",
      justifyContent: "center",
    },
  });
