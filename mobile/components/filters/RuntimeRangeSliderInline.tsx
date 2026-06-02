/**
 * Mobile filter UI component: Runtime Range Slider (inline).
 * Same dual-handle slider logic as RuntimeQuickPopover, embedded inline
 * (no Modal wrapper) for use inside FiltersModal.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import {
  RUNTIME_MAX_MINUTES,
  RUNTIME_MIN_MINUTES,
  RUNTIME_STEP_MINUTES,
  formatRuntimePillLabel,
  normalizeSingleRuntimeRangeSelection,
} from "@/components/filters/runtime-range-utils";

// ─── Range constants ──────────────────────────────────────────────────────────
const RANGE_SLOT_COUNT = (RUNTIME_MAX_MINUTES - RUNTIME_MIN_MINUTES) / RUNTIME_STEP_MINUTES;
const RANGE_MAX_SLOT = RANGE_SLOT_COUNT;
const MIN_RANGE_SLOTS = 1;

const SLIDER_HEIGHT = 42;
const TRACK_HEIGHT = 5;
const TRACK_TOP = Math.round(SLIDER_HEIGHT * 0.62);
const HANDLE_SIZE = 18;
const HANDLE_TOP = TRACK_TOP - Math.round((HANDLE_SIZE - TRACK_HEIGHT) / 2);
const LABEL_OFFSET = 26;
const LABEL_TOP = TRACK_TOP - LABEL_OFFSET;

type ActiveBoundary = "start" | "end" | null;

const clampSlot = (v: number) => Math.max(0, Math.min(v, RANGE_MAX_SLOT));

const slotToRuntime = (slot: number) => RUNTIME_MIN_MINUTES + clampSlot(slot) * RUNTIME_STEP_MINUTES;

const parseRuntimeToSlot = (raw: string): number | null => {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return null;
  return clampSlot(Math.round((n - RUNTIME_MIN_MINUTES) / RUNTIME_STEP_MINUTES));
};

const normalizeSlots = (start: number, end: number) => {
  let s = clampSlot(Math.min(start, end));
  let e = clampSlot(Math.max(start, end));
  if (e - s < MIN_RANGE_SLOTS) {
    if (e < RANGE_MAX_SLOT) e = Math.min(RANGE_MAX_SLOT, s + MIN_RANGE_SLOTS);
    else s = Math.max(0, e - MIN_RANGE_SLOTS);
  }
  return { startSlot: s, endSlot: e };
};

const parseRangeToSlots = (range: string | undefined) => {
  if (!range) return { startSlot: 0, endSlot: RANGE_MAX_SLOT };
  const [s = "", e = ""] = range.split("-", 2);
  const ps = s ? parseRuntimeToSlot(s) : 0;
  const pe = e ? parseRuntimeToSlot(e) : RANGE_MAX_SLOT;
  if (ps === null || pe === null) return { startSlot: 0, endSlot: RANGE_MAX_SLOT };
  return normalizeSlots(ps, pe);
};

const buildRanges = (start: number, end: number): string[] => {
  if (start <= 0 && end >= RANGE_MAX_SLOT) return [];
  const s = start <= 0 ? "" : String(slotToRuntime(start));
  const e = end >= RANGE_MAX_SLOT ? "" : String(slotToRuntime(end));
  return [`${s}-${e}`];
};

type Props = {
  selectedRuntimeRanges: string[];
  onChange: (ranges: string[]) => void;
};

export default function RuntimeRangeSliderInline({ selectedRuntimeRanges, onChange }: Props) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const normalized = useMemo(
    () => normalizeSingleRuntimeRangeSelection(selectedRuntimeRanges),
    [selectedRuntimeRanges]
  );

  const [startSlot, setStartSlot] = useState(0);
  const [endSlot, setEndSlot] = useState(RANGE_MAX_SLOT);
  const [activeBoundary, setActiveBoundary] = useState<ActiveBoundary>(null);
  const startSlotRef = useRef(startSlot);
  const endSlotRef = useRef(endSlot);
  const railRef = useRef<View | null>(null);
  const railWidthRef = useRef(0);
  const railLeftRef = useRef(0);

  useEffect(() => {
    const parsed = parseRangeToSlots(normalized[0]);
    startSlotRef.current = parsed.startSlot;
    endSlotRef.current = parsed.endSlot;
    setStartSlot(parsed.startSlot);
    setEndSlot(parsed.endSlot);
    setActiveBoundary(null);
  }, [normalized[0]]);

  useEffect(() => { startSlotRef.current = startSlot; }, [startSlot]);
  useEffect(() => { endSlotRef.current = endSlot; }, [endSlot]);

  const slotFromPageX = useCallback((pageX: number) => {
    const w = railWidthRef.current;
    if (w <= 0) return 0;
    return clampSlot(Math.round(Math.max(0, Math.min((pageX - railLeftRef.current) / w, 1)) * RANGE_SLOT_COUNT));
  }, []);

  const pickBoundary = useCallback((slot: number): Exclude<ActiveBoundary, null> => {
    return Math.abs(slot - startSlot) <= Math.abs(slot - endSlot) ? "start" : "end";
  }, [startSlot, endSlot]);

  const setBoundarySlot = useCallback((boundary: Exclude<ActiveBoundary, null>, slot: number) => {
    if (boundary === "start") {
      const next = clampSlot(Math.min(slot, endSlotRef.current - MIN_RANGE_SLOTS));
      if (next === startSlotRef.current) return;
      startSlotRef.current = next;
      setStartSlot(next);
    } else {
      const next = clampSlot(Math.max(slot, startSlotRef.current + MIN_RANGE_SLOTS));
      if (next === endSlotRef.current) return;
      endSlotRef.current = next;
      setEndSlot(next);
    }
  }, []);

  const startPercent = (startSlot / RANGE_SLOT_COUNT) * 100;
  const endPercent = (endSlot / RANGE_SLOT_COUNT) * 100;
  const startLabel = startSlot <= 0 ? "" : `${slotToRuntime(startSlot)}m`;
  const endLabel = endSlot >= RANGE_MAX_SLOT ? "" : `${slotToRuntime(endSlot)}m`;
  const valueLabel = formatRuntimePillLabel(buildRanges(startSlot, endSlot));

  const activeBoundaryRef = useRef<ActiveBoundary>(null);
  // Pan claims the touch on the first movement (minDistance 0, no axis offsets) so a
  // drag in any direction grabs a boundary and blocks the parent scroll until release.
  // A stationary tap produces no movement, so the pan never activates — the Tap gesture
  // below handles that case and snaps the nearest boundary to the tapped point.
  const pan = useMemo(() => Gesture.Pan()
    .minDistance(0)
    .runOnJS(true)
    .onBegin((e) => {
      railLeftRef.current = e.absoluteX - e.x;
    })
    .onStart((e) => {
      const slot = slotFromPageX(e.absoluteX);
      const b = pickBoundary(slot);
      activeBoundaryRef.current = b;
      setActiveBoundary(b);
      setBoundarySlot(b, slot);
    })
    .onUpdate((e) => {
      const b = activeBoundaryRef.current;
      if (!b) return;
      setBoundarySlot(b, slotFromPageX(e.absoluteX));
    })
    .onEnd(() => {
      onChange(buildRanges(startSlotRef.current, endSlotRef.current));
    })
    .onFinalize(() => {
      activeBoundaryRef.current = null;
      setActiveBoundary(null);
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [pickBoundary, setBoundarySlot, slotFromPageX, onChange]);

  const tap = useMemo(() => Gesture.Tap()
    .runOnJS(true)
    .onEnd((e) => {
      railLeftRef.current = e.absoluteX - e.x;
      const slot = slotFromPageX(e.absoluteX);
      const b = pickBoundary(slot);
      setBoundarySlot(b, slot);
      onChange(buildRanges(startSlotRef.current, endSlotRef.current));
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [pickBoundary, setBoundarySlot, slotFromPageX, onChange]);

  const gesture = useMemo(() => Gesture.Race(pan, tap), [pan, tap]);

  return (
    <View style={styles.row}>
      <View style={styles.hitArea}>
      <GestureDetector gesture={gesture}>
      <View
        ref={railRef}
        style={styles.rail}
        onLayout={({ nativeEvent }) => {
          railWidthRef.current = nativeEvent.layout.width;
          railRef.current?.measureInWindow((x) => { railLeftRef.current = x; });
        }}
      >
        <View style={[styles.segment, styles.unselected, { left: 0, width: `${Math.max(0, startPercent)}%` }]} pointerEvents="none" />
        <View style={[styles.segment, styles.unselected, { left: `${endPercent}%`, width: `${Math.max(0, 100 - endPercent)}%` }]} pointerEvents="none" />
        <View style={[styles.segment, styles.selected, { left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }]} pointerEvents="none" />

        {startLabel ? (
          <View style={[styles.labelWrap, { left: `${startPercent}%` }, activeBoundary === "start" && styles.labelWrapActive]} pointerEvents="none">
            <ThemedText style={[styles.labelText, activeBoundary === "start" && styles.labelTextActive]}>{startLabel}</ThemedText>
          </View>
        ) : null}
        {endLabel ? (
          <View style={[styles.labelWrap, { left: `${endPercent}%` }, activeBoundary === "end" && styles.labelWrapActive]} pointerEvents="none">
            <ThemedText style={[styles.labelText, activeBoundary === "end" && styles.labelTextActive]}>{endLabel}</ThemedText>
          </View>
        ) : null}

        <View style={[styles.handle, styles.handleStart, { left: `${startPercent}%` }, activeBoundary === "start" && styles.handleActive]} pointerEvents="none" />
        <View style={[styles.handle, styles.handleEnd, { left: `${endPercent}%` }, activeBoundary === "end" && styles.handleActive]} pointerEvents="none" />
      </View>
      </GestureDetector>
      </View>
      <ThemedText style={styles.valueLabel} numberOfLines={1}>{valueLabel}</ThemedText>
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    row: { flexDirection: "row", alignItems: "center", marginLeft: 16, marginRight: 10 },
    hitArea: { flex: 2, height: SLIDER_HEIGHT, justifyContent: "center", paddingHorizontal: 4 },
    valueLabel: { flex: 1, paddingLeft: 14, fontSize: 12, color: colors.textSecondary, textAlign: "right", alignSelf: "center", marginTop: TRACK_TOP + Math.round(TRACK_HEIGHT / 2) - Math.round(SLIDER_HEIGHT / 2) },
    rail: { height: "100%", position: "relative" },
    segment: { position: "absolute", top: TRACK_TOP, height: TRACK_HEIGHT, borderRadius: 999 },
    selected: { backgroundColor: colors.tint, opacity: 0.38 },
    unselected: { backgroundColor: colors.searchBackground, borderWidth: 1, borderColor: colors.divider },
    labelWrap: { position: "absolute", top: LABEL_TOP, transform: [{ translateX: -20 }], minWidth: 40, alignItems: "center" },
    labelWrapActive: { transform: [{ translateX: -20 }, { translateY: -1 }] },
    labelText: { fontSize: 10, fontWeight: "700", color: colors.textSecondary },
    labelTextActive: { color: colors.text },
    handle: { position: "absolute", top: HANDLE_TOP, width: HANDLE_SIZE, height: HANDLE_SIZE, borderRadius: HANDLE_SIZE / 2, marginLeft: -(HANDLE_SIZE / 2), borderWidth: 2, shadowColor: colors.tint, shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } },
    handleStart: { backgroundColor: colors.tint, borderColor: colors.background },
    handleEnd: { backgroundColor: colors.background, borderColor: colors.tint },
    handleActive: { transform: [{ scale: 1.08 }] },
  });
