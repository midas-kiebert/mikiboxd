import { useMemo } from "react";
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
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

const DAY_RANGE = 30;
const AMSTERDAM_ZONE = "Europe/Amsterdam";

function buildDays(startIso: string) {
  const start = DateTime.fromISO(startIso, { zone: AMSTERDAM_ZONE });
  return Array.from({ length: DAY_RANGE }, (_, index) =>
    start.plus({ days: index }).toISODate()
  ).filter((day): day is string => Boolean(day));
}

export default function DayFilterModal({
  visible,
  onClose,
  selectedDays,
  onChange,
}: DayFilterModalProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const today = DateTime.now().setZone(AMSTERDAM_ZONE).startOf("day");
  const todayKey = today.toISODate() ?? "";

  const availableDays = useMemo(() => {
    if (!todayKey) return [];
    return buildDays(todayKey);
  }, [todayKey]);

  const handleToggleDay = (day: string) => {
    const isSelected = selectedDays.includes(day);
    const next = isSelected
      ? selectedDays.filter((selectedDay) => selectedDay !== day)
      : [...selectedDays, day];
    next.sort();
    onChange(next);
  };

  const handleClear = () => onChange([]);

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.modalContainer} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>Days</ThemedText>
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={[styles.headerButton, selectedDays.length === 0 && styles.headerButtonDisabled]}
              onPress={handleClear}
              activeOpacity={0.8}
              disabled={selectedDays.length === 0}
            >
              <ThemedText
                style={[
                  styles.headerButtonText,
                  selectedDays.length === 0 && styles.headerButtonTextDisabled,
                ]}
              >
                Clear
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerButton}
              onPress={onClose}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.headerButtonText}>Close</ThemedText>
            </TouchableOpacity>
          </View>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <ThemedText style={styles.helperText}>
            Select one or more days for showtimes.
          </ThemedText>
          <View style={styles.daysGrid}>
            {availableDays.map((day) => {
              const date = DateTime.fromISO(day, { zone: AMSTERDAM_ZONE });
              const isSelected = selectedDays.includes(day);
              const isToday = day === todayKey;
              return (
                <TouchableOpacity
                  key={day}
                  style={[styles.dayChip, isSelected && styles.dayChipSelected]}
                  onPress={() => handleToggleDay(day)}
                  activeOpacity={0.8}
                >
                  <ThemedText
                    style={[styles.dayLabel, isSelected && styles.dayLabelSelected]}
                  >
                    {isToday ? "Today" : date.toFormat("ccc")}
                  </ThemedText>
                  <ThemedText
                    style={[styles.dayDate, isSelected && styles.dayLabelSelected]}
                  >
                    {date.toFormat("d LLL")}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
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
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    title: {
      fontSize: 18,
      fontWeight: "700",
    },
    headerActions: {
      flexDirection: "row",
      gap: 8,
    },
    headerButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: colors.pillBackground,
    },
    headerButtonDisabled: {
      backgroundColor: colors.divider,
    },
    headerButtonText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    headerButtonTextDisabled: {
      color: colors.textSecondary,
      opacity: 0.6,
    },
    content: {
      padding: 16,
      paddingBottom: 32,
      gap: 16,
    },
    helperText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    daysGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 10,
    },
    dayChip: {
      width: "30%",
      paddingVertical: 12,
      paddingHorizontal: 10,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      alignItems: "center",
      gap: 4,
    },
    dayChipSelected: {
      borderColor: colors.tint,
      backgroundColor: colors.tint,
    },
    dayLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    dayDate: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    dayLabelSelected: {
      color: colors.pillActiveText,
    },
  });
