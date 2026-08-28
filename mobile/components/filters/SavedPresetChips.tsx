/**
 * Mobile filter UI component: Saved Preset Buttons.
 *
 * These are actions, not selections: tapping one applies its filters to the
 * active-filter row underneath. Two things keep them from reading as the
 * selection pills they sit next to:
 *   - they are squared (`PRESET_BUTTON_RADIUS`) where every stateful pill/chip
 *     in the filter rows is fully rounded, and
 *   - a tap tints and pops the button and then settles back (see
 *     `PresetButton`), because an action that leaves no trace where it was
 *     tapped is indistinguishable from a toggle that failed.
 * The one exception, and it is a deliberate one: a preset with nothing left
 * to do holds the same green its own tap animation flashes, and stops
 * responding to a press. It is not selection state — nothing is toggled on and
 * there is nothing to toggle off — it is the button saying the work is already
 * done, which is why it goes as soon as a filter changes under it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { ScrollView as GHScrollView } from "react-native-gesture-handler";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import useAuth from "shared/hooks/useAuth";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useThemeColors } from "@/hooks/use-theme-color";
import {
  controlledPresetDimensions,
  presetChangesNothing,
  type DisplayPreset,
  type PresetApplyContext,
} from "@/components/filters/saved-presets";
import { useCurrentFilterPresetState } from "@/hooks/useSharedTabFilters";
import { useCinemaSelection } from "@/hooks/useCinemaSelection";
import { useDisplayPresets } from "@/components/filters/useDisplayPresets";
import {
  announcePresetApplied,
  usePresetApply,
} from "@/components/filters/preset-apply-signal";
import { serializeFilters } from "@/components/filters/filter-preset-utils";
import PresetButton from "@/components/filters/PresetButton";
import { Skeleton } from "@/components/ui/Skeleton";
import {
  PRESET_BUTTON_HEIGHT,
  PRESET_BUTTON_POP_HEADROOM,
  PRESET_BUTTON_RADIUS,
  PRESETS_ROW_INSET,
} from "@/components/filters/filter-control-metrics";
import { triggerImpactHaptic, triggerLongPressHaptic } from "@/utils/long-press";
import { useIsSignedIn } from "@/utils/auth-session";
import useTrackEvent from "shared/hooks/useTrackEvent";

/** Placeholder button widths shown while presets load. */
const SKELETON_CHIP_WIDTHS = [78, 96, 64];

/**
 * How long after an apply the row waits before reading the filters back.
 *
 * Not every setter lands in the apply's own commit — the status, watchlist and
 * hide-watched ones defer their write by a frame on purpose (see
 * `useSharedTabFilters`), so the state read straight afterwards is the state
 * before the apply for those three. The button stays lit until this is up
 * regardless, and only then is what it was applied over recorded.
 */
const APPLY_SETTLE_MS = 350;

type SavedPresetChipsProps = {
  onApply: (preset: DisplayPreset) => void;
};

export default function SavedPresetChips({ onApply }: SavedPresetChipsProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Presets are saved to an account, so a guest has none and no way to make
  // one — `PresetsRow` above renders nothing at all for them.
  const isSignedIn = useIsSignedIn();
  const { presets, isLoading, remove } = useDisplayPresets({ enabled: isSignedIn });
  const { trackEvent } = useTrackEvent();

  // What the row is filtered by right now, so each button can say whether it
  // still has anything to do. Read from the shared filter state rather than
  // passed down: every screen that shows these buttons is on that state, and
  // threading a dozen values through the row would only be a copy of it.
  const currentFilters = useCurrentFilterPresetState();
  const { cinemaIds: sessionCinemaIds } = useCinemaSelection();
  const { data: preferredCinemaIds } = useFetchSelectedCinemas({ enabled: isSignedIn });
  const { user } = useAuth();
  /**
   * Everything the buttons compare against, as one string. Cinemas are in it
   * even though most presets do not carry them: what this decides is whether
   * anything has moved since a preset was applied, and a cinema change is a
   * change.
   */
  const filterSignature = useMemo(
    () =>
      `${serializeFilters(currentFilters)}|${Array.from(
        new Set(sessionCinemaIds ?? preferredCinemaIds ?? [])
      )
        .sort((left, right) => left - right)
        .join(",")}`,
    [currentFilters, sessionCinemaIds, preferredCinemaIds]
  );
  const signatureRef = useRef(filterSignature);
  signatureRef.current = filterSignature;

  /**
   * The preset the row is currently showing the result of, and the filters it
   * left behind. `signature: null` means the apply is still settling, and the
   * button stays lit through it.
   *
   * This is the half of "nothing left to do" that does not have to predict
   * anything: whatever a preset did, it did it, and until something moves it
   * would do exactly the same again.
   */
  const [lastApplied, setLastApplied] = useState<{
    id: string;
    signature: string | null;
  } | null>(null);
  const presetApply = usePresetApply();
  const seenApplyCountRef = useRef(presetApply.count);
  useEffect(() => {
    if (presetApply.count === seenApplyCountRef.current) return;
    seenApplyCountRef.current = presetApply.count;
    const { presetId } = presetApply;
    if (!presetId) return;
    setLastApplied({ id: presetId, signature: null });
    const timer = setTimeout(() => {
      setLastApplied({ id: presetId, signature: signatureRef.current });
      if (__DEV__) {
        // A preset that was just applied must, by definition, have nothing
        // left to do. If the prediction disagrees, it is the prediction that
        // is wrong, and this says which fields it got wrong — the button is
        // lit either way, by the branch above.
        const applied = presetsRef.current.find((preset) => preset.id === presetId);
        if (applied && !presetChangesNothing(applied, applyContextRef.current)) {
          console.warn(
            "[presets] just-applied preset still reads as changing something",
            { preset: applied.name, filters: applied.filters, untouched: applied.untouchedFields },
            { current: applyContextRef.current }
          );
        }
      }
    }, APPLY_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [presetApply]);

  const applyContext = useMemo<PresetApplyContext>(
    () => ({
      currentFilters,
      // The pill's own resolution order: the session selection, else the
      // account's, else none.
      currentCinemaIds: sessionCinemaIds ?? preferredCinemaIds ?? [],
      hasLetterboxdUsername: Boolean(user?.letterboxd_username?.trim()),
    }),
    [currentFilters, sessionCinemaIds, preferredCinemaIds, user?.letterboxd_username]
  );

  // Read from the settle timer above, which runs long after the render that
  // made them.
  const applyContextRef = useRef(applyContext);
  applyContextRef.current = applyContext;
  const presetsRef = useRef(presets);
  presetsRef.current = presets;

  // The button paints its own confirmation; the row forwards the apply and
  // announces it, so the active-filter chips can show what it changed. Both
  // land in one commit, which is what lets them diff against what was there.
  const handleApply = (preset: DisplayPreset) => {
    // What the preset writes, not what changes: the chips work out the rest.
    announcePresetApplied(controlledPresetDimensions(preset), preset.id);
    onApply(preset);
    trackEvent("preset_used");
  };

  const confirmDelete = (preset: DisplayPreset) => {
    // The hold is the only thing that says the gesture registered before the
    // dialog appears — the chip itself gives no long-press feedback.
    triggerLongPressHaptic();
    Alert.alert(
      "Delete preset?",
      `Remove "${preset.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            triggerImpactHaptic();
            remove(preset);
          },
        },
      ],
      { cancelable: true }
    );
  };

  if (!isSignedIn) return null;

  return (
    <ChipsScroll
      presets={presets}
      isLoading={isLoading}
      applyContext={applyContext}
      filterSignature={filterSignature}
      lastApplied={lastApplied}
      onApply={handleApply}
      onLongPress={confirmDelete}
      styles={styles}
      colors={colors}
    />
  );
}

function ChipsScroll({
  presets,
  isLoading,
  applyContext,
  filterSignature,
  lastApplied,
  onApply,
  onLongPress,
  styles,
  colors,
}: {
  presets: DisplayPreset[];
  isLoading: boolean;
  applyContext: PresetApplyContext;
  filterSignature: string;
  lastApplied: { id: string; signature: string | null } | null;
  onApply: (preset: DisplayPreset) => void;
  onLongPress: (preset: DisplayPreset) => void;
  styles: ReturnType<typeof createStyles>;
  colors: ReturnType<typeof useThemeColors>;
}) {
  const [hasMoreRight, setHasMoreRight] = useState(false);
  const contentW = useRef(0);
  const containerW = useRef(0);

  return (
    <View style={styles.chipsWrapper}>
      <GHScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsContent}
        style={{ flex: 1 }}
        scrollEventThrottle={16}
        onLayout={(e) => {
          containerW.current = e.nativeEvent.layout.width;
          setHasMoreRight(contentW.current > e.nativeEvent.layout.width + 2);
        }}
        onContentSizeChange={(w) => {
          contentW.current = w;
          setHasMoreRight(w > containerW.current + 2);
        }}
        onScroll={(e) => {
          const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
          setHasMoreRight(contentOffset.x + layoutMeasurement.width < contentSize.width - 2);
        }}
      >
        {isLoading &&
          presets.length === 0 &&
          SKELETON_CHIP_WIDTHS.map((width, i) => (
            <Skeleton key={`skeleton-${i}`} style={[styles.chipSkeleton, { width }]} />
          ))}
        {presets.map((preset) => (
          <PresetButton
            key={preset.id}
            preset={preset}
            // Two ways to have nothing to do, and either will do. The first
            // holds for a preset the user never touched — they narrowed the
            // filters by hand until one of them matched. The second needs no
            // prediction at all: this is the preset the row is showing, and
            // nothing has moved since.
            isSatisfied={
              presetChangesNothing(preset, applyContext) ||
              (lastApplied?.id === preset.id &&
                (lastApplied.signature === null ||
                  lastApplied.signature === filterSignature))
            }
            onApply={onApply}
            onLongPress={onLongPress}
          />
        ))}
      </GHScrollView>
      {hasMoreRight && (
        <View style={styles.scrollFadeRight} pointerEvents="none">
          <MaterialIcons name="chevron-right" size={16} color={colors.textSecondary} />
        </View>
      )}
    </View>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    // A row, so the scroller's `flex: 1` claims *width* inside the caption
    // column. Nothing here may flex vertically: the column has no definite
    // height, so a vertical flex child would size to zero and the buttons
    // would vanish.
    chipsWrapper: {
      alignSelf: "stretch",
      flexDirection: "row",
      position: "relative",
      minHeight: PRESET_BUTTON_HEIGHT + PRESET_BUTTON_POP_HEADROOM * 2,
    },
    chipsContent: {
      gap: 8,
      alignItems: "center",
      // The scroller runs edge to edge and carries the row's inset itself: a
      // button flush against a clipping bound has nowhere to grow, and the
      // first one would be cut off down its left side as it popped.
      paddingLeft: PRESETS_ROW_INSET,
      paddingRight: PRESETS_ROW_INSET,
      paddingVertical: PRESET_BUTTON_POP_HEADROOM,
    },
    scrollFadeRight: {
      position: "absolute",
      right: 0,
      top: 0,
      bottom: 0,
      justifyContent: "center",
      paddingLeft: 4,
      backgroundColor: colors.background,
    },
    chipSkeleton: {
      height: PRESET_BUTTON_HEIGHT,
      borderRadius: PRESET_BUTTON_RADIUS,
      backgroundColor: colors.posterPlaceholder,
    },
  });
