/**
 * Mobile filter UI component: Day Filter Modal.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
  type ListRenderItem,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DateTime } from "luxon";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type DayFilterModalProps = {
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
const AMSTERDAM_ZONE = "Europe/Amsterdam";
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

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
    const leadingEmpty = firstDay.weekday - 1; // Monday-based calendar
    const cells: (CalendarDay | null)[] = Array.from({ length: leadingEmpty }, () => null);

    monthDays.forEach((iso) => {
      const date = DateTime.fromISO(iso, { zone: AMSTERDAM_ZONE });
      cells.push({
        iso,
        label: date.toFormat("d"),
      });
    });

    const trailingEmpty = (7 - (cells.length % 7)) % 7;
    for (let index = 0; index < trailingEmpty; index += 1) {
      cells.push(null);
    }

    return {
      key: monthKey,
      label: monthLabel,
      cells,
    };
  });
}

type DayModalStyles = ReturnType<typeof createStyles>;

type DayCellProps = {
  cell: CalendarDay | null;
  isSelected: boolean;
  onToggleDay: (day: string) => void;
  styles: DayModalStyles;
};

const DayCell = memo(function DayCell({
  cell,
  isSelected,
  onToggleDay,
  styles,
}: DayCellProps) {
  if (!cell) {
    return <View style={styles.dayCellPlaceholder} />;
  }

  return (
    <View key={cell.iso} style={styles.dayCellWrapper}>
      <TouchableOpacity
        style={[
          styles.dayCell,
          isSelected && styles.dayCellSelected,
        ]}
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
  styles: DayModalStyles;
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

export default function DayFilterModal({
  visible,
  onClose,
  selectedDays,
  onChange,
}: DayFilterModalProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [localSelectedDaySet, setLocalSelectedDaySet] = useState<Set<string>>(
    () => new Set(selectedDays)
  );

  const today = DateTime.now().setZone(AMSTERDAM_ZONE).startOf("day");
  const todayKey = today.toISODate() ?? "";

  // Build/selectable calendar month sections once per "today" key change.
  const calendarMonths = useMemo(() => {
    if (!todayKey) return [];
    return buildCalendarMonths(todayKey);
  }, [todayKey]);

  // Start each modal session with current external selection.
  useEffect(() => {
    if (!visible) return;
    setLocalSelectedDaySet(new Set(selectedDays));
  }, [visible, selectedDays]);

  // Toggle the selection/state tied to the tapped UI element.
  const handleToggleDay = useCallback((day: string) => {
    setLocalSelectedDaySet((current) => {
      const next = new Set(current);
      if (next.has(day)) {
        next.delete(day);
      } else {
        next.add(day);
      }
      return next;
    });
  }, []);

  // Clear all selected day filters in one action.
  const handleClear = useCallback(() => setLocalSelectedDaySet(new Set()), []);

  const handleClose = useCallback(() => {
    const nextSelectedDays = Array.from(localSelectedDaySet).sort();
    if (!selectionsMatch(nextSelectedDays, selectedDays)) {
      onChange(nextSelectedDays);
    }
    onClose();
  }, [localSelectedDaySet, onChange, onClose, selectedDays]);

  const renderMonth: ListRenderItem<CalendarMonth> = useCallback(
    ({ item }) => (
      <CalendarMonthSection
        month={item}
        selectedDaySet={localSelectedDaySet}
        onToggleDay={handleToggleDay}
        styles={styles}
      />
    ),
    [handleToggleDay, localSelectedDaySet, styles]
  );

  // Render/output using the state and derived values prepared above.
  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={handleClose}
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.modalContainer} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>Days</ThemedText>
          <ThemedText style={styles.subtitle}>
            {localSelectedDaySet.size > 0
              ? `${localSelectedDaySet.size} day${localSelectedDaySet.size === 1 ? "" : "s"} selected`
              : "Select one or more days for showtimes"}
          </ThemedText>
        </View>

        <FlatList
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

        <View style={styles.footer}>
          <View style={styles.footerActions}>
            <TouchableOpacity
              style={[
                styles.footerButton,
                styles.footerButtonSubtle,
                localSelectedDaySet.size === 0 && styles.footerButtonDisabled,
              ]}
              onPress={handleClear}
              activeOpacity={0.8}
              disabled={localSelectedDaySet.size === 0}
            >
              <ThemedText
                style={[
                  styles.footerButtonText,
                  styles.footerButtonTextSubtle,
                  localSelectedDaySet.size === 0 && styles.footerButtonTextDisabled,
                ]}
              >
                Clear
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.footerButton, styles.footerButtonPrimary]}
              onPress={handleClose}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.footerButtonText, styles.footerButtonTextPrimary]}>
                Close
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    modalContainer: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 2,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    title: {
      fontSize: 18,
      fontWeight: "700",
    },
    subtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
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
      height: 44,
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
    footerActions: {
      flexDirection: "row",
      gap: 8,
    },
    footerButton: {
      flex: 1,
      minHeight: 42,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    footerButtonSubtle: {
      backgroundColor: colors.cardBackground,
      borderColor: colors.divider,
    },
    footerButtonPrimary: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    footerButtonDisabled: {
      opacity: 0.5,
    },
    footerButtonText: {
      fontSize: 13,
      fontWeight: "700",
    },
    footerButtonTextSubtle: {
      color: colors.textSecondary,
    },
    footerButtonTextPrimary: {
      color: colors.pillActiveText,
    },
    footerButtonTextDisabled: {
      color: colors.textSecondary,
    },
  });
