/**
 * Calendar sheet behind the Filters modal's "Select specific dates" row.
 *
 * Only the calendar: the relative days and the weekdays are picked inline in
 * DaysFilterSection, so this sheet exists purely for dates those shortcuts
 * cannot express. It still *shows* today/tomorrow/the day after as selected
 * (they are relative tokens, not ISO dates) so a day is never drawn unselected
 * while it is in fact being filtered on — and tapping such a day clears the
 * relative token behind it. Weekday tokens are left untouched, both on screen
 * and by "Clear dates".
 *
 * Changes are applied when the sheet closes, matching how the Filters modal
 * commits the rest of the filter state.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, TouchableOpacity, View, type ListRenderItem } from "react-native";
import { BottomSheetFlatList } from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { DateTime } from "luxon";

import { ThemedText } from "@/components/themed-text";
import AppBottomSheet from "@/components/sheets/AppBottomSheet";
import { triggerSelectionHaptic } from "@/utils/long-press";
import {
  AMSTERDAM_ZONE,
  RELATIVE_DAY_OPTIONS,
  canonicalizeDaySelections,
  isIsoDaySelection,
} from "@/components/filters/day-filter-utils";
import { useThemeColors } from "@/hooks/use-theme-color";

type SpecificDatesModalProps = {
  visible: boolean;
  onClose: () => void;
  selectedDays: string[];
  onChange: (days: string[]) => void;
};

type CalendarDay = {
  iso: string;
  label: string;
};

type CalendarMonth = {
  key: string;
  label: string;
  cells: (CalendarDay | null)[];
};

const DAY_RANGE = 180;
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const RELATIVE_TOKENS = new Set<string>(RELATIVE_DAY_OPTIONS.map((option) => option.token));

/** A day this sheet owns: an explicit date, or one of the relative tokens it draws. */
const isDateSelection = (value: string) => isIsoDaySelection(value) || RELATIVE_TOKENS.has(value);

const selectionsMatch = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  return left.every((day) => right.includes(day));
};

function buildDays(startIso: string) {
  const start = DateTime.fromISO(startIso, { zone: AMSTERDAM_ZONE });
  return Array.from({ length: DAY_RANGE }, (_, index) =>
    start.plus({ days: index }).toISODate()
  ).filter((day): day is string => Boolean(day));
}

function buildCalendarMonths(startIso: string): CalendarMonth[] {
  const days = buildDays(startIso);
  if (days.length === 0) return [];

  const groupedByMonth = new Map<string, string[]>();
  days.forEach((iso) => {
    const monthKey = iso.slice(0, 7);
    const monthDays = groupedByMonth.get(monthKey);
    if (monthDays) {
      monthDays.push(iso);
      return;
    }
    groupedByMonth.set(monthKey, [iso]);
  });

  return Array.from(groupedByMonth.entries()).map(([monthKey, monthDays]) => {
    const firstDay = DateTime.fromISO(monthDays[0], { zone: AMSTERDAM_ZONE });
    const monthLabel = firstDay.toFormat("LLLL yyyy");
    const leadingEmpty = firstDay.weekday - 1;
    const cells: (CalendarDay | null)[] = Array.from({ length: leadingEmpty }, () => null);

    monthDays.forEach((iso) => {
      const date = DateTime.fromISO(iso, { zone: AMSTERDAM_ZONE });
      cells.push({ iso, label: date.toFormat("d") });
    });

    const trailingEmpty = (7 - (cells.length % 7)) % 7;
    for (let index = 0; index < trailingEmpty; index += 1) {
      cells.push(null);
    }

    return { key: monthKey, label: monthLabel, cells };
  });
}

type CalendarStyles = ReturnType<typeof createStyles>;

type DayCellProps = {
  cell: CalendarDay | null;
  isSelected: boolean;
  onToggleDay: (day: string) => void;
  styles: CalendarStyles;
};

const DayCell = memo(function DayCell({ cell, isSelected, onToggleDay, styles }: DayCellProps) {
  if (!cell) {
    return <View style={styles.dayCellPlaceholder} />;
  }

  return (
    <View key={cell.iso} style={styles.dayCellWrapper}>
      <TouchableOpacity
        style={[styles.dayCell, isSelected && styles.dayCellSelected]}
        onPress={() => onToggleDay(cell.iso)}
        activeOpacity={0.8}
      >
        <ThemedText style={[styles.dayCellText, isSelected && styles.dayCellTextSelected]}>
          {cell.label}
        </ThemedText>
      </TouchableOpacity>
    </View>
  );
});

type CalendarMonthSectionProps = {
  month: CalendarMonth;
  selectedDaySet: Set<string>;
  onToggleDay: (day: string) => void;
  styles: CalendarStyles;
};

const CalendarMonthSection = memo(function CalendarMonthSection({
  month,
  selectedDaySet,
  onToggleDay,
  styles,
}: CalendarMonthSectionProps) {
  return (
    <View style={styles.monthSection}>
      <ThemedText style={styles.monthTitle}>{month.label}</ThemedText>
      <View style={styles.weekdayRow}>
        {WEEKDAY_LABELS.map((label) => (
          <View key={`${month.key}-${label}`} style={styles.weekdayCell}>
            <ThemedText style={styles.weekdayText}>{label}</ThemedText>
          </View>
        ))}
      </View>
      <View style={styles.calendarGrid}>
        {month.cells.map((cell, index) => (
          <DayCell
            key={cell?.iso ?? `${month.key}-empty-${index}`}
            cell={cell}
            isSelected={cell ? selectedDaySet.has(cell.iso) : false}
            onToggleDay={onToggleDay}
            styles={styles}
          />
        ))}
      </View>
    </View>
  );
});

export default function SpecificDatesModal({
  visible,
  onClose,
  selectedDays,
  onChange,
}: SpecificDatesModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // The sheet is anchored to the bottom of the screen, so the footer sits on top
  // of the home indicator / Android gesture bar without this.
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [localSelectedDaySet, setLocalSelectedDaySet] = useState<Set<string>>(
    () => new Set(canonicalizeDaySelections(selectedDays) ?? [])
  );

  const todayKey = DateTime.now().setZone(AMSTERDAM_ZONE).startOf("day").toISODate() ?? "";

  const calendarMonths = useMemo(() => {
    if (!todayKey) return [];
    return buildCalendarMonths(todayKey);
  }, [todayKey]);

  useEffect(() => {
    if (!visible) return;
    queueMicrotask(() =>
      setLocalSelectedDaySet(new Set(canonicalizeDaySelections(selectedDays) ?? []))
    );
  }, [visible, selectedDays]);

  const selectedCalendarDaySet = useMemo(() => {
    if (!todayKey) return new Set<string>();
    const today = DateTime.fromISO(todayKey, { zone: AMSTERDAM_ZONE });
    const isoSelections = new Set<string>();
    localSelectedDaySet.forEach((value) => {
      if (isIsoDaySelection(value)) isoSelections.add(value);
    });
    RELATIVE_DAY_OPTIONS.forEach((option) => {
      if (!localSelectedDaySet.has(option.token)) return;
      const iso = today.plus({ days: option.offset }).toISODate();
      if (iso) isoSelections.add(iso);
    });
    return isoSelections;
  }, [localSelectedDaySet, todayKey]);

  const relativeTokenByIsoDay = useMemo(() => {
    const byIsoDay = new Map<string, string>();
    if (!todayKey) return byIsoDay;
    const today = DateTime.fromISO(todayKey, { zone: AMSTERDAM_ZONE });
    RELATIVE_DAY_OPTIONS.forEach((option) => {
      const iso = today.plus({ days: option.offset }).toISODate();
      if (!iso) return;
      byIsoDay.set(iso, option.token);
    });
    return byIsoDay;
  }, [todayKey]);

  const handleToggleDay = useCallback(
    (day: string) => {
      triggerSelectionHaptic();
      setLocalSelectedDaySet((current) => {
        const next = new Set(current);
        const linkedRelativeToken = relativeTokenByIsoDay.get(day);
        const isSelected =
          next.has(day) || (linkedRelativeToken !== undefined && next.has(linkedRelativeToken));
        if (isSelected) {
          next.delete(day);
          if (linkedRelativeToken !== undefined) next.delete(linkedRelativeToken);
        } else {
          next.add(day);
        }
        return next;
      });
    },
    [relativeTokenByIsoDay]
  );

  // Clears only what this sheet shows; the weekdays picked in the section
  // behind it are not this button's to throw away.
  const handleClearDates = useCallback(() => {
    triggerSelectionHaptic();
    setLocalSelectedDaySet(
      (current) => new Set(Array.from(current).filter((day) => !isDateSelection(day)))
    );
  }, []);

  const hasDateSelections = useMemo(
    () => Array.from(localSelectedDaySet).some(isDateSelection),
    [localSelectedDaySet]
  );

  const handleClose = useCallback(() => {
    const nextSelectedDays = canonicalizeDaySelections(Array.from(localSelectedDaySet)) ?? [];
    const currentSelectedDays = canonicalizeDaySelections(selectedDays) ?? [];
    if (!selectionsMatch(nextSelectedDays, currentSelectedDays)) {
      onChange(nextSelectedDays);
    }
    onClose();
  }, [localSelectedDaySet, onChange, onClose, selectedDays]);

  const renderMonth: ListRenderItem<CalendarMonth> = useCallback(
    ({ item }) => (
      <CalendarMonthSection
        month={item}
        selectedDaySet={selectedCalendarDaySet}
        onToggleDay={handleToggleDay}
        styles={styles}
      />
    ),
    [handleToggleDay, selectedCalendarDaySet, styles]
  );

  return (
    <AppBottomSheet visible={visible} onClose={handleClose} onBack={onClose} title="Specific dates">
      <BottomSheetFlatList
        style={styles.mainContent}
        contentContainerStyle={styles.content}
        data={calendarMonths}
        keyExtractor={(item) => item.key}
        renderItem={renderMonth}
        initialNumToRender={2}
        maxToRenderPerBatch={2}
        windowSize={5}
        removeClippedSubviews
        showsVerticalScrollIndicator={false}
      />
      <View style={[styles.footer, { paddingBottom: Math.max(bottomInset, 10) }]}>
        <TouchableOpacity
          style={[styles.footerButton, !hasDateSelections && styles.footerButtonDisabled]}
          onPress={handleClearDates}
          activeOpacity={0.8}
          disabled={!hasDateSelections}
        >
          <ThemedText
            style={[styles.footerButtonText, !hasDateSelections && styles.footerButtonTextDisabled]}
          >
            Clear dates
          </ThemedText>
        </TouchableOpacity>
      </View>
    </AppBottomSheet>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    mainContent: {
      flex: 1,
    },
    content: {
      padding: 16,
      paddingBottom: 20,
      gap: 16,
    },
    monthSection: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 12,
      paddingVertical: 12,
      gap: 10,
    },
    monthTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
      textTransform: "capitalize",
    },
    weekdayRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderColor: colors.divider,
      paddingBottom: 6,
    },
    weekdayCell: {
      width: "14.2857%",
      alignItems: "center",
    },
    weekdayText: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    calendarGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
    },
    dayCellWrapper: {
      width: "14.2857%",
      alignItems: "center",
      paddingTop: 8,
    },
    dayCellPlaceholder: {
      width: "14.2857%",
      // Must match dayCellWrapper's paddingTop + dayCell's height, or the first
      // week of each month (the row with leading blanks) sits 6pt too low.
      height: 38,
      marginTop: 8,
    },
    dayCell: {
      width: 38,
      height: 38,
      borderRadius: 19,
      borderWidth: 1,
      borderColor: "transparent",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.cardBackground,
    },
    dayCellSelected: {
      borderColor: colors.tint,
      backgroundColor: colors.tint,
    },
    dayCellText: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
    },
    dayCellTextSelected: {
      color: colors.pillActiveText,
    },
    footer: {
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      backgroundColor: colors.background,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 10,
    },
    footerButton: {
      minHeight: 42,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.cardBackground,
      borderColor: colors.divider,
    },
    footerButtonDisabled: {
      opacity: 0.5,
    },
    footerButtonText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    footerButtonTextDisabled: {
      color: colors.textSecondary,
    },
  });
