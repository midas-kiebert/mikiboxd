/**
 * The "Days" section of the Filters modal.
 *
 * Laid out as three steps, coarsest first: the three relative days (today /
 * tomorrow / the day after, each labelled with the date it resolves to), the
 * seven weekdays, and a row that opens the calendar for anything else. Every
 * token the section can produce is therefore visible without opening a sheet,
 * and the summary line on top spells the current selection out, so the section
 * shows what is selected rather than only a count.
 *
 * The calendar itself lives in SpecificDatesModal, rendered by the caller
 * (outside the Filters sheet) — this section only asks for it to be opened.
 */
import { useCallback, useMemo } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { DateTime } from "luxon";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import {
  AMSTERDAM_ZONE,
  RELATIVE_DAY_OPTIONS,
  WEEKDAY_DAY_OPTIONS,
  canonicalizeDaySelections,
  getDaySelectionLabel,
  isIsoDaySelection,
} from "@/components/filters/day-filter-utils";
import { useOptimisticValue } from "@/hooks/useOptimisticValue";
import { triggerSelectionHaptic } from "@/utils/long-press";

/** Dates named one by one in the calendar row before it falls back to a count. */
const MAX_NAMED_DATES = 2;

/** Order-insensitive, so the optimistic override is dropped as soon as the real state matches. */
const daySelectionsMatch = (left: string[], right: string[]) =>
  left.length === right.length && left.every((day) => right.includes(day));

type Props = {
  selectedDays: string[];
  onChange: (days: string[]) => void;
  /** Opens the calendar sheet; owned by the caller so it stacks over the Filters sheet. */
  onOpenSpecificDates: () => void;
};

export default function DaysFilterSection({
  selectedDays,
  onChange,
  onOpenSpecificDates,
}: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // A day toggle re-filters the whole list, so the chips paint from the
  // optimistic value and that work is deferred by a frame.
  const { value: displayDays, change: changeDays } = useOptimisticValue(
    selectedDays,
    onChange,
    daySelectionsMatch
  );

  // Selections arriving from a preset can still carry a literal ISO date for
  // today/tomorrow; canonicalizing first is what makes those light up the
  // relative cards instead of hiding in the specific-dates row.
  const days = useMemo(() => canonicalizeDaySelections(displayDays) ?? [], [displayDays]);
  const daySet = useMemo(() => new Set(days), [days]);

  const relativeDates = useMemo(() => {
    const today = DateTime.now().setZone(AMSTERDAM_ZONE).startOf("day");
    return RELATIVE_DAY_OPTIONS.map((option) => today.plus({ days: option.offset }).toFormat("EEE d LLL"));
  }, []);

  const specificDates = useMemo(() => days.filter(isIsoDaySelection), [days]);
  // A couple of dates are worth naming; past that the row would just truncate,
  // so it counts them instead and lets the calendar show which.
  const specificDatesLabel = useMemo(() => {
    if (specificDates.length === 0) return "No dates picked";
    if (specificDates.length > MAX_NAMED_DATES) return `${specificDates.length} dates picked`;
    return specificDates.map((day) => getDaySelectionLabel(day)).join(", ");
  }, [specificDates]);
  const summary = useMemo(
    () => days.map((day) => getDaySelectionLabel(day)).join(" · "),
    [days]
  );

  const toggle = useCallback(
    (token: string) => {
      triggerSelectionHaptic();
      changeDays(daySet.has(token) ? days.filter((day) => day !== token) : [...days, token]);
    },
    [changeDays, daySet, days]
  );

  const clearAll = useCallback(() => {
    triggerSelectionHaptic();
    changeDays([]);
  }, [changeDays]);

  return (
    <View style={styles.container}>
      <View style={styles.summaryRow}>
        <MaterialIcons
          name="event"
          size={15}
          color={days.length > 0 ? colors.tint : colors.textSecondary}
        />
        <ThemedText
          style={[styles.summaryText, days.length === 0 && styles.summaryTextEmpty]}
          numberOfLines={2}
        >
          {days.length > 0 ? summary : "Any day"}
        </ThemedText>
        {days.length > 0 && (
          <TouchableOpacity
            style={styles.clearButton}
            onPress={clearAll}
            activeOpacity={0.7}
            accessibilityRole="button"
          >
            <ThemedText style={styles.clearButtonText}>Clear</ThemedText>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.relativeRow}>
        {RELATIVE_DAY_OPTIONS.map((option, index) => {
          const isActive = daySet.has(option.token);
          return (
            <TouchableOpacity
              key={option.token}
              style={[styles.relativeCard, isActive && styles.cardActive]}
              onPress={() => toggle(option.token)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
            >
              <ThemedText
                style={[styles.relativeLabel, isActive && styles.textActive]}
                numberOfLines={2}
              >
                {option.label}
              </ThemedText>
              <ThemedText style={[styles.relativeDate, isActive && styles.subTextActive]}>
                {relativeDates[index]}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.weekdayRow}>
        {WEEKDAY_DAY_OPTIONS.map((option) => {
          const isActive = daySet.has(option.token);
          return (
            <TouchableOpacity
              key={option.token}
              style={[styles.weekdayChip, isActive && styles.cardActive]}
              onPress={() => toggle(option.token)}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={option.label}
              accessibilityState={{ selected: isActive }}
            >
              <ThemedText
                style={[styles.weekdayText, isActive && styles.textActive]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.85}
              >
                {option.shortLabel}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        style={[styles.calendarRow, specificDates.length > 0 && styles.calendarRowActive]}
        onPress={() => {
          triggerSelectionHaptic();
          onOpenSpecificDates();
        }}
        activeOpacity={0.8}
        accessibilityRole="button"
      >
        <View style={styles.calendarIcon}>
          <MaterialIcons name="calendar-month" size={17} color={colors.tint} />
        </View>
        <View style={styles.calendarTextBlock}>
          <ThemedText style={styles.calendarTitle}>Select specific dates</ThemedText>
          <ThemedText style={styles.calendarSubtitle} numberOfLines={1}>
            {specificDatesLabel}
          </ThemedText>
        </View>
        <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    container: { gap: 10 },
    summaryRow: { flexDirection: "row", alignItems: "center", gap: 7 },
    summaryText: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.text },
    summaryTextEmpty: { fontWeight: "500", color: colors.textSecondary },
    clearButton: { paddingHorizontal: 8, paddingVertical: 3 },
    clearButtonText: { fontSize: 12, fontWeight: "700", color: colors.tint },

    relativeRow: { flexDirection: "row", gap: 8 },
    relativeCard: {
      flex: 1,
      paddingHorizontal: 10,
      paddingVertical: 9,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      gap: 2,
    },
    // Two lines' worth of height on every card, so "Day After Tomorrow"
    // wrapping does not make its card taller than the other two.
    relativeLabel: { fontSize: 13, lineHeight: 16, minHeight: 32, fontWeight: "600", color: colors.text },
    relativeDate: { fontSize: 11, color: colors.textSecondary },

    weekdayRow: { flexDirection: "row", gap: 4 },
    weekdayChip: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1.5,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      alignItems: "center",
    },
    weekdayText: { fontSize: 12, fontWeight: "600", color: colors.text },

    // One active look for both the relative cards and the weekday chips.
    cardActive: { borderColor: colors.tint, backgroundColor: colors.pillActiveBackground },
    textActive: { color: colors.pillActiveText },
    subTextActive: { color: colors.pillActiveText, opacity: 0.8 },

    calendarRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
    },
    calendarRowActive: { borderColor: colors.tint },
    calendarIcon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceMuted,
    },
    calendarTextBlock: { flex: 1 },
    calendarTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
    calendarSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  });
