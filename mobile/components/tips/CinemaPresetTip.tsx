/**
 * Feature tip: the user browses every cinema at once and has never saved a
 * preset, so every trip to the cinema filter means picking the same places
 * again. Builds the preset inline, since the point of the tip is that the user
 * has not found the preset UI on their own.
 *
 * The cinemas get their own scroll box so the count, the save button and the
 * dismissal controls stay on screen however long the list is. Naming happens
 * after the selection, in a second dialog, so the tip opens straight onto the
 * only decision that matters.
 *
 * Eligibility lives in `FeatureTipsHost`; this component renders and saves.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService, type CinemaPresetCreate } from "shared";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import CinemaPickerList from "@/components/filters/CinemaPickerList";
import { sortCinemaIds } from "@/components/filters/cinema-grouping";
import { invalidateCinemaPresets } from "@/components/filters/cinema-presets";
import FeatureTipModal, { FEATURE_TIP_COMPACT_PADDING } from "@/components/tips/FeatureTipModal";
import { ThemedText } from "@/components/themed-text";
import NamePromptDialog from "@/components/ui/NamePromptDialog";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useDismissTip } from "@/utils/feature-tips";
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

type SavedPreset = { name: string; cinemaCount: number };

export default function CinemaPresetTip() {
  // Read flow: local state and data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const dismissTip = useDismissTip("cinema-presets");
  const { height: windowHeight } = useWindowDimensions();

  const { data: cinemas } = useFetchCinemas();
  const { data: favoriteCinemaIds } = useFetchSelectedCinemas();
  const { selections: sessionCinemaIds, setSelections: setSessionCinemaIds } =
    useSessionCinemaSelections();

  const cinemaList = useMemo(() => cinemas ?? [], [cinemas]);
  const currentCinemaIds = sessionCinemaIds ?? favoriteCinemaIds;

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(
    () => new Set(currentCinemaIds ?? [])
  );
  const [isNamingPreset, setIsNamingPreset] = useState(false);
  // Saving normally makes the tip ineligible, but the confirmation is shown
  // anyway so the dialog never disappears the moment the user presses save.
  const [savedPreset, setSavedPreset] = useState<SavedPreset | null>(null);

  // The selection the tip starts from is whatever the user is already browsing,
  // which usually only arrives after the first render. Seeded once, so a later
  // refetch never wipes out edits the user has made in the meantime.
  const hasSeededSelection = useRef(currentCinemaIds !== undefined);
  useEffect(() => {
    if (hasSeededSelection.current || currentCinemaIds === undefined) return;
    hasSeededSelection.current = true;
    setSelectedIds(new Set(currentCinemaIds));
  }, [currentCinemaIds]);

  const saveMutation = useMutation({
    mutationFn: (requestBody: CinemaPresetCreate) =>
      MeService.createCinemaPreset({ requestBody }),
    onSuccess: (_data, requestBody) => {
      setIsNamingPreset(false);
      setSavedPreset({ name: requestBody.name, cinemaCount: requestBody.cinema_ids.length });
      // The user just declared these their cinemas, so apply them straight away
      // rather than making them open the filter and pick the preset again.
      setSessionCinemaIds(sortCinemaIds(requestBody.cinema_ids));
      invalidateCinemaPresets(queryClient);
    },
    onError: (error) => {
      console.error("Error saving cinema preset from tip:", error);
      Alert.alert("Could not save", "Your cinema preset was not saved. Please try again.");
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

  // A preset covering nothing would filter every showtime away, so the name
  // step is never reached without a cinema.
  const handleStartSaving = useCallback(() => {
    if (selectedCount === 0) return;
    setIsNamingPreset(true);
  }, [selectedCount]);

  const handleConfirmName = useCallback(
    (name: string) => {
      if (selectedCount === 0) return;
      saveMutation.mutate({
        name,
        cinema_ids: sortCinemaIds(selectedIds),
        // The first preset is the one the user wants on startup; the cinema
        // filter's Manage presets page is where that gets changed later.
        is_favorite: true,
      });
    },
    [saveMutation, selectedCount, selectedIds]
  );

  const handleCancelName = useCallback(() => {
    setIsNamingPreset(false);
  }, []);

  // Render/output using the state and handlers prepared above.
  if (savedPreset) {
    return (
      <FeatureTipModal
        icon="check-circle"
        title="Preset saved"
        message={`"${savedPreset.name}" now covers ${savedPreset.cinemaCount} cinema${
          savedPreset.cinemaCount === 1 ? "" : "s"
        } and is applied to your showtimes. Open the cinema filter any time to switch presets or add another.`}
        actionLabel="Done"
        closeOnAction
        onDismiss={dismissTip}
      />
    );
  }

  return (
    <FeatureTipModal
      icon="theaters"
      title="Select your favorite cinemas"
      density="compact"
      actionLabel="Save this preset"
      onAction={handleStartSaving}
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

      {/* Nested rather than a sibling: iOS is unreliable about presenting two
          modals from the same level, and this one has to sit over the tip. */}
      <NamePromptDialog
        visible={isNamingPreset}
        title="Give this preset a name:"
        placeholder="My cinemas"
        confirmLabel="Save"
        isBusy={saveMutation.isPending}
        onConfirm={handleConfirmName}
        onCancel={handleCancelName}
      />
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
