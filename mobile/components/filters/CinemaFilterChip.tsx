import { useMemo, useRef, useState } from "react";
import { Animated, Dimensions, Easing, LayoutChangeEvent, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
// Aliased: this file already animates its caret with RN's own `Animated`.
import Reanimated, { FadeIn } from "react-native-reanimated";
import { useQuery } from "@tanstack/react-query";
import { MeService, type CinemaPresetPublic } from "shared";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useCinemaSelection } from "@/hooks/useCinemaSelection";
import { useIsSignedIn } from "@/utils/auth-session";
import { useFiltersModal } from "@/components/filters/FiltersModalProvider";
import type { OpenCinemaModalOptions } from "@/components/filters/CinemaFilterModal";
import MorphingChipLabel from "@/components/filters/MorphingChipLabel";
import {
  CHIP_LAYOUT_TRANSITION,
  useImmediateFlashTint,
} from "@/components/filters/filter-change-animation";
import { triggerSelectionHaptic } from "@/utils/long-press";
import { useAnimatedValue } from "@/hooks/useAnimatedValue";

type CinemaFilterChipProps = {
  /** Opens the full Filters modal. */
  onOpenFilters: () => void;
  /**
   * Opens the cinema selection modal. Defaults to the FiltersModalProvider's
   * cinema modal (used on the tab screens). Pages rendered outside that provider
   * (movie / friend agenda) pass their own local cinema modal opener.
   */
  onOpenCinemaModal?: (options?: OpenCinemaModalOptions) => void;
  /**
   * Searching by cinema name makes a cinema selection redundant — the query
   * already narrows to matching cinemas — so the chip reads "All cinemas" and
   * stops opening anything while it's true. The underlying selection is left
   * untouched, only overridden at the query layer (see the tab screens), so
   * it's exactly what it was before the moment this goes false again.
   */
  disabled?: boolean;
  /**
   * Bumped by the row every time a preset apply writes the cinemas — whether
   * or not they moved. The pill flashes the same colour as the chips do, but
   * on its own clock, starting at once: it is already on screen, so it has no
   * arrival to wait for. See `useImmediateFlashTint`.
   */
  flashNonce?: number;
};

const DROPDOWN_WIDTH = 252;

/**
 * The dropdown fades itself in, and the `Modal` is told not to
 * (`animationType="none"`): the platform's own fade holds the modal's touch
 * handling for the whole of it, so a tap on a preset that came while the
 * dropdown was still appearing landed on nothing at all.
 *
 * Short, because it only has to stop the dropdown arriving out of nowhere —
 * and it gates nothing: opacity is a style, and the rows underneath it are
 * hittable from the first frame.
 */
const DROPDOWN_FADE_MS = 160;

/**
 * The caret belongs to the dropdown, not to the pill: it says whether the list
 * is up, and the pill's own 240ms resize is already carried by the layout
 * transition that slides the caret along with the border it sits inside. Given
 * the pill's clock instead, closing by picking a preset took over twice as
 * long as opening had, which reads as the caret lagging rather than as one
 * movement.
 */
const CARET_SPIN_MS = DROPDOWN_FADE_MS;

export default function CinemaFilterChip({
  onOpenFilters,
  onOpenCinemaModal,
  disabled = false,
  flashNonce = 0,
}: CinemaFilterChipProps) {
  const colors = useThemeColors();
  const { openCinemaModal } = useFiltersModal();
  const styles = createStyles(colors);

  // One transition for the pill and everything inside it that has to travel
  // with its edges, and no delay on it: the pill resizes in beat one, the beat
  // that gives things up (see `filter-change-animation`), so it moves the
  // moment the row does.
  const chipLayout = CHIP_LAYOUT_TRANSITION;
  const flashStyle = useImmediateFlashTint(flashNonce);

  const chipRef = useRef<View>(null);
  // Height captured from onLayout — always reliable, used as fallback when measure() returns 0.
  const chipHeightRef = useRef<number>(0);
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);

  // Caret rotation: 0 = closed (0°), 1 = open (180°)
  const caretRotation = useAnimatedValue(0);
  const caretSpin = caretRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  /**
   * Started by whatever the caret is travelling with, at that thing's own
   * clock — never from an effect on `dropdownVisible`. The commit that flips
   * that flag is the one that mounts the dropdown and everything in it, and an
   * effect runs after it: the caret sat still through all of that work and
   * only began to turn once the list was already on screen.
   */
  const spinCaret = (open: boolean) => {
    caretRotation.stopAnimation();
    Animated.timing(caretRotation, {
      toValue: open ? 1 : 0,
      duration: CARET_SPIN_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  const { data: allCinemas = [] } = useFetchCinemas();
  // See FiltersModal: the cinema list is public, the saved picks and named
  // presets are not, and a guest's selection persists to the device instead.
  const isSignedIn = useIsSignedIn();
  const { data: preferredCinemaIds } = useFetchSelectedCinemas({ enabled: isSignedIn });
  const { cinemaIds: sessionCinemaIds, setCinemaIds: setSessionCinemaIds } =
    useCinemaSelection();
  const { data: rawCinemaPresets = [] } = useQuery({
    queryKey: ["cinema-presets"],
    queryFn: () => MeService.getCinemaPresets(),
    enabled: isSignedIn,
  });
  // The preferred selection is what most taps are for, so it always leads;
  // "All cinemas" answers nothing a saved preset couldn't, so it always
  // trails. A stable sort keeps every other preset in the order the backend
  // already sent them in (see `list_user_presets`), rather than re-deriving
  // one here.
  const cinemaPresets = useMemo(
    () =>
      [...rawCinemaPresets].sort((a, b) => {
        const rank = (preset: CinemaPresetPublic) =>
          preset.is_favorite ? 0 : preset.is_default ? 2 : 1;
        return rank(a) - rank(b);
      }),
    [rawCinemaPresets]
  );

  const effectiveIds = sessionCinemaIds ?? preferredCinemaIds ?? [];
  const sortedEffectiveIds = Array.from(new Set(effectiveIds)).sort((a, b) => a - b);
  const sig = JSON.stringify(sortedEffectiveIds);

  // An empty selection is every cinema, not none — the feed is unfiltered
  // either way, and "0 cinemas" over a full list was simply wrong. See
  // useCinemaSelection, which stops an empty selection being written at all;
  // this covers the moment before the cinema list has loaded to resolve it.
  const isAllCinemas =
    sortedEffectiveIds.length === 0 ||
    (allCinemas.length > 0 && sortedEffectiveIds.length === allCinemas.length);
  const matchingPreset = isAllCinemas
    ? null
    : cinemaPresets.find(
        (p) =>
          JSON.stringify(Array.from(new Set(p.cinema_ids)).sort((a, b) => a - b)) === sig
      );

  const label = disabled
    ? "All cinemas"
    : isAllCinemas
      ? "All cinemas"
      : matchingPreset?.name ?? `${sortedEffectiveIds.length} cinemas`;

  // Only ever read inside the dropdown, which a guest never opens.
  const hintText = "Select cinemas";

  // Capture height from the layout event — this is always accurate.
  const handleChipLayout = (e: LayoutChangeEvent) => {
    chipHeightRef.current = e.nativeEvent.layout.height;
  };

  const openDropdown = () => {
    // First, ahead of the measure round-trip and the dropdown's own render:
    // the caret turns with the list arriving, on the list's clock.
    spinCaret(true);
    triggerSelectionHaptic();
    // measure() gives pageX/pageY (absolute screen coords) + dimensions.
    // More reliable than measureInWindow inside a ScrollView on Android.
    chipRef.current?.measure(
      (_x: number, _y: number, _width: number, height: number, pageX: number, pageY: number) => {
        const { width: screenWidth } = Dimensions.get("window");
        const chipH = height > 0 ? height : chipHeightRef.current;
        const left = Math.min(Math.max(pageX, 16), screenWidth - DROPDOWN_WIDTH - 16);
        setDropdownPos({ top: pageY + chipH + 6, left });
        setDropdownVisible(true);
      }
    );
  };

  const closeDropdown = () => {
    spinCaret(false);
    setDropdownVisible(false);
  };

  const applyPreset = (ids: readonly number[]) => {
    triggerSelectionHaptic();
    setSessionCinemaIds(Array.from(ids));
    closeDropdown();
  };

  const handleOpenFilters = (options?: OpenCinemaModalOptions) => {
    triggerSelectionHaptic();
    closeDropdown();
    (onOpenCinemaModal ?? openCinemaModal)(options);
  };

  // The pencil hands the whole preset — name and cinemas — to the picker's
  // edit page. It sits inside the row but is its own touchable, so tapping it
  // edits rather than applies.
  const handleEditPreset = (presetId: string) => {
    handleOpenFilters({ editPresetId: presetId });
  };

  // The dropdown exists to offer saved cinema presets, which belong to an
  // account. Without one it has nothing to list, so the pill skips it entirely
  // and goes straight to the picker rather than opening a menu whose only row
  // is the link to that picker.
  const handleChipPress = () => {
    if (disabled) return;
    if (!isSignedIn) {
      handleOpenFilters();
      return;
    }
    openDropdown();
  };

  return (
    <>
      {/* The measured view stays unanimated: it anchors the dropdown, and a
          scaled frame would anchor it a few points off. */}
      <View ref={chipRef} collapsable={false} onLayout={handleChipLayout}>
        <TouchableOpacity
          onPress={handleChipPress}
          activeOpacity={disabled ? 1 : 0.75}
          disabled={disabled}
        >
          {/* Its label is a count one moment and a preset's name the next, so
              its width changes constantly: the layout transition tweens that
              width, and the chips after it slide by exactly as much over
              exactly as long, which is what keeps them off each other. */}
          <Reanimated.View
            style={[styles.chip, disabled && styles.chipDisabled, flashStyle]}
            layout={chipLayout}
          >
            <MorphingChipLabel
              label={label}
              style={[styles.chipLabel, disabled && styles.chipLabelDisabled]}
            />
            {disabled ? null : (
              /*
               * On the same transition as the pill around it. The label's new
               * width lands in one commit while the pill's edges take 240ms to
               * follow, so a caret laid out against that new width — and left
               * to snap straight to it — jumps ahead of the border it is meant
               * to sit inside.
               */
              <Reanimated.View layout={chipLayout}>
                {isSignedIn ? (
                  <Animated.View style={{ transform: [{ rotate: caretSpin }] }}>
                    <MaterialIcons name="expand-more" size={13} color={colors.pillText} />
                  </Animated.View>
                ) : (
                  // Nothing expands, so the caret would be a lie; the pill
                  // reads as the button to the picker that it is.
                  <MaterialIcons name="tune" size={13} color={colors.pillText} />
                )}
              </Reanimated.View>
            )}
          </Reanimated.View>
        </TouchableOpacity>
      </View>

      {dropdownVisible && dropdownPos && (
        <Modal
          transparent
          visible
          statusBarTranslucent
          animationType="none"
          onRequestClose={closeDropdown}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={closeDropdown}
          />
          <Reanimated.View
            style={[styles.dropdown, { top: dropdownPos.top, left: dropdownPos.left }]}
            entering={FadeIn.duration(DROPDOWN_FADE_MS)}
          >
            {cinemaPresets.length === 0 ? (
              <View style={styles.emptyRow}>
                <ThemedText style={styles.emptyText}>No cinema presets yet</ThemedText>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 240 }}
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                {cinemaPresets.map((preset) => {
                  const presetSig = JSON.stringify(
                    Array.from(new Set(preset.cinema_ids)).sort((a, b) => a - b)
                  );
                  const isActive = presetSig === sig;
                  return (
                    <TouchableOpacity
                      key={preset.id}
                      style={[styles.presetRow, isActive && styles.presetRowActive]}
                      onPress={() => applyPreset(preset.cinema_ids)}
                      activeOpacity={0.8}
                    >
                      {/* Name and star share one flexed block so the star sits
                          right after the (possibly truncated) name instead of
                          drifting to the row's far edge next to the pencil.
                          It qualifies the name, so it reads as part of it
                          rather than as a marker in a gutter — no tick needed
                          for "applied", since the row's own highlight says that. */}
                      <View style={styles.presetNameRow}>
                        <ThemedText
                          style={[styles.presetLabel, isActive && styles.presetLabelActive]}
                          numberOfLines={1}
                        >
                          {preset.name}
                        </ThemedText>
                        {preset.is_favorite && (
                          <MaterialIcons
                            name="star"
                            size={13}
                            color={isActive ? colors.pillActiveText : colors.yellow.secondary}
                          />
                        )}
                      </View>
                      {/* "All cinemas" is the built-in fallback, not a saved
                          row — there is no name or cinema list of its own to
                          edit, so it gets no pencil. */}
                      {!preset.is_default && (
                        <TouchableOpacity
                          onPress={() => handleEditPreset(preset.id)}
                          activeOpacity={0.7}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`Edit ${preset.name}`}
                        >
                          <MaterialIcons
                            name="edit"
                            size={15}
                            color={isActive ? colors.pillActiveText : colors.textSecondary}
                          />
                        </TouchableOpacity>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            <TouchableOpacity
              style={styles.hintRow}
              onPress={() => handleOpenFilters()}
              activeOpacity={0.7}
            >
              <ThemedText style={styles.hintText} numberOfLines={2}>
                {hintText}
              </ThemedText>
              <MaterialIcons name="chevron-right" size={14} color={colors.tint} />
            </TouchableOpacity>
          </Reanimated.View>
        </Modal>
      )}
    </>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    chip: {
      flexDirection: "row",
      alignItems: "center",
      // Matched to `ActiveFilterChip`, which is tighter than it used to be so
      // that more of the row fits on screen at once.
      gap: 3,
      paddingHorizontal: 8,
      paddingVertical: 5,
      borderRadius: 14,
      backgroundColor: colors.pillBackground,
      borderWidth: 1,
      borderColor: colors.pillBorder,
      alignSelf: "center",
      // Clipped while its width tweens: the label swaps in one frame but the
      // box takes a moment to catch up, and unclipped text spills past the
      // border on the way.
      overflow: "hidden",
    },
    chipDisabled: {
      opacity: 0.5,
    },
    chipLabel: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.pillText,
      flexShrink: 1,
    },
    chipLabelDisabled: {
      color: colors.textSecondary,
    },
    dropdown: {
      position: "absolute",
      width: DROPDOWN_WIDTH,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      shadowColor: "#000",
      shadowOpacity: 0.16,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
      elevation: 10,
      overflow: "hidden",
    },
    emptyRow: {
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    emptyText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    presetRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    presetRowActive: {
      backgroundColor: colors.pillActiveBackground,
    },
    presetNameRow: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
    },
    presetLabel: {
      flexShrink: 1,
      fontSize: 14,
      fontWeight: "500",
      color: colors.pillText,
    },
    presetLabelActive: {
      color: colors.pillActiveText,
    },
    hintRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      gap: 6,
    },
    hintText: {
      flex: 1,
      fontSize: 12,
      color: colors.tint,
      fontWeight: "500",
    },
  });
