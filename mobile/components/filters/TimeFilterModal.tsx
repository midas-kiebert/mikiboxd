/**
 * Mobile filter UI component: Time Filter Modal.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { TIME_FILTER_PRESETS, getPresetForRange } from "@/components/filters/time-filter-presets";
import { useRef } from "react";

type TimeFilterModalProps = {
  visible: boolean;
  onClose: () => void;
  selectedTimeRanges: string[];
  onChange: (timeRanges: string[]) => void;
};

const WHEEL_ITEM_HEIGHT = 36;
const WHEEL_VISIBLE_ITEMS = 5;
const WHEEL_CONTAINER_HEIGHT = WHEEL_ITEM_HEIGHT * WHEEL_VISIBLE_ITEMS;
const WHEEL_SIDE_PADDING = ((WHEEL_VISIBLE_ITEMS - 1) / 2) * WHEEL_ITEM_HEIGHT;
const HOUR_VALUES = Array.from({ length: 24 }, (_, value) =>
  String(value).padStart(2, "0")
);
const MINUTE_VALUES = Array.from({ length: 60 }, (_, value) =>
  String(value).padStart(2, "0")
);

const selectionsMatch = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  return left.every((value) => right.includes(value));
};

function normalizeTime(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function formatCustomRangeLabel(range: string) {
  const preset = getPresetForRange(range);
  if (preset) return `${preset.label} (${preset.range})`;
  const [start = "", end = ""] = range.split("-", 2);
  if (start && end) return `${start}-${end}`;
  if (start) return `${start}+`;
  if (end) return `Until ${end}`;
  return range;
}

type TimeModalStyles = ReturnType<typeof createStyles>;

type TimeWheelProps = {
  values: ReadonlyArray<string>;
  selectedIndex: number;
  onChangeIndex: (nextIndex: number) => void;
  styles: TimeModalStyles;
};

const clampIndex = (value: number, max: number) =>
  Math.max(0, Math.min(value, max));

const TimeWheel = memo(function TimeWheel({
  values,
  selectedIndex,
  onChangeIndex,
  styles,
}: TimeWheelProps) {
  const scrollRef = useRef<ScrollView>(null);

  const scrollToIndex = useCallback((index: number) => {
    scrollRef.current?.scrollTo({
      y: index * WHEEL_ITEM_HEIGHT,
      animated: false,
    });
  }, []);

  useEffect(() => {
    scrollToIndex(selectedIndex);
  }, [scrollToIndex, selectedIndex]);

  const handleScrollEnd = useCallback(
    (offsetY: number) => {
      const rawIndex = Math.round(offsetY / WHEEL_ITEM_HEIGHT);
      const nextIndex = clampIndex(rawIndex, values.length - 1);
      onChangeIndex(nextIndex);
      scrollRef.current?.scrollTo({
        y: nextIndex * WHEEL_ITEM_HEIGHT,
        animated: true,
      });
    },
    [onChangeIndex, values.length]
  );

  return (
    <View style={styles.wheelContainer}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        snapToInterval={WHEEL_ITEM_HEIGHT}
        decelerationRate="fast"
        contentContainerStyle={styles.wheelContent}
        onLayout={() => scrollToIndex(selectedIndex)}
        onScrollEndDrag={(event) =>
          handleScrollEnd(event.nativeEvent.contentOffset.y)
        }
        onMomentumScrollEnd={({ nativeEvent }) => {
          handleScrollEnd(nativeEvent.contentOffset.y);
        }}
      >
        {values.map((item, index) => {
          const selected = index === selectedIndex;
          return (
            <View key={`${item}-${index}`} style={styles.wheelItem}>
              <ThemedText
                style={[
                  styles.wheelItemText,
                  selected && styles.wheelItemTextSelected,
                ]}
              >
                {item}
              </ThemedText>
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.wheelSelectionOverlay} pointerEvents="none" />
    </View>
  );
});

type PresetChipProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
  styles: TimeModalStyles;
};

const PresetChip = memo(function PresetChip({
  label,
  selected,
  onPress,
  styles,
}: PresetChipProps) {
  return (
    <TouchableOpacity
      style={[styles.presetChip, selected && styles.presetChipSelected]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <ThemedText style={[styles.presetChipText, selected && styles.presetChipTextSelected]}>
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
});

type RangeChipProps = {
  range: string;
  onRemove: (range: string) => void;
  styles: TimeModalStyles;
};

const RangeChip = memo(function RangeChip({ range, onRemove, styles }: RangeChipProps) {
  return (
    <View style={styles.rangeChip}>
      <ThemedText style={styles.rangeChipText}>{formatCustomRangeLabel(range)}</ThemedText>
      <TouchableOpacity onPress={() => onRemove(range)} hitSlop={8} style={styles.rangeChipRemove}>
        <ThemedText style={styles.rangeChipRemoveText}>x</ThemedText>
      </TouchableOpacity>
    </View>
  );
});

export default function TimeFilterModal({
  visible,
  onClose,
  selectedTimeRanges,
  onChange,
}: TimeFilterModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [localSelectedTimeRanges, setLocalSelectedTimeRanges] = useState<string[]>(selectedTimeRanges);
  const [hasStartTime, setHasStartTime] = useState(false);
  const [hasEndTime, setHasEndTime] = useState(false);
  const [startHourIndex, setStartHourIndex] = useState(9);
  const [startMinuteIndex, setStartMinuteIndex] = useState(0);
  const [endHourIndex, setEndHourIndex] = useState(12);
  const [endMinuteIndex, setEndMinuteIndex] = useState(0);
  const [inputError, setInputError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setLocalSelectedTimeRanges(selectedTimeRanges);
    setHasStartTime(false);
    setHasEndTime(false);
    setStartHourIndex(9);
    setStartMinuteIndex(0);
    setEndHourIndex(12);
    setEndMinuteIndex(0);
    setInputError(null);
  }, [visible, selectedTimeRanges]);

  const handleToggleRange = useCallback((range: string) => {
    setLocalSelectedTimeRanges((current) => {
      if (current.includes(range)) {
        return current.filter((value) => value !== range);
      }
      return [...current, range];
    });
  }, []);

  const handleRemoveRange = useCallback((range: string) => {
    setLocalSelectedTimeRanges((current) => current.filter((value) => value !== range));
  }, []);

  const handleAddCustomRange = useCallback(() => {
    if (!hasStartTime && !hasEndTime) {
      setInputError("Set at least a start or end time.");
      return;
    }

    const start = hasStartTime
      ? normalizeTime(`${HOUR_VALUES[startHourIndex]}:${MINUTE_VALUES[startMinuteIndex]}`)
      : "";
    const end = hasEndTime
      ? normalizeTime(`${HOUR_VALUES[endHourIndex]}:${MINUTE_VALUES[endMinuteIndex]}`)
      : "";

    if (start === null || end === null) {
      setInputError("Use HH:MM format, for example 09:30.");
      return;
    }

    if (start === end) {
      setInputError("Start and end cannot be the same.");
      return;
    }

    const range = `${start}-${end}`;
    setLocalSelectedTimeRanges((current) => {
      if (current.includes(range)) return current;
      return [...current, range];
    });
    setHasStartTime(false);
    setHasEndTime(false);
    setStartHourIndex(9);
    setStartMinuteIndex(0);
    setEndHourIndex(12);
    setEndMinuteIndex(0);
    setInputError(null);
  }, [endHourIndex, endMinuteIndex, hasEndTime, hasStartTime, startHourIndex, startMinuteIndex]);

  const handleClear = useCallback(() => {
    setLocalSelectedTimeRanges([]);
    setInputError(null);
  }, []);

  const handleClose = useCallback(() => {
    const nextTimeRanges = [...localSelectedTimeRanges];
    if (!selectionsMatch(nextTimeRanges, selectedTimeRanges)) {
      onChange(nextTimeRanges);
    }
    onClose();
  }, [localSelectedTimeRanges, onChange, onClose, selectedTimeRanges]);

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={handleClose}
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.modalContainer} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>Times</ThemedText>
          <ThemedText style={styles.subtitle}>
            {localSelectedTimeRanges.length > 0
              ? `${localSelectedTimeRanges.length} range${localSelectedTimeRanges.length === 1 ? "" : "s"} selected`
              : "Select presets or add custom showtime ranges"}
          </ThemedText>
        </View>

        <ScrollView style={styles.mainContent} contentContainerStyle={styles.content}>
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Time of Day</ThemedText>
            <View style={styles.presetGrid}>
              {TIME_FILTER_PRESETS.map((preset) => (
                <PresetChip
                  key={preset.id}
                  label={preset.label}
                  selected={localSelectedTimeRanges.includes(preset.range)}
                  onPress={() => handleToggleRange(preset.range)}
                  styles={styles}
                />
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Custom Range</ThemedText>
            <ThemedText style={styles.sectionHint}>
              Use the wheels like an alarm clock. Start or end can stay open, and crossing midnight is supported.
            </ThemedText>
            <View style={styles.customInputColumn}>
              <View style={styles.customField}>
                <View style={styles.customFieldHeader}>
                  <ThemedText style={styles.customFieldTitle}>Start</ThemedText>
                  <TouchableOpacity
                    style={styles.boundaryToggle}
                    onPress={() => {
                      setHasStartTime((current) => !current);
                      if (inputError) setInputError(null);
                    }}
                    activeOpacity={0.8}
                  >
                    <ThemedText style={styles.boundaryToggleText}>
                      {hasStartTime ? "Set" : "Open"}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
                {hasStartTime ? (
                  <View style={styles.timeWheelRow}>
                    <TimeWheel
                      values={HOUR_VALUES}
                      selectedIndex={startHourIndex}
                      onChangeIndex={setStartHourIndex}
                      styles={styles}
                    />
                    <ThemedText style={styles.wheelColon}>:</ThemedText>
                    <TimeWheel
                      values={MINUTE_VALUES}
                      selectedIndex={startMinuteIndex}
                      onChangeIndex={setStartMinuteIndex}
                      styles={styles}
                    />
                  </View>
                ) : (
                  <ThemedText style={styles.openBoundaryText}>Open start</ThemedText>
                )}
              </View>

              <View style={styles.customField}>
                <View style={styles.customFieldHeader}>
                  <ThemedText style={styles.customFieldTitle}>End</ThemedText>
                  <TouchableOpacity
                    style={styles.boundaryToggle}
                    onPress={() => {
                      setHasEndTime((current) => !current);
                      if (inputError) setInputError(null);
                    }}
                    activeOpacity={0.8}
                  >
                    <ThemedText style={styles.boundaryToggleText}>
                      {hasEndTime ? "Set" : "Open"}
                    </ThemedText>
                  </TouchableOpacity>
                </View>
                {hasEndTime ? (
                  <View style={styles.timeWheelRow}>
                    <TimeWheel
                      values={HOUR_VALUES}
                      selectedIndex={endHourIndex}
                      onChangeIndex={setEndHourIndex}
                      styles={styles}
                    />
                    <ThemedText style={styles.wheelColon}>:</ThemedText>
                    <TimeWheel
                      values={MINUTE_VALUES}
                      selectedIndex={endMinuteIndex}
                      onChangeIndex={setEndMinuteIndex}
                      styles={styles}
                    />
                  </View>
                ) : (
                  <ThemedText style={styles.openBoundaryText}>Open end</ThemedText>
                )}
              </View>

              <View style={styles.customAddButtonRow}>
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={handleAddCustomRange}
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.addButtonText}>Add Range</ThemedText>
                </TouchableOpacity>
              </View>
            </View>
            {inputError ? <ThemedText style={styles.inputError}>{inputError}</ThemedText> : null}
          </View>

          {localSelectedTimeRanges.length > 0 ? (
            <View style={styles.section}>
              <ThemedText style={styles.sectionTitle}>Selected</ThemedText>
              <View style={styles.selectedRangeWrap}>
                {localSelectedTimeRanges.map((range) => (
                  <RangeChip
                    key={range}
                    range={range}
                    onRemove={handleRemoveRange}
                    styles={styles}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <View style={styles.footerActions}>
            <TouchableOpacity
              style={[
                styles.footerButton,
                styles.footerButtonSubtle,
                localSelectedTimeRanges.length === 0 && styles.footerButtonDisabled,
              ]}
              onPress={handleClear}
              activeOpacity={0.8}
              disabled={localSelectedTimeRanges.length === 0}
            >
              <ThemedText
                style={[
                  styles.footerButtonText,
                  styles.footerButtonTextSubtle,
                  localSelectedTimeRanges.length === 0 && styles.footerButtonTextDisabled,
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
      gap: 16,
      paddingBottom: 20,
    },
    section: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 12,
      paddingVertical: 12,
      gap: 10,
    },
    sectionTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
    },
    sectionHint: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    presetGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    presetChip: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    presetChipSelected: {
      borderColor: colors.tint,
      backgroundColor: colors.tint,
    },
    presetChipText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    presetChipTextSelected: {
      color: colors.pillActiveText,
    },
    customInputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    customInputColumn: {
      gap: 12,
    },
    customField: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.background,
      padding: 10,
      gap: 8,
    },
    customFieldHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    customFieldTitle: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    boundaryToggle: {
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 10,
      paddingVertical: 5,
    },
    boundaryToggleText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    openBoundaryText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    timeWheelRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
    },
    wheelContainer: {
      width: 72,
      height: WHEEL_CONTAINER_HEIGHT,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.searchBackground,
      overflow: "hidden",
    },
    wheelContent: {
      paddingVertical: WHEEL_SIDE_PADDING,
    },
    wheelItem: {
      height: WHEEL_ITEM_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
    },
    wheelItemText: {
      fontSize: 16,
      fontWeight: "500",
      color: colors.textSecondary,
    },
    wheelItemTextSelected: {
      fontWeight: "700",
      color: colors.text,
    },
    wheelSelectionOverlay: {
      position: "absolute",
      left: 0,
      right: 0,
      top: (WHEEL_CONTAINER_HEIGHT - WHEEL_ITEM_HEIGHT) / 2,
      height: WHEEL_ITEM_HEIGHT,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.divider,
      backgroundColor: "rgba(255,255,255,0.04)",
    },
    wheelColon: {
      fontSize: 20,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    customAddButtonRow: {
      flexDirection: "row",
      justifyContent: "flex-end",
    },
    addButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.tint,
      backgroundColor: colors.tint,
      paddingHorizontal: 14,
      paddingVertical: 9,
      alignItems: "center",
      justifyContent: "center",
    },
    addButtonText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.pillActiveText,
    },
    inputError: {
      fontSize: 12,
      color: colors.red.secondary,
    },
    selectedRangeWrap: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    rangeChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
      paddingVertical: 6,
      paddingLeft: 10,
      paddingRight: 8,
    },
    rangeChipText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.text,
    },
    rangeChipRemove: {
      minWidth: 18,
      minHeight: 18,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.cardBackground,
    },
    rangeChipRemoveText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
      includeFontPadding: false,
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
