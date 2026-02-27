/**
 * Mobile filter UI component: Time Filter Modal.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { TIME_FILTER_PRESETS, getPresetForRange } from "@/components/filters/time-filter-presets";

type TimeFilterModalProps = {
  visible: boolean;
  onClose: () => void;
  selectedTimeRanges: string[];
  onChange: (timeRanges: string[]) => void;
};

const RANGE_BASE_MINUTES = 7 * 60;
const RANGE_STEP_MINUTES = 15;
const RANGE_END_MINUTES = 24 * 60 + 2 * 60;
const RANGE_SLOT_COUNT = (RANGE_END_MINUTES - RANGE_BASE_MINUTES) / RANGE_STEP_MINUTES;
const RANGE_MAX_SLOT = RANGE_SLOT_COUNT;
const DEFAULT_END_SLOT = (24 * 60 - RANGE_BASE_MINUTES) / RANGE_STEP_MINUTES;
const DEFAULT_END_OFFSET_SLOTS = (4 * 60) / RANGE_STEP_MINUTES;
const DEFAULT_END_FALLBACK_SLOT = ((24 * 60 + 1 * 60 + 45) - RANGE_BASE_MINUTES) / RANGE_STEP_MINUTES;
const EMPTY_SLIDER_START_CUTOFF_SLOT = (21 * 60 - RANGE_BASE_MINUTES) / RANGE_STEP_MINUTES;
const BOUNDARY_SNAP_DISTANCE_SLOTS = 16;

const selectionsMatch = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  return left.every((value) => right.includes(value));
};

const clampSlot = (value: number) => Math.max(0, Math.min(value, RANGE_MAX_SLOT));

function slotToRangeTime(slot: number): string {
  const boundedSlot = clampSlot(slot);
  const minutesSinceMidnight =
    (RANGE_BASE_MINUTES + boundedSlot * RANGE_STEP_MINUTES) % (24 * 60);
  const hour = Math.floor(minutesSinceMidnight / 60);
  const minute = minutesSinceMidnight % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function slotToDisplayTime(slot: number): string {
  return slotToRangeTime(slot);
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
  const [startSlot, setStartSlot] = useState<number | null>(null);
  const [endSlot, setEndSlot] = useState<number | null>(null);
  const [activeBoundary, setActiveBoundary] = useState<"start" | "end" | null>(null);
  const [sliderWidth, setSliderWidth] = useState(0);
  const [inputError, setInputError] = useState<string | null>(null);
  const endIsOpenByPosition = endSlot === RANGE_MAX_SLOT;

  useEffect(() => {
    if (!visible) return;
    setLocalSelectedTimeRanges(selectedTimeRanges);
    setStartSlot(null);
    setEndSlot(null);
    setActiveBoundary(null);
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

  const slotFromLocation = useCallback(
    (locationX: number) => {
      if (sliderWidth <= 0) return 0;
      const ratio = Math.max(0, Math.min(locationX / sliderWidth, 1));
      return clampSlot(Math.round(ratio * RANGE_SLOT_COUNT));
    },
    [sliderWidth]
  );

  const setBoundarySlot = useCallback(
    (boundary: "start" | "end", nextSlot: number) => {
      if (boundary === "start") {
        const clampedStart =
          endSlot !== null && endSlot !== RANGE_MAX_SLOT
            ? Math.min(nextSlot, endSlot)
            : nextSlot;
        setStartSlot(clampedStart);
        return;
      }
      const clampedEnd = startSlot !== null ? Math.max(nextSlot, startSlot) : nextSlot;
      setEndSlot(clampedEnd);
    },
    [endSlot, startSlot]
  );

  const pickBoundary = useCallback(
    (nextSlot: number): "start" | "end" => {
      const hasStartHandle = startSlot !== null;
      const hasEndHandle = endSlot !== null;

      if (hasStartHandle && !hasEndHandle) {
        const start = startSlot ?? 0;
        return nextSlot - start >= BOUNDARY_SNAP_DISTANCE_SLOTS ? "end" : "start";
      }
      if (!hasStartHandle && hasEndHandle) {
        const end = endSlot ?? 0;
        return end - nextSlot >= BOUNDARY_SNAP_DISTANCE_SLOTS ? "start" : "end";
      }
      if (!hasStartHandle && !hasEndHandle) {
        return nextSlot < EMPTY_SLIDER_START_CUTOFF_SLOT ? "start" : "end";
      }

      if (startSlot === endSlot) {
        if (nextSlot > (endSlot ?? 0)) return "end";
        if (nextSlot < (startSlot ?? 0)) return "start";
        return "end";
      }

      const start = startSlot ?? 0;
      const end = endSlot ?? 0;
      return Math.abs(nextSlot - start) <= Math.abs(nextSlot - end)
        ? "start"
        : "end";
    },
    [endSlot, startSlot]
  );

  const handleSliderStart = useCallback(
    (locationX: number) => {
      const nextSlot = slotFromLocation(locationX);
      const boundary = pickBoundary(nextSlot);
      setActiveBoundary(boundary);
      setBoundarySlot(boundary, nextSlot);
      if (inputError) setInputError(null);
    },
    [inputError, pickBoundary, setBoundarySlot, slotFromLocation]
  );

  const handleSliderMove = useCallback(
    (locationX: number) => {
      if (!activeBoundary) return;
      const nextSlot = slotFromLocation(locationX);
      setBoundarySlot(activeBoundary, nextSlot);
    },
    [activeBoundary, setBoundarySlot, slotFromLocation]
  );

  const handleSliderEnd = useCallback(() => {
    setActiveBoundary(null);
  }, []);

  const handleToggleStartBoundary = useCallback(() => {
    setStartSlot((current) => {
      if (current !== null) return null;
      if (endSlot !== null) return clampSlot(endSlot - 8);
      return 12;
    });
    if (inputError) setInputError(null);
  }, [endSlot, inputError]);

  const handleToggleEndBoundary = useCallback(() => {
    setEndSlot((current) => {
      if (current !== null) return null;
      if (startSlot !== null) {
        const preferredSlot = startSlot + DEFAULT_END_OFFSET_SLOTS;
        if (preferredSlot <= RANGE_MAX_SLOT) return preferredSlot;
        const fallbackSlot = clampSlot(DEFAULT_END_FALLBACK_SLOT);
        if (fallbackSlot > startSlot) return fallbackSlot;
        return RANGE_MAX_SLOT;
      }
      return clampSlot(DEFAULT_END_SLOT);
    });
    if (inputError) setInputError(null);
  }, [inputError, startSlot]);

  const selectedSegments = useMemo(() => {
    const startIsOpen = startSlot === null;
    const endIsOpen = endSlot === null || endSlot === RANGE_MAX_SLOT;

    if (startIsOpen && endIsOpen) return [];

    if (!startIsOpen && endIsOpen) {
      return [
        {
          left: (startSlot / RANGE_SLOT_COUNT) * 100,
          width: ((RANGE_SLOT_COUNT - startSlot) / RANGE_SLOT_COUNT) * 100,
        },
      ];
    }

    if (startIsOpen && endSlot !== null) {
      return [
        {
          left: 0,
          width: (endSlot / RANGE_SLOT_COUNT) * 100,
        },
      ];
    }

    if (startSlot === null || endSlot === null || startSlot >= endSlot) return [];

    return [
      {
        left: (startSlot / RANGE_SLOT_COUNT) * 100,
        width: ((endSlot - startSlot) / RANGE_SLOT_COUNT) * 100,
      },
    ];
  }, [endSlot, startSlot]);

  const handleAddCustomRange = useCallback(() => {
    const effectiveEndSlot = endSlot === RANGE_MAX_SLOT ? null : endSlot;

    if (startSlot === null && effectiveEndSlot === null) {
      setInputError("Set at least a start or end time.");
      return;
    }

    const start = startSlot !== null ? slotToRangeTime(startSlot) : "";
    const end = effectiveEndSlot !== null ? slotToRangeTime(effectiveEndSlot) : "";

    if (startSlot !== null && effectiveEndSlot !== null && effectiveEndSlot < startSlot) {
      setInputError("End must be after start.");
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
    setStartSlot(null);
    setEndSlot(null);
    setActiveBoundary(null);
    setInputError(null);
  }, [endSlot, startSlot]);

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
            <View style={styles.customInputColumn}>
              <View style={styles.boundaryRow}>
                <TouchableOpacity
                  style={[styles.boundaryPill, startSlot !== null && styles.boundaryPillActive]}
                  onPress={handleToggleStartBoundary}
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.boundaryPillLabel}>Start</ThemedText>
                  <ThemedText
                    style={[
                      styles.boundaryPillValue,
                      startSlot === null && styles.boundaryPillValueMuted,
                    ]}
                  >
                    {startSlot === null ? "Open" : slotToDisplayTime(startSlot)}
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.boundaryPill,
                    endSlot !== null && !endIsOpenByPosition && styles.boundaryPillActive,
                  ]}
                  onPress={handleToggleEndBoundary}
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.boundaryPillLabel}>End</ThemedText>
                  <ThemedText
                    style={[
                      styles.boundaryPillValue,
                      (endSlot === null || endIsOpenByPosition) && styles.boundaryPillValueMuted,
                    ]}
                  >
                    {endSlot === null || endIsOpenByPosition ? "Open" : slotToDisplayTime(endSlot)}
                  </ThemedText>
                </TouchableOpacity>
              </View>

              <View
                style={styles.sliderHitArea}
                onLayout={({ nativeEvent }) => {
                  setSliderWidth(nativeEvent.layout.width);
                }}
                onStartShouldSetResponder={() => true}
                onMoveShouldSetResponder={() => true}
                onResponderGrant={(event) => {
                  handleSliderStart(event.nativeEvent.locationX);
                }}
                onResponderMove={(event) => {
                  handleSliderMove(event.nativeEvent.locationX);
                }}
                onResponderRelease={handleSliderEnd}
                onResponderTerminate={handleSliderEnd}
              >
                <View style={styles.sliderTrack} pointerEvents="none" />
                {selectedSegments.map((segment, index) => (
                  <View
                    key={`segment-${index}`}
                    style={[
                      styles.sliderSelectionSegment,
                      { left: `${segment.left}%`, width: `${segment.width}%` },
                    ]}
                    pointerEvents="none"
                  />
                ))}
                {startSlot !== null ? (
                  <View
                    style={[
                      styles.sliderHandle,
                      styles.sliderHandleStart,
                      { left: `${(startSlot / RANGE_SLOT_COUNT) * 100}%` },
                      activeBoundary === "start" && styles.sliderHandleActive,
                    ]}
                    pointerEvents="none"
                  />
                ) : null}
                {endSlot !== null && !endIsOpenByPosition ? (
                  <View
                    style={[
                      styles.sliderHandle,
                      styles.sliderHandleEnd,
                      { left: `${(endSlot / RANGE_SLOT_COUNT) * 100}%` },
                      activeBoundary === "end" && styles.sliderHandleActive,
                    ]}
                    pointerEvents="none"
                  />
                ) : null}
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
      paddingTop: Platform.OS === "ios" ? 20 : 12,
      paddingBottom: 12,
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
    customInputColumn: {
      gap: 12,
    },
    boundaryRow: {
      flexDirection: "row",
      gap: 8,
    },
    boundaryPill: {
      flex: 1,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.background,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 2,
    },
    boundaryPillActive: {
      borderColor: colors.tint,
      backgroundColor: colors.searchBackground,
    },
    boundaryPillLabel: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    boundaryPillValue: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    boundaryPillValueMuted: {
      color: colors.textSecondary,
    },
    sliderHitArea: {
      height: 44,
      justifyContent: "center",
      position: "relative",
    },
    sliderTrack: {
      height: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.searchBackground,
    },
    sliderSelectionSegment: {
      position: "absolute",
      top: 18,
      height: 8,
      borderRadius: 999,
      backgroundColor: colors.tint,
      opacity: 0.28,
    },
    sliderHandle: {
      position: "absolute",
      top: 12,
      width: 20,
      height: 20,
      borderRadius: 10,
      marginLeft: -10,
      borderWidth: 2,
      shadowColor: colors.tint,
      shadowOpacity: 0.18,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
    },
    sliderHandleStart: {
      backgroundColor: colors.tint,
      borderColor: colors.background,
    },
    sliderHandleEnd: {
      backgroundColor: colors.background,
      borderColor: colors.tint,
    },
    sliderHandleActive: {
      transform: [{ scale: 1.1 }],
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
