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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
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
import { useDisplayPresets } from "@/components/filters/useDisplayPresets";
import {
  hasAnyActiveFilter,
  presetRequiresLetterboxd,
} from "@/components/filters/filter-preset-utils";
import FeatureTipModal, { FEATURE_TIP_COMPACT_PADDING } from "@/components/tips/FeatureTipModal";
import { ThemedText } from "@/components/themed-text";
import NamePromptDialog from "@/components/ui/NamePromptDialog";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useCurrentFilterPresetState } from "@/hooks/useSharedTabFilters";
import { triggerSelectionHaptic } from "@/utils/long-press";
import { useDismissTip } from "@/utils/feature-tips";
import { useIsSignedIn } from "@/utils/auth-session";
import { useAnimatedValue } from "@/hooks/useAnimatedValue";

/** Identifies the "save what I have right now" row, which has no fixed name. */
const CURRENT_FILTERS_ROW_ID = "current-filters";

type PresetRow = {
  id: string;
  name: string;
  summary: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  /** Null when the row has to ask for a name before it can be built. */
  build: (() => SavedPresetCreate) | null;
  /** True when applying this preset needs a Letterboxd username the user hasn't set. */
  needsLetterboxdUsername: boolean;
  /**
   * The row is already among the user's saved presets — from a previous visit
   * to this tip, or saved by hand under the same name. Only the ready-made
   * rows can know this: they save under a fixed name, while "your current
   * filters" is named by the user and has no identity to match on.
   */
  isAlreadySaved: boolean;
};

type FilterPresetTipProps = {
  /**
   * Opened as on-demand help (e.g. the info icon next to the empty saved-
   * presets row) rather than as a proactive suggestion: hides "Don't show
   * this again" and closes locally instead of touching the tip's dismissal
   * state.
   */
  isPreview?: boolean;
  onClose?: () => void;
};

export default function FilterPresetTip({ isPreview = false, onClose }: FilterPresetTipProps) {
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
  // What the user has already saved, so a row taken on an earlier visit still
  // reads "Added" when the tip is opened again. Same query as the presets row,
  // and the save below invalidates it.
  const isSignedIn = useIsSignedIn();
  const { presets: savedPresets } = useDisplayPresets({ enabled: isSignedIn });
  const savedPresetNames = useMemo(
    () => new Set(savedPresets.map((preset) => preset.name.trim().toLowerCase())),
    [savedPresets]
  );

  const [savedRowIds, setSavedRowIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const [isNamingCurrentFilters, setIsNamingCurrentFilters] = useState(false);
  // Opening the filters has to wait for the dialog to be gone, so the intent is
  // parked here and acted on from the dismissal.
  const shouldOpenFilters = useRef(false);

  // A quiet, non-blocking note shown when the user taps a greyed-out "Add" for
  // a preset that needs a Letterboxd username. Fades in and back out on its
  // own rather than opening another dialog, so it never steals focus.
  const [isLetterboxdNoticeVisible, setIsLetterboxdNoticeVisible] = useState(false);
  const letterboxdNoticeAnim = useAnimatedValue(0);
  const letterboxdNoticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showLetterboxdNotice = useCallback(() => {
    triggerSelectionHaptic();
    setIsLetterboxdNoticeVisible(true);
    if (letterboxdNoticeTimer.current) clearTimeout(letterboxdNoticeTimer.current);
    letterboxdNoticeAnim.stopAnimation();
    Animated.timing(letterboxdNoticeAnim, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();
    letterboxdNoticeTimer.current = setTimeout(() => {
      Animated.timing(letterboxdNoticeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => setIsLetterboxdNoticeVisible(false));
    }, 2200);
  }, [letterboxdNoticeAnim]);

  useEffect(
    () => () => {
      if (letterboxdNoticeTimer.current) clearTimeout(letterboxdNoticeTimer.current);
    },
    []
  );

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
      // The user could not have picked a watchlist/watched-status filter
      // without a Letterboxd username in the first place, so only the
      // premade suggestions need this check.
      needsLetterboxdUsername: presetRequiresLetterboxd(preset.filters) && !hasLetterboxdUsername,
      isAlreadySaved: savedPresetNames.has(preset.name.trim().toLowerCase()),
    }));

    if (!hasAnyActiveFilter(currentFilters)) return premadeRows;

    return [
      {
        id: CURRENT_FILTERS_ROW_ID,
        name: "Your current filters",
        summary: "Save the selection you have set right now",
        icon: "bookmark-add" as const,
        build: null,
        needsLetterboxdUsername: false,
        isAlreadySaved: false,
      },
      ...premadeRows,
    ];
  }, [allCinemaIds, currentFilters, hasLetterboxdUsername, listIds, savedPresetNames]);

  const handleAddRow = useCallback(
    (row: PresetRow) => {
      if (row.needsLetterboxdUsername) {
        showLetterboxdNotice();
        return;
      }
      if (!row.build) {
        setIsNamingCurrentFilters(true);
        return;
      }
      savePreset(row.id, row.build());
    },
    [savePreset, showLetterboxdNotice, setIsNamingCurrentFilters]
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
      if (isPreview) {
        onClose?.();
      } else {
        dismissTip(dismissForever);
      }
      if (!shouldOpenFilters.current) return;
      openFiltersModal({ showGroupByMovie: true, showPresets: true });
    },
    [dismissTip, isPreview, onClose, openFiltersModal]
  );

  // Render/output using the state and handlers prepared above.
  return (
    <FeatureTipModal
      tipId="filter-presets"
      icon="tune"
      title="Save your filters as a preset"
      message="Presets remember a set of filters so you can apply them again in one tap."
      density="compact"
      actionLabel="Choose your own filters"
      onAction={handleOpenFilters}
      closeOnAction
      hideDismissForever={isPreview}
      onDismiss={handleDismiss}
    >
      {/* Relative wrapper so the notice below can float over the list as an
          overlay instead of a sibling — an absolute child never affects a
          parent's size, so the card can't resize when it appears. */}
      <View style={styles.listWrapper}>
      <ScrollView
        style={styles.listBox}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator
        // Scrolls inside the dialog, so the button and the dismissal row below
        // it stay put however many suggestions there are.
        nestedScrollEnabled
      >
        {rows.map((row, index) => {
          // Local state first: the button has to flip the instant the save
          // lands, ahead of the presets query refetching underneath it.
          const isSaved = savedRowIds.has(row.id) || row.isAlreadySaved;
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
                  (isBlocked || row.needsLetterboxdUsername) && styles.addButtonBlocked,
                ]}
                onPress={() => handleAddRow(row)}
                // Deliberately still pressable when it needs a Letterboxd
                // username: the tap is how the user learns why it's greyed out.
                disabled={isSaved || isPending || saveMutation.isPending}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={
                  isSaved
                    ? `${row.name} added`
                    : row.needsLetterboxdUsername
                      ? `Add ${row.name}, needs a Letterboxd username`
                      : `Add ${row.name}`
                }
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

      {/* Absolutely positioned overlay: floats over the bottom of the list
          instead of a sibling in flow, so the card can never resize when it
          appears or disappears. `pointerEvents="none"` lets scrolling and
          taps pass straight through to the list underneath. */}
      {isLetterboxdNoticeVisible ? (
        <Animated.View
          style={[styles.letterboxdNotice, { opacity: letterboxdNoticeAnim }]}
          pointerEvents="none"
        >
          <MaterialIcons name="info-outline" size={13} color={colors.textSecondary} />
          <ThemedText style={styles.letterboxdNoticeText}>
            Add your Letterboxd username to use this preset
          </ThemedText>
        </Animated.View>
      ) : null}
      </View>

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
    // Establishes the positioning context for the floating notice below.
    listWrapper: {
      position: "relative",
    },
    letterboxdNotice: {
      position: "absolute",
      left: 10,
      right: 10,
      bottom: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      backgroundColor: colors.cardBackground,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4,
    },
    letterboxdNoticeText: {
      fontSize: 11,
      color: colors.textSecondary,
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
