/**
 * Feature tip: the user filters showtimes but has never saved a preset, so the
 * same combination gets rebuilt by hand every time. Offers their current
 * selection plus a short catalogue of ready-made presets, each saved from here
 * with one button, and finishes by opening the filters where presets live.
 *
 * Saving is additive: a user can take several suggestions in one visit, and a
 * row that has been taken says so rather than disappearing.
 *
 * Eligibility lives in `FeatureTipsHost`; this component renders and saves.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService, type SavedPresetCreate } from "shared";
import useAuth from "shared/hooks/useAuth";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchLetterboxdLists } from "shared/hooks/useLetterboxdLists";

import { useFiltersModal } from "@/components/filters/FiltersModalProvider";
import {
  buildPremadeSavedPreset,
  PREMADE_FILTER_PRESETS,
} from "@/components/filters/premade-filter-presets";
import {
  buildSavedPresetCreate,
  displayPresetsQueryKey,
} from "@/components/filters/saved-presets";
import { hasAnyActiveFilter } from "@/components/filters/filter-preset-utils";
import FeatureTipModal, { FEATURE_TIP_COMPACT_PADDING } from "@/components/tips/FeatureTipModal";
import { ThemedText } from "@/components/themed-text";
import NamePromptDialog from "@/components/ui/NamePromptDialog";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useCurrentFilterPresetState } from "@/hooks/useSharedTabFilters";
import { useDismissTip } from "@/utils/feature-tips";

/** Identifies the "save what I have right now" row, which has no fixed name. */
const CURRENT_FILTERS_ROW_ID = "current-filters";

type PresetRow = {
  id: string;
  name: string;
  summary: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  /** Null when the row has to ask for a name before it can be built. */
  build: (() => SavedPresetCreate) | null;
};

export default function FilterPresetTip() {
  // Read flow: data hooks first, then handlers, then the JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const dismissTip = useDismissTip("filter-presets");
  const { openFiltersModal } = useFiltersModal();
  const { user } = useAuth();

  const { data: cinemas } = useFetchCinemas();
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  const { data: letterboxdLists } = useFetchLetterboxdLists(hasLetterboxdUsername);
  const currentFilters = useCurrentFilterPresetState();

  const [savedRowIds, setSavedRowIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const [isNamingCurrentFilters, setIsNamingCurrentFilters] = useState(false);
  // Opening the filters has to wait for the dialog to be gone, so the intent is
  // parked here and acted on from the dismissal.
  const shouldOpenFilters = useRef(false);

  const allCinemaIds = useMemo(() => (cinemas ?? []).map((cinema) => cinema.id), [cinemas]);
  const listIds = useMemo(
    () => (letterboxdLists ?? []).map((list) => list.id),
    [letterboxdLists]
  );

  const saveMutation = useMutation({
    mutationFn: ({ requestBody }: { rowId: string; requestBody: SavedPresetCreate }) =>
      MeService.createSavedPreset({ requestBody }),
    onSuccess: (_data, { rowId }) => {
      setSavedRowIds((current) => new Set(current).add(rowId));
      setIsNamingCurrentFilters(false);
      queryClient.invalidateQueries({ queryKey: displayPresetsQueryKey });
    },
    onError: (error) => {
      console.error("Error saving filter preset from tip:", error);
      Alert.alert("Could not save", "That preset was not saved. Please try again.");
    },
    onSettled: () => setPendingRowId(null),
  });

  const savePreset = useCallback(
    (rowId: string, requestBody: SavedPresetCreate) => {
      setPendingRowId(rowId);
      saveMutation.mutate({ rowId, requestBody });
    },
    [saveMutation]
  );

  const rows = useMemo<PresetRow[]>(() => {
    const premadeRows = PREMADE_FILTER_PRESETS.map((preset) => ({
      id: preset.id,
      name: preset.name,
      summary: preset.summary,
      icon: preset.icon,
      build: () => buildPremadeSavedPreset({ preset, allCinemaIds, listIds }),
    }));

    if (!hasAnyActiveFilter(currentFilters)) return premadeRows;

    return [
      {
        id: CURRENT_FILTERS_ROW_ID,
        name: "Your current filters",
        summary: "Save the selection you have set right now",
        icon: "bookmark-add" as const,
        build: null,
      },
      ...premadeRows,
    ];
  }, [allCinemaIds, currentFilters, listIds]);

  const handleAddRow = useCallback(
    (row: PresetRow) => {
      if (!row.build) {
        setIsNamingCurrentFilters(true);
        return;
      }
      savePreset(row.id, row.build());
    },
    [savePreset]
  );

  const handleNameCurrentFilters = useCallback(
    (name: string) => {
      savePreset(
        CURRENT_FILTERS_ROW_ID,
        buildSavedPresetCreate({
          name,
          isFavorite: false,
          // Saved as a full preset: the user asked for "what I have now", and
          // leaving dimensions untouched would make it mean something else.
          untouchedFields: [],
          includeCinemas: false,
          currentFilters,
          cinemaIds: [],
        })
      );
    },
    [currentFilters, savePreset]
  );

  const handleOpenFilters = useCallback(() => {
    shouldOpenFilters.current = true;
  }, []);

  const handleDismiss = useCallback(
    (dismissForever: boolean) => {
      dismissTip(dismissForever);
      if (!shouldOpenFilters.current) return;
      openFiltersModal({ showGroupByMovie: true, showPresets: true });
    },
    [dismissTip, openFiltersModal]
  );

  // Render/output using the state and handlers prepared above.
  return (
    <FeatureTipModal
      icon="tune"
      title="Save your filters as a preset"
      message="Presets remember a set of filters so you can apply them again in one tap."
      density="compact"
      actionLabel="Open filters"
      onAction={handleOpenFilters}
      closeOnAction
      onDismiss={handleDismiss}
    >
      <ScrollView
        style={styles.listBox}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator
        // Scrolls inside the dialog, so the button and the dismissal row below
        // it stay put however many suggestions there are.
        nestedScrollEnabled
      >
        {rows.map((row, index) => {
          const isSaved = savedRowIds.has(row.id);
          const isPending = pendingRowId === row.id;
          // Another row is mid-save: still pressable-looking would be a lie.
          const isBlocked = saveMutation.isPending && !isPending && !isSaved;
          return (
            <View key={row.id} style={[styles.row, index > 0 && styles.rowDivided]}>
              <MaterialIcons
                name={row.icon}
                size={16}
                color={isSaved ? colors.green.secondary : colors.tint}
              />
              <View style={styles.rowText}>
                <ThemedText style={styles.rowName} numberOfLines={1}>
                  {row.name}
                </ThemedText>
                <ThemedText style={styles.rowSummary} numberOfLines={2}>
                  {row.summary}
                </ThemedText>
              </View>
              {/* Only the button saves: a stray tap on the row must not add a
                  preset the user did not ask for. */}
              <TouchableOpacity
                style={[
                  styles.addButton,
                  isSaved && styles.addButtonSaved,
                  isBlocked && styles.addButtonBlocked,
                ]}
                onPress={() => handleAddRow(row)}
                disabled={isSaved || isPending || saveMutation.isPending}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={isSaved ? `${row.name} added` : `Add ${row.name}`}
              >
                {isPending ? (
                  <ActivityIndicator size="small" color={colors.pillActiveText} />
                ) : (
                  <>
                    <MaterialIcons
                      name={isSaved ? "check" : "add"}
                      size={14}
                      color={isSaved ? colors.green.secondary : colors.pillActiveText}
                    />
                    <ThemedText style={[styles.addLabel, isSaved && styles.addLabelSaved]}>
                      {isSaved ? "Added" : "Add"}
                    </ThemedText>
                  </>
                )}
              </TouchableOpacity>
            </View>
          );
        })}
      </ScrollView>

      {/* Nested rather than a sibling: iOS is unreliable about presenting two
          modals from the same level, and this one has to sit over the tip. */}
      <NamePromptDialog
        visible={isNamingCurrentFilters}
        title="Give this preset a name:"
        placeholder="My filters"
        confirmLabel="Save"
        isBusy={pendingRowId === CURRENT_FILTERS_ROW_ID}
        onConfirm={handleNameCurrentFilters}
        onCancel={() => setIsNamingCurrentFilters(false)}
      />
    </FeatureTipModal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    // Runs the full width of the card, like the cinema tip's picker.
    listBox: {
      marginHorizontal: -FEATURE_TIP_COMPACT_PADDING,
      maxHeight: 300,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: colors.background,
    },
    listContent: {
      paddingHorizontal: FEATURE_TIP_COMPACT_PADDING,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      paddingVertical: 7,
    },
    rowDivided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    rowText: {
      flex: 1,
    },
    rowName: {
      fontSize: 13,
      lineHeight: 17,
      fontWeight: "700",
      color: colors.text,
    },
    rowSummary: {
      fontSize: 10,
      lineHeight: 13,
      color: colors.textSecondary,
    },
    addButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      // Both states are the same width, so a row does not jump when it flips.
      width: 72,
      height: 28,
      gap: 3,
      borderRadius: 999,
      backgroundColor: colors.tint,
    },
    // Saved reads as a quiet confirmation rather than another thing to press.
    addButtonSaved: {
      backgroundColor: colors.green.primary,
    },
    addButtonBlocked: {
      opacity: 0.4,
    },
    addLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.pillActiveText,
    },
    addLabelSaved: {
      color: colors.green.secondary,
    },
  });
