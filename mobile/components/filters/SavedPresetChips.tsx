/**
 * Mobile filter UI component: Saved Preset Buttons.
 *
 * These are actions, not selections: tapping one applies its filters to the
 * active-filter row underneath. Two things keep them from reading as the
 * selection pills they sit next to:
 *   - they are squared (`PRESET_BUTTON_RADIUS`) where every stateful pill/chip
 *     in the filter rows is fully rounded, and
 *   - a tap pops the button and then settles back (see `PresetButton`),
 *     because an action that leaves no trace where it was tapped is
 *     indistinguishable from a toggle that failed.
 * A preset with nothing left to do fades back instead, and stops responding to
 * a press. That is not selection state — nothing is toggled on and there is
 * nothing to toggle off — it is the button saying the work is already done,
 * which is why it comes back as soon as a filter changes under it.
 *
 * The button answers its own tap, in the frame it is tapped. The flash on the
 * chips it changed is a separate, later thing, owned by the active-filter row
 * — nothing here has to know about it.
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
  presetChangesCinemas,
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
 * How long a tapped preset goes on showing the result of its own tap before
 * the row starts asking whether it still has anything to do.
 *
 * Not every setter lands in the apply's own commit — status, watchlist,
 * hide-watched and group-by-movie all defer their write by a frame on purpose
 * (see `useSharedTabFilters`), and on a slow device the rest can spread over a
 * few more. Asked during that, the honest answer is "some of it", which would
 * flicker the button back on and off again.
 *
 * Generous rather than measured, and deliberately not extended by anything
 * that happens during it: what it buys is a moment of quiet, and everything
 * after it is answered live.
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
  /**
   * The preset whose apply is still landing, if any.
   *
   * A hold, and nothing more: while it is set, that one button stays showing
   * the result of its own tap rather than being asked whether it has anything
   * left to do. Not every setter lands in the apply's own commit, so for a
   * moment afterwards the honest answer is "some of it".
   *
   * It used to also record the filters the apply left behind, and go on
   * claiming the preset was satisfied for as long as they were unchanged. That
   * cannot be made safe: the snapshot is taken after the apply has settled, so
   * anything the user did in between — clearing the filters, say — was
   * recorded as the preset's own result, and the button stayed disabled until
   * something else moved. Once the hold is up, `presetChangesNothing` answers
   * for the button, which is a live question and cannot get stuck.
   */
  const [settlingPresetId, setSettlingPresetId] = useState<string | null>(null);
  const presetApply = usePresetApply();
  const seenApplyCountRef = useRef(presetApply.count);

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

  // Read from the settle timer below, which runs long after the render that
  // made them — so an effect is soon enough, and is the only place a ref may
  // be written. Assigning them in the render body instead made the React
  // Compiler skip this component outright, which for a row of animated
  // buttons is the one thing it cannot afford; and they are declared above
  // their reader for the same reason, since a ref written after the closure
  // that captures it is the same complaint by another route.
  const applyContextRef = useRef(applyContext);
  const presetsRef = useRef(presets);
  useEffect(() => {
    applyContextRef.current = applyContext;
    presetsRef.current = presets;
  }, [applyContext, presets]);

  useEffect(() => {
    if (presetApply.count === seenApplyCountRef.current) return;
    seenApplyCountRef.current = presetApply.count;
    const { presetId } = presetApply;
    if (!presetId) return;
    queueMicrotask(() => setSettlingPresetId(presetId));
    // From the tap, and not restarted by anything: the hold only has to
    // outlast the apply's own writes, and a hold that a later edit could
    // extend is a button that a later edit could freeze.
    const timer = setTimeout(() => {
      setSettlingPresetId((current) => (current === presetId ? null : current));
      if (__DEV__) {
        // A preset that was just applied must, by definition, have nothing
        // left to do. If the prediction disagrees, it is the prediction that
        // is wrong, and this says which fields it got wrong.
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

  // The button paints its own confirmation; the row forwards the apply and
  // announces it, so the active-filter chips can show what it changed. Both
  // land in one commit, which is what lets them diff against what was there.
  const handleApply = (preset: DisplayPreset) => {
    // What the preset writes, not what changes: the chips work out the rest.
    // The cinemas are the exception, and have to be answered here — see the
    // signal's `cinemasChanged`.
    announcePresetApplied(
      controlledPresetDimensions(preset),
      preset.id,
      presetChangesCinemas(preset, applyContext)
    );
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
      settlingPresetId={settlingPresetId}
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
  settlingPresetId,
  onApply,
  onLongPress,
  styles,
  colors,
}: {
  presets: DisplayPreset[];
  isLoading: boolean;
  applyContext: PresetApplyContext;
  settlingPresetId: string | null;
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
            // filters by hand until one of them matched. The second is the
            // apply still landing: for that moment the button shows the result
            // of its own tap rather than being asked a question the filters
            // cannot answer yet.
            isSatisfied={
              presetChangesNothing(preset, applyContext) ||
              settlingPresetId === preset.id
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
