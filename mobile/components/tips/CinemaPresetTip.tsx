/**
 * Feature tip: the user browses every cinema at once and has never set their
 * cinemas, so every trip to the cinema filter means picking the same places
 * again. Sets them inline, since the point of the tip is that the user has not
 * found the cinema filter on their own.
 *
 * There is no naming step. This writes the selection every screen falls back
 * to, not a named preset — a user who has not yet found the feature is the last
 * person who should be asked to name anything, and a name prompt reads as an
 * error to recover from rather than a choice worth making.
 *
 * The cinemas get their own scroll box so the count, the save button and the
 * dismissal controls stay on screen however long the list is.
 *
 * Eligibility lives in `FeatureTipsHost`; this component renders and saves.
 */
import { useCallback, useMemo, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService } from "shared";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import CinemaPickerList from "@/components/filters/CinemaPickerList";
import { sortCinemaIds } from "@/components/filters/cinema-grouping";
import { invalidateCinemaPresets } from "@/components/filters/cinema-presets";
import FeatureTipModal, { FEATURE_TIP_COMPACT_PADDING } from "@/components/tips/FeatureTipModal";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { retireCinemaPresetTip, useDismissTip } from "@/utils/feature-tips";
import { triggerSelectionHaptic } from "@/utils/long-press";

/**
 * The cinema box takes every pixel the dialog is not already using. `card`
 * caps a tip at 88% of the screen, and the rest of this one (icon, title,
 * count row, save button, dismissal row and padding) is a known fixed height,
 * so the remainder can go to the cinemas rather than to a guessed ratio.
 */
const TIP_MAX_SCREEN_SHARE = 0.88;
const TIP_CHROME_HEIGHT = 250;
const PICKER_MIN_HEIGHT = 200;

export default function CinemaPresetTip() {
  // Read flow: local state and data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const dismissTip = useDismissTip("cinema-presets");
  const { height: windowHeight } = useWindowDimensions();

  const { data: cinemas } = useFetchCinemas();
  const { setSelections: setSessionCinemaIds } = useSessionCinemaSelections();

  const cinemaList = useMemo(() => cinemas ?? [], [cinemas]);

  // Deliberately starts empty rather than from what the user is currently
  // browsing: the tip asks them to pick the cinemas they actually go to, and
  // anything pre-ticked reads as a choice already made — which they then have
  // to undo.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set());
  // Saving normally makes the tip ineligible, but the confirmation is shown
  // anyway so the dialog never disappears the moment the user presses save.
  const [savedCinemaCount, setSavedCinemaCount] = useState<number | null>(null);

  const saveMutation = useMutation({
    mutationFn: (cinemaIds: number[]) =>
      MeService.setCinemaSelections({ requestBody: cinemaIds }),
    onSuccess: (_data, cinemaIds) => {
      setSavedCinemaCount(cinemaIds.length);
      // The user just declared these their cinemas, so apply them straight away
      // rather than making them open the filter and pick them again.
      setSessionCinemaIds(cinemaIds);
      invalidateCinemaPresets(queryClient);
      retireCinemaPresetTip();
    },
    onError: (error) => {
      console.error("Error saving cinemas from tip:", error);
      Alert.alert("Could not save", "Your cinemas were not saved. Please try again.");
    },
  });

  const selectedCount = selectedIds.size;
  const pickerHeight = Math.max(
    PICKER_MIN_HEIGHT,
    Math.round(windowHeight * TIP_MAX_SCREEN_SHARE) - TIP_CHROME_HEIGHT
  );

  const handleToggleCinema = useCallback((cinemaId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(cinemaId)) {
        next.delete(cinemaId);
      } else {
        next.add(cinemaId);
      }
      return next;
    });
  }, []);

  const handleSelectCinemas = useCallback((cinemaIds: readonly number[]) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      cinemaIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const handleClearAll = useCallback(() => {
    triggerSelectionHaptic();
    setSelectedIds(new Set());
  }, []);

  // A selection covering nothing would filter every showtime away, so the save
  // is never reached without a cinema.
  const handleSave = useCallback(() => {
    if (selectedCount === 0) return;
    saveMutation.mutate(sortCinemaIds(selectedIds));
  }, [saveMutation, selectedCount, selectedIds]);

  // Render/output using the state and handlers prepared above.
  if (savedCinemaCount !== null) {
    return (
      <FeatureTipModal
        tipId="cinema-presets"
        icon="check-circle"
        title="Cinemas saved"
        message={`Your showtimes now come from ${savedCinemaCount} cinema${
          savedCinemaCount === 1 ? "" : "s"
        }. Open the cinema filter any time to change them.`}
        actionLabel="Done"
        closeOnAction
        onDismiss={dismissTip}
      />
    );
  }

  return (
    <FeatureTipModal
      tipId="cinema-presets"
      icon="theaters"
      title="Select your favorite cinemas"
      density="compact"
      actionLabel="Set as preferred cinemas"
      onAction={handleSave}
      isActionDisabled={selectedCount === 0}
      onDismiss={dismissTip}
    >
      <View style={styles.pickerHeader}>
        <ThemedText style={styles.count}>
          {selectedCount} of {cinemaList.length} selected
        </ThemedText>
        {selectedCount > 0 ? (
          <TouchableOpacity
            onPress={handleClearAll}
            activeOpacity={0.7}
            hitSlop={8}
            accessibilityRole="button"
          >
            <ThemedText style={styles.clearAll}>Clear all</ThemedText>
          </TouchableOpacity>
        ) : null}
      </View>
      <ScrollView
        style={[styles.pickerBox, { height: pickerHeight }]}
        contentContainerStyle={styles.pickerContent}
        showsVerticalScrollIndicator
        // Scrolls independently of the dialog it sits in, so the button and the
        // "Don't show this again" row below never move off screen.
        nestedScrollEnabled
      >
        <CinemaPickerList
          cinemas={cinemaList}
          selectedIds={selectedIds}
          onToggleCinema={handleToggleCinema}
          onSelectCinemas={handleSelectCinemas}
        />
      </ScrollView>
    </FeatureTipModal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    pickerHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    count: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    clearAll: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.tint,
    },
    // Runs the full width of the card: the cinemas are the whole point of this
    // tip, so they get the space the content padding would otherwise take.
    pickerBox: {
      marginHorizontal: -FEATURE_TIP_COMPACT_PADDING,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: colors.background,
    },
    pickerContent: {
      paddingHorizontal: FEATURE_TIP_COMPACT_PADDING,
      paddingVertical: 12,
    },
  });
