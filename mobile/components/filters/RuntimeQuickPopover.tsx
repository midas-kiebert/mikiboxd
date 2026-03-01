import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { type FilterPillLongPressPosition } from "@/components/filters/FilterPills";
import {
  RUNTIME_MAX_MINUTES,
  RUNTIME_MIN_MINUTES,
  RUNTIME_STEP_MINUTES,
  normalizeSingleRuntimeRangeSelection,
} from "@/components/filters/runtime-range-utils";
import { useThemeColors } from "@/hooks/use-theme-color";

type RuntimeQuickPopoverProps = {
  visible: boolean;
  anchor: FilterPillLongPressPosition | null;
  onClose: () => void;
  selectedRuntimeRanges: string[];
  onChange: (runtimeRanges: string[]) => void;
};

type ActiveBoundary = "start" | "end" | null;

const CARD_WIDTH = 312;
const CARD_HORIZONTAL_MARGIN = 12;
const CARD_BOTTOM_MARGIN = 12;
const ARROW_SIZE = 14;
const ARROW_SIDE_GUTTER = 18;
const CARD_ANCHOR_GAP = 0;
const CARD_VERTICAL_PADDING = 8;
const RUNTIME_POPOVER_HEIGHT = 40;
const TRACK_HEIGHT = 6;
const TRACK_TOP = Math.round(RUNTIME_POPOVER_HEIGHT * 0.56);
const HANDLE_SIZE = 18;
const HANDLE_TOP = TRACK_TOP - Math.round((HANDLE_SIZE - TRACK_HEIGHT) / 2);
const LABEL_OFFSET_FROM_TRACK = Platform.OS === "ios" ? 26 : 24;
const LABEL_TOP = TRACK_TOP - LABEL_OFFSET_FROM_TRACK;
const ESTIMATED_CARD_BODY_HEIGHT = RUNTIME_POPOVER_HEIGHT + CARD_VERTICAL_PADDING * 2;

const RANGE_SLOT_COUNT =
  (RUNTIME_MAX_MINUTES - RUNTIME_MIN_MINUTES) / RUNTIME_STEP_MINUTES;
const RANGE_MAX_SLOT = RANGE_SLOT_COUNT;
const MIN_RANGE_SLOTS = 1;

const clampSlot = (value: number) => Math.max(0, Math.min(value, RANGE_MAX_SLOT));

const slotToRuntime = (slot: number): number =>
  RUNTIME_MIN_MINUTES + clampSlot(slot) * RUNTIME_STEP_MINUTES;

const parseRuntimeToSlot = (rawRuntime: string): number | null => {
  const runtime = Number.parseInt(rawRuntime, 10);
  if (!Number.isFinite(runtime)) return null;
  const slot = Math.round((runtime - RUNTIME_MIN_MINUTES) / RUNTIME_STEP_MINUTES);
  return clampSlot(slot);
};

const normalizeSlots = (startSlot: number, endSlot: number) => {
  let nextStart = clampSlot(Math.min(startSlot, endSlot));
  let nextEnd = clampSlot(Math.max(startSlot, endSlot));
  if (nextEnd - nextStart >= MIN_RANGE_SLOTS) {
    return { startSlot: nextStart, endSlot: nextEnd };
  }
  if (nextEnd < RANGE_MAX_SLOT) {
    nextEnd = Math.min(RANGE_MAX_SLOT, nextStart + MIN_RANGE_SLOTS);
  } else {
    nextStart = Math.max(0, nextEnd - MIN_RANGE_SLOTS);
  }
  return { startSlot: nextStart, endSlot: nextEnd };
};

const parseRuntimeRangeToSlots = (range: string | undefined) => {
  if (!range) return { startSlot: 0, endSlot: RANGE_MAX_SLOT };
  const [startRaw = "", endRaw = ""] = range.split("-", 2);
  const parsedStart = startRaw ? parseRuntimeToSlot(startRaw) : 0;
  const parsedEnd = endRaw ? parseRuntimeToSlot(endRaw) : RANGE_MAX_SLOT;
  if (parsedStart === null || parsedEnd === null) {
    return { startSlot: 0, endSlot: RANGE_MAX_SLOT };
  }
  return normalizeSlots(parsedStart, parsedEnd);
};

const buildRuntimeRangesFromSlots = (startSlot: number, endSlot: number): string[] => {
  const startIsOpen = startSlot <= 0;
  const endIsOpen = endSlot >= RANGE_MAX_SLOT;
  if (startIsOpen && endIsOpen) return [];

  const start = startIsOpen ? "" : String(slotToRuntime(startSlot));
  const end = endIsOpen ? "" : String(slotToRuntime(endSlot));
  return [`${start}-${end}`];
};

const selectionsMatch = (left: readonly string[], right: readonly string[]) => {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
};

export default function RuntimeQuickPopover({
  visible,
  anchor,
  onClose,
  selectedRuntimeRanges,
  onChange,
}: RuntimeQuickPopoverProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const modalRootRef = useRef<View | null>(null);
  const [modalRootTop, setModalRootTop] = useState(0);
  const [activeBoundary, setActiveBoundary] = useState<ActiveBoundary>(null);
  const [startSlot, setStartSlot] = useState(0);
  const [endSlot, setEndSlot] = useState(RANGE_MAX_SLOT);
  const startSlotRef = useRef(startSlot);
  const endSlotRef = useRef(endSlot);
  const sliderRailRef = useRef<View | null>(null);
  const sliderRailWidthRef = useRef(0);
  const sliderRailLeftRef = useRef(0);

  const updateModalRootTop = useCallback(() => {
    modalRootRef.current?.measureInWindow((_x, y) => {
      setModalRootTop(y);
    });
  }, []);

  const normalizedSelectedRuntimeRanges = useMemo(
    () => normalizeSingleRuntimeRangeSelection(selectedRuntimeRanges),
    [selectedRuntimeRanges]
  );

  useEffect(() => {
    if (!visible) return;
    const selectedRange = normalizedSelectedRuntimeRanges[0];
    const parsed = parseRuntimeRangeToSlots(selectedRange);
    startSlotRef.current = parsed.startSlot;
    endSlotRef.current = parsed.endSlot;
    setStartSlot(parsed.startSlot);
    setEndSlot(parsed.endSlot);
    setActiveBoundary(null);
  }, [normalizedSelectedRuntimeRanges, visible]);

  useEffect(() => {
    startSlotRef.current = startSlot;
  }, [startSlot]);

  useEffect(() => {
    endSlotRef.current = endSlot;
  }, [endSlot]);

  const estimatedCardHeight = ARROW_SIZE / 2 + ESTIMATED_CARD_BODY_HEIGHT;
  const minTop = 8 + ARROW_SIZE / 2;
  const maxTop = Math.max(minTop, screenHeight - estimatedCardHeight - CARD_BOTTOM_MARGIN);
  const anchorY = (anchor?.pageY ?? 0) - modalRootTop;
  const desiredTop = anchorY + CARD_ANCHOR_GAP + ARROW_SIZE / 2;
  const cardTop = Math.max(minTop, Math.min(desiredTop, maxTop));
  const rawLeft = (anchor?.pageX ?? screenWidth / 2) - CARD_WIDTH / 2;
  const cardLeft = Math.max(
    CARD_HORIZONTAL_MARGIN,
    Math.min(rawLeft, screenWidth - CARD_WIDTH - CARD_HORIZONTAL_MARGIN)
  );
  const arrowCenterX = Math.max(
    ARROW_SIDE_GUTTER,
    Math.min((anchor?.pageX ?? screenWidth / 2) - cardLeft, CARD_WIDTH - ARROW_SIDE_GUTTER)
  );
  const arrowLeft = arrowCenterX - ARROW_SIZE / 2;

  const startIsOpen = startSlot <= 0;
  const endIsOpen = endSlot >= RANGE_MAX_SLOT;
  const startLabel = startIsOpen ? "" : `${slotToRuntime(startSlot)}m`;
  const endLabel = endIsOpen ? "" : `${slotToRuntime(endSlot)}m`;
  const startPercent = (startSlot / RANGE_SLOT_COUNT) * 100;
  const endPercent = (endSlot / RANGE_SLOT_COUNT) * 100;

  const updateSliderRailLayout = useCallback((width: number) => {
    sliderRailWidthRef.current = width;
    sliderRailRef.current?.measureInWindow((x) => {
      sliderRailLeftRef.current = x;
    });
  }, []);

  const updateSliderRailFromTouch = useCallback((pageX: number, locationX: number) => {
    sliderRailLeftRef.current = pageX - locationX;
  }, []);

  const slotFromPageX = useCallback((pageX: number) => {
    const sliderWidth = sliderRailWidthRef.current;
    if (sliderWidth <= 0) return 0;
    const ratio = Math.max(0, Math.min((pageX - sliderRailLeftRef.current) / sliderWidth, 1));
    return clampSlot(Math.round(ratio * RANGE_SLOT_COUNT));
  }, []);

  const pickBoundary = useCallback(
    (nextSlot: number): Exclude<ActiveBoundary, null> => {
      const startDistance = Math.abs(nextSlot - startSlot);
      const endDistance = Math.abs(nextSlot - endSlot);
      return startDistance <= endDistance ? "start" : "end";
    },
    [endSlot, startSlot]
  );

  const setBoundarySlot = useCallback(
    (boundary: Exclude<ActiveBoundary, null>, nextSlot: number) => {
      if (boundary === "start") {
        const nextStart = Math.min(nextSlot, endSlotRef.current - MIN_RANGE_SLOTS);
        const boundedStart = clampSlot(nextStart);
        if (boundedStart === startSlotRef.current) return;
        startSlotRef.current = boundedStart;
        setStartSlot(boundedStart);
        return;
      }
      const nextEnd = Math.max(nextSlot, startSlotRef.current + MIN_RANGE_SLOTS);
      const boundedEnd = clampSlot(nextEnd);
      if (boundedEnd === endSlotRef.current) return;
      endSlotRef.current = boundedEnd;
      setEndSlot(boundedEnd);
    },
    []
  );

  const commitSelection = useCallback(
    (nextStartSlot: number, nextEndSlot: number) => {
      const nextRuntimeRanges = buildRuntimeRangesFromSlots(nextStartSlot, nextEndSlot);
      if (!selectionsMatch(nextRuntimeRanges, normalizedSelectedRuntimeRanges)) {
        onChange(nextRuntimeRanges);
      }
    },
    [normalizedSelectedRuntimeRanges, onChange]
  );

  const handleSliderStart = useCallback(
    (pageX: number, locationX: number) => {
      updateSliderRailFromTouch(pageX, locationX);
      const nextSlot = slotFromPageX(pageX);
      const boundary = pickBoundary(nextSlot);
      setActiveBoundary(boundary);
      setBoundarySlot(boundary, nextSlot);
    },
    [pickBoundary, setBoundarySlot, slotFromPageX, updateSliderRailFromTouch]
  );

  const handleSliderMove = useCallback(
    (pageX: number) => {
      if (!activeBoundary) return;
      const nextSlot = slotFromPageX(pageX);
      setBoundarySlot(activeBoundary, nextSlot);
    },
    [activeBoundary, setBoundarySlot, slotFromPageX]
  );

  const handleSliderEnd = useCallback(() => {
    setActiveBoundary(null);
    commitSelection(startSlotRef.current, endSlotRef.current);
  }, [commitSelection]);

  return (
    <Modal
      transparent
      statusBarTranslucent
      visible={visible}
      animationType="fade"
      onShow={updateModalRootTop}
      onRequestClose={onClose}
    >
      <View ref={modalRootRef} style={styles.modalRoot} onLayout={updateModalRootTop}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, { top: cardTop, left: cardLeft, width: CARD_WIDTH }]}>
          <View
            style={[
              styles.arrow,
              {
                left: arrowLeft,
                width: ARROW_SIZE,
                height: ARROW_SIZE,
              },
            ]}
          />
          <View style={styles.sliderHitArea}>
            <View
              ref={sliderRailRef}
              style={styles.sliderRailArea}
              onLayout={({ nativeEvent }) => {
                updateSliderRailLayout(nativeEvent.layout.width);
              }}
              onStartShouldSetResponder={() => true}
              onMoveShouldSetResponder={() => false}
              onResponderGrant={(event) => {
                handleSliderStart(event.nativeEvent.pageX, event.nativeEvent.locationX);
              }}
              onResponderMove={(event) => {
                handleSliderMove(event.nativeEvent.pageX);
              }}
              onResponderTerminationRequest={() => false}
              onResponderRelease={handleSliderEnd}
              onResponderTerminate={handleSliderEnd}
            >
              <View
                style={[
                  styles.sliderUnselectedSegment,
                  { left: 0, width: `${Math.max(0, startPercent)}%` },
                ]}
                pointerEvents="none"
              />
              <View
                style={[
                  styles.sliderUnselectedSegment,
                  { left: `${endPercent}%`, width: `${Math.max(0, 100 - endPercent)}%` },
                ]}
                pointerEvents="none"
              />
              <View
                style={[
                  styles.sliderSelectionSegment,
                  { left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` },
                ]}
                pointerEvents="none"
              />
              {startLabel ? (
                <View
                  style={[
                    styles.handleLabelWrap,
                    { left: `${startPercent}%` },
                    activeBoundary === "start" && styles.handleLabelWrapActive,
                  ]}
                  pointerEvents="none"
                >
                  <ThemedText
                    style={[
                      styles.handleLabelText,
                      activeBoundary === "start" && styles.handleLabelTextActive,
                    ]}
                  >
                    {startLabel}
                  </ThemedText>
                </View>
              ) : null}
              {endLabel ? (
                <View
                  style={[
                    styles.handleLabelWrap,
                    { left: `${endPercent}%` },
                    activeBoundary === "end" && styles.handleLabelWrapActive,
                  ]}
                  pointerEvents="none"
                >
                  <ThemedText
                    style={[
                      styles.handleLabelText,
                      activeBoundary === "end" && styles.handleLabelTextActive,
                    ]}
                  >
                    {endLabel}
                  </ThemedText>
                </View>
              ) : null}
              <View
                style={[
                  styles.sliderHandle,
                  styles.sliderHandleStart,
                  { left: `${startPercent}%` },
                  activeBoundary === "start" && styles.sliderHandleActive,
                ]}
                pointerEvents="none"
              />
              <View
                style={[
                  styles.sliderHandle,
                  styles.sliderHandleEnd,
                  { left: `${endPercent}%` },
                  activeBoundary === "end" && styles.sliderHandleActive,
                ]}
                pointerEvents="none"
              />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    modalRoot: {
      flex: 1,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "transparent",
    },
    card: {
      position: "absolute",
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      paddingVertical: CARD_VERTICAL_PADDING,
      paddingHorizontal: 12,
      shadowColor: "#000",
      shadowOpacity: 0.22,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
      gap: 4,
    },
    arrow: {
      position: "absolute",
      top: -(ARROW_SIZE / 2),
      backgroundColor: colors.background,
      borderLeftWidth: 1,
      borderTopWidth: 1,
      borderColor: colors.cardBorder,
      transform: [{ rotate: "45deg" }],
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    sliderHitArea: {
      height: RUNTIME_POPOVER_HEIGHT,
      justifyContent: "center",
      paddingHorizontal: 16,
    },
    sliderRailArea: {
      height: "100%",
      position: "relative",
    },
    sliderSelectionSegment: {
      position: "absolute",
      top: TRACK_TOP,
      height: TRACK_HEIGHT,
      borderRadius: 999,
      backgroundColor: colors.tint,
      opacity: 0.38,
    },
    sliderUnselectedSegment: {
      position: "absolute",
      top: TRACK_TOP,
      height: TRACK_HEIGHT,
      borderRadius: 999,
      backgroundColor: colors.searchBackground,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    handleLabelWrap: {
      position: "absolute",
      top: LABEL_TOP,
      transform: [{ translateX: -20 }],
      minWidth: 40,
      alignItems: "center",
    },
    handleLabelWrapActive: {
      transform: [{ translateX: -20 }, { translateY: -1 }],
    },
    handleLabelText: {
      fontSize: 10,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    handleLabelTextActive: {
      color: colors.text,
    },
    sliderHandle: {
      position: "absolute",
      top: HANDLE_TOP,
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
      borderRadius: HANDLE_SIZE / 2,
      marginLeft: -(HANDLE_SIZE / 2),
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
      transform: [{ scale: 1.08 }],
    },
  });
