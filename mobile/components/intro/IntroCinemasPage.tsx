/**
 * Intro page 1 — pick your cinemas.
 *
 * Same job as `CinemaPresetTip`, minus the naming step: someone who has been in
 * the app for ten seconds should not be asked to name anything, so the first
 * preset is created under a fixed name and set as the favorite. It can be
 * renamed later from the cinema filter's Manage presets page.
 *
 * Saving also applies the selection to this session and retires the cinema
 * preset tip, so the user is never nudged towards a feature they just used.
 */
import { useCallback, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService, type CinemaPresetCreate } from "shared";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import CinemaPickerList from "@/components/filters/CinemaPickerList";
import { sortCinemaIds } from "@/components/filters/cinema-grouping";
import { invalidateCinemaPresets } from "@/components/filters/cinema-presets";
import IntroPageShell from "@/components/intro/IntroPageShell";
import { ThemedText } from "@/components/themed-text";
import { Skeleton } from "@/components/ui/Skeleton";
import { useThemeColors } from "@/hooks/use-theme-color";
import { retireCinemaPresetTip } from "@/utils/feature-tips";
import { triggerSelectionHaptic } from "@/utils/long-press";

/** The name the first preset gets, since the intro does not stop to ask. */
const DEFAULT_PRESET_NAME = "Favorites";

/** Placeholder rows drawn while the cinema list is still in flight. */
const SKELETON_ROW_COUNT = 8;

export default function IntroCinemasPage({ onDone }: { onDone: () => void }) {
  // Read flow: local state and data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();

  const { data: cinemas } = useFetchCinemas();
  const { setSelections: setSessionCinemaIds } = useSessionCinemaSelections();

  const cinemaList = useMemo(() => cinemas ?? [], [cinemas]);
  // The list is normally prefetched before this page is mounted (see
  // `IntroHost`), so this is the slow-network case only. It still matters:
  // without it the very first thing a new account saw was "0 of 0 selected"
  // over an empty box, which then popped into a full list.
  const isCinemaListLoading = cinemas === undefined;
  // Deliberately starts empty rather than seeded from the account's stored
  // selection: the page asks the user to pick their cinemas, and anything
  // pre-ticked reads as a choice already made — which they then have to undo.
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set());

  const saveMutation = useMutation({
    mutationFn: (requestBody: CinemaPresetCreate) =>
      MeService.createCinemaPreset({ requestBody }),
    onSuccess: (_data, requestBody) => {
      // The user just declared these their cinemas, so show them straight away
      // rather than making them open the filter and pick the preset again.
      setSessionCinemaIds(sortCinemaIds(requestBody.cinema_ids));
      invalidateCinemaPresets(queryClient);
      retireCinemaPresetTip();
      onDone();
    },
    onError: (error) => {
      console.error("Error saving cinema preset from the intro:", error);
      Alert.alert("Could not save", "Your cinemas were not saved. Please try again.");
    },
  });

  const selectedCount = selectedIds.size;

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

  const handleSave = useCallback(() => {
    if (selectedCount === 0) return;
    saveMutation.mutate({
      name: DEFAULT_PRESET_NAME,
      cinema_ids: sortCinemaIds(selectedIds),
      // The first preset is the one the user wants on startup; the cinema
      // filter's Manage presets page is where that gets changed later.
      is_favorite: true,
    });
  }, [saveMutation, selectedCount, selectedIds]);

  // Render/output using the state and handlers prepared above.
  return (
    <IntroPageShell
      icon="theaters"
      title="Select your favorite cinemas"
      message="We'll only show you showtimes at the cinemas you pick. You can change this any time."
      primaryLabel="Save and continue"
      onPrimary={handleSave}
      isPrimaryDisabled={selectedCount === 0}
      isPrimaryBusy={saveMutation.isPending}
      secondaryLabel="Skip for now"
      onSecondary={onDone}
    >
      <View style={styles.pickerHeader}>
        {isCinemaListLoading ? (
          <Skeleton style={styles.countSkeleton} />
        ) : (
          <ThemedText style={styles.count}>
            {selectedCount} of {cinemaList.length} selected
          </ThemedText>
        )}
        {!isCinemaListLoading && selectedCount > 0 ? (
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
        style={styles.pickerBox}
        contentContainerStyle={styles.pickerContent}
        showsVerticalScrollIndicator={!isCinemaListLoading}
        scrollEnabled={!isCinemaListLoading}
      >
        {isCinemaListLoading ? (
          <View style={styles.skeletonList}>
            {Array.from({ length: SKELETON_ROW_COUNT }, (_unused, index) => (
              <Skeleton key={index} style={styles.skeletonRow} />
            ))}
          </View>
        ) : (
          <CinemaPickerList
            cinemas={cinemaList}
            selectedIds={selectedIds}
            onToggleCinema={handleToggleCinema}
            onSelectCinemas={handleSelectCinemas}
          />
        )}
      </ScrollView>
    </IntroPageShell>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    pickerHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingBottom: 8,
    },
    count: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    // Same footprint as the "N of M selected" line it stands in for, so the
    // header does not change height when the real count lands.
    countSkeleton: {
      height: 15,
      width: 120,
      borderRadius: 4,
    },
    clearAll: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.tint,
    },
    // Runs the full width of the page: the cinemas are the whole point of it.
    pickerBox: {
      flex: 1,
      marginHorizontal: -24,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
    },
    pickerContent: {
      paddingHorizontal: 24,
      paddingVertical: 12,
    },
    skeletonList: {
      gap: 14,
    },
    skeletonRow: {
      height: 20,
      borderRadius: 5,
    },
  });
