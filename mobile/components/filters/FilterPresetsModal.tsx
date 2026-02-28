import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type ListRenderItem,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MeService,
  type FilterPresetCreate,
  type FilterPresetPublic,
  type FilterPresetScope,
} from "shared";

import { ThemedText } from "@/components/themed-text";
import {
  canonicalizeDaySelections,
  getDaySelectionLabels,
} from "@/components/filters/day-filter-utils";
import {
  loadFilterPresetOrder,
  sanitizeFilterPresetOrderIds,
  saveFilterPresetOrder,
  sortFilterPresetsByOrder,
} from "@/components/filters/filter-preset-order";
import { getPresetForRange } from "@/components/filters/time-filter-presets";
import { useThemeColors } from "@/hooks/use-theme-color";

export type PageFilterPresetState = {
  selected_showtime_filter?: "all" | "interested" | "going" | null;
  showtime_audience?: "including-friends" | "only-you" | null;
  watchlist_only?: boolean;
  days?: string[] | null;
  time_ranges?: string[] | null;
};

type FilterPresetsModalProps = {
  visible: boolean;
  onClose: () => void;
  scope: FilterPresetScope;
  currentFilters: PageFilterPresetState;
  onApply: (filters: PageFilterPresetState) => void;
};

const getScopeLabel = (scope: FilterPresetScope) => {
  if (scope === "SHOWTIMES") return "Showtime";
  return "Movie";
};

const getSortedUniqueStrings = (values?: string[] | null): string[] | null => {
  if (!values || values.length === 0) return null;
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
};

const normalizeFilters = (filters: PageFilterPresetState): PageFilterPresetState => ({
  selected_showtime_filter:
    filters.selected_showtime_filter === "all" ||
    filters.selected_showtime_filter === "interested" ||
    filters.selected_showtime_filter === "going"
      ? filters.selected_showtime_filter
      : null,
  showtime_audience:
    filters.showtime_audience === "only-you" || filters.showtime_audience === "including-friends"
      ? filters.showtime_audience
      : "including-friends",
  watchlist_only: Boolean(filters.watchlist_only),
  days: canonicalizeDaySelections(filters.days),
  time_ranges: getSortedUniqueStrings(filters.time_ranges),
});

const serializeFilters = (filters: PageFilterPresetState) => JSON.stringify(normalizeFilters(filters));

const toPresetBodyFilters = (filters: PageFilterPresetState): PageFilterPresetState =>
  normalizeFilters(filters);

const getShowtimeFilterLabel = (
  selectedShowtimeFilter: PageFilterPresetState["selected_showtime_filter"]
) => {
  if (selectedShowtimeFilter === "going") return "Going";
  if (selectedShowtimeFilter === "interested") return "Interested";
  return "Any status";
};

const getWatchlistFilterLabel = (watchlistOnly: boolean | undefined) =>
  watchlistOnly ? "Watchlist" : "All movies";

const getShowtimeAudienceLabel = (
  showtimeAudience: PageFilterPresetState["showtime_audience"]
) => (showtimeAudience === "only-you" ? "Only you" : "Including friends");

const getDaysFilterLabel = (days?: string[] | null) => {
  const labels = getDaySelectionLabels(days);
  if (labels.length === 0) return "Any day";
  return labels.join(", ");
};

const getTimeRangesFilterLabel = (timeRanges?: string[] | null) => {
  const normalizedRanges = getSortedUniqueStrings(timeRanges);
  if (!normalizedRanges || normalizedRanges.length === 0) return "Any time";
  return normalizedRanges
    .map((range) => {
      const preset = getPresetForRange(range);
      if (!preset) return range;
      return preset.label;
    })
    .join(", ");
};

const getPresetSummary = (scope: FilterPresetScope, filters: PageFilterPresetState) => {
  const normalized = normalizeFilters(filters);
  const parts: string[] = [];

  if (scope === "SHOWTIMES") {
    const status = getShowtimeFilterLabel(normalized.selected_showtime_filter);
    if (status !== "Any status") parts.push(status);
    if (normalized.showtime_audience === "only-you") {
      parts.push(getShowtimeAudienceLabel(normalized.showtime_audience));
    }
  }

  const watchlist = getWatchlistFilterLabel(normalized.watchlist_only);
  if (watchlist !== "All movies") parts.push(watchlist);

  const days = getDaysFilterLabel(normalized.days);
  if (days !== "Any day") parts.push(days);

  const times = getTimeRangesFilterLabel(normalized.time_ranges);
  if (times !== "Any time") parts.push(times);

  return parts.length > 0 ? parts.join(" • ") : "No restrictions";
};

export default function FilterPresetsModal({
  visible,
  onClose,
  scope,
  currentFilters,
  onApply,
}: FilterPresetsModalProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();

  const [presetName, setPresetName] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);
  const [isSavePresetDialogVisible, setIsSavePresetDialogVisible] = useState(false);
  const [saveAsFavorite, setSaveAsFavorite] = useState(false);
  const [presetOrderIds, setPresetOrderIds] = useState<readonly string[]>([]);

  useEffect(() => {
    if (!visible) return;
    setPresetName("");
    setPresetError(null);
    setSaveAsFavorite(false);
    setIsSavePresetDialogVisible(false);

    let isMounted = true;
    loadFilterPresetOrder(scope).then((orderedIds) => {
      if (!isMounted) return;
      setPresetOrderIds(orderedIds);
    });

    return () => {
      isMounted = false;
    };
  }, [scope, visible]);

  const presetsQueryKey = useMemo(() => ["filter-presets", scope] as const, [scope]);
  const { data: presets = [], isLoading: isPresetsLoading } = useQuery({
    queryKey: presetsQueryKey,
    enabled: visible,
    queryFn: () => MeService.getFilterPresets({ scope }),
  });

  const currentFilterSignature = useMemo(() => serializeFilters(currentFilters), [currentFilters]);
  const currentFiltersSummary = useMemo(
    () => getPresetSummary(scope, currentFilters),
    [currentFilters, scope]
  );
  const favoritePreset = useMemo(
    () => presets.find((preset) => preset.is_favorite) ?? null,
    [presets]
  );
  const isFavoriteApplied = useMemo(() => {
    if (!favoritePreset) return false;
    return serializeFilters(normalizeFilters(favoritePreset.filters)) === currentFilterSignature;
  }, [currentFilterSignature, favoritePreset]);
  const canUseFavorite = Boolean(favoritePreset) && !isFavoriteApplied;

  const orderedPresets = useMemo(
    () => sortFilterPresetsByOrder(presets, presetOrderIds),
    [presetOrderIds, presets]
  );
  const presetsForRender = useMemo(
    () => (orderedPresets.length > 0 || presets.length === 0 ? orderedPresets : presets),
    [orderedPresets, presets]
  );
  const selectionMatchesPreset = useMemo(
    () =>
      presets.some(
        (preset) => serializeFilters(normalizeFilters(preset.filters)) === currentFilterSignature
      ),
    [currentFilterSignature, presets]
  );

  useEffect(() => {
    if (presetOrderIds.length === 0 || presets.length === 0) return;
    const presetIdSet = new Set(presets.map((preset) => preset.id));
    const trimmedOrder = presetOrderIds.filter((presetId) => presetIdSet.has(presetId));
    if (trimmedOrder.length === presetOrderIds.length) return;
    const normalizedOrder = sanitizeFilterPresetOrderIds(trimmedOrder);
    setPresetOrderIds(normalizedOrder);
    saveFilterPresetOrder(scope, normalizedOrder).catch(() => undefined);
  }, [presetOrderIds, presets, scope]);

  const savePresetMutation = useMutation({
    mutationFn: (requestBody: FilterPresetCreate) => MeService.saveFilterPreset({ requestBody }),
    onSuccess: () => {
      setPresetError(null);
      setPresetName("");
      setSaveAsFavorite(false);
      setIsSavePresetDialogVisible(false);
      queryClient.invalidateQueries({ queryKey: presetsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["user", "favorite_filter_preset", scope] });
    },
    onError: () => {
      setPresetError("Could not save preset. Please try again.");
    },
  });

  const deletePresetMutation = useMutation({
    mutationFn: (presetId: string) => MeService.deleteFilterPreset({ presetId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: presetsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["user", "favorite_filter_preset", scope] });
    },
  });

  const setFavoritePresetMutation = useMutation({
    mutationFn: (presetId: string) => MeService.setFavoriteFilterPreset({ presetId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: presetsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["user", "favorite_filter_preset", scope] });
    },
  });

  const handleApplyPreset = useCallback(
    (preset: FilterPresetPublic) => {
      onApply(normalizeFilters(preset.filters));
    },
    [onApply]
  );

  const handleDeletePreset = useCallback(
    (preset: FilterPresetPublic) => {
      if (preset.is_default) return;
      Alert.alert(
        "Delete preset?",
        `Are you sure you want to delete "${preset.name}"?`,
        [
          {
            text: "Cancel",
            style: "cancel",
          },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              deletePresetMutation.mutate(preset.id);
            },
          },
        ],
        { cancelable: true }
      );
    },
    [deletePresetMutation]
  );

  const handleSetFavoritePreset = useCallback(
    (preset: FilterPresetPublic) => {
      if (preset.is_favorite) return;
      setFavoritePresetMutation.mutate(preset.id);
    },
    [setFavoritePresetMutation]
  );

  const persistPresetOrder = useCallback(
    (orderedIds: readonly string[]) => {
      const normalizedOrder = sanitizeFilterPresetOrderIds(orderedIds);
      setPresetOrderIds(normalizedOrder);
      saveFilterPresetOrder(scope, normalizedOrder).catch(() => undefined);
    },
    [scope]
  );

  const handleReorderPresets = useCallback(
    (reorderedPresets: readonly FilterPresetPublic[]) => {
      persistPresetOrder(reorderedPresets.map((preset) => preset.id));
    },
    [persistPresetOrder]
  );

  const handleMovePreset = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex || toIndex >= presetsForRender.length) {
        return;
      }
      const reorderedPresets = [...presetsForRender];
      const [movedPreset] = reorderedPresets.splice(fromIndex, 1);
      if (!movedPreset) return;
      reorderedPresets.splice(toIndex, 0, movedPreset);
      handleReorderPresets(reorderedPresets);
    },
    [handleReorderPresets, presetsForRender]
  );

  const handleUseFavorite = useCallback(() => {
    if (!favoritePreset) return;
    handleApplyPreset(favoritePreset);
  }, [favoritePreset, handleApplyPreset]);

  const handleOpenSavePresetDialog = useCallback(() => {
    if (selectionMatchesPreset) return;
    setPresetName("");
    setPresetError(null);
    setSaveAsFavorite(false);
    setIsSavePresetDialogVisible(true);
  }, [selectionMatchesPreset]);

  const handleCloseSavePresetDialog = useCallback(() => {
    if (savePresetMutation.isPending) return;
    setIsSavePresetDialogVisible(false);
    setPresetError(null);
  }, [savePresetMutation.isPending]);

  const handleSavePreset = useCallback(() => {
    const trimmed = presetName.trim();
    if (!trimmed) {
      setPresetError("Enter a preset name.");
      return;
    }

    savePresetMutation.mutate({
      name: trimmed,
      scope,
      filters: toPresetBodyFilters(currentFilters),
      is_favorite: saveAsFavorite,
    });
  }, [currentFilters, presetName, saveAsFavorite, savePresetMutation, scope]);

  const renderPreset: ListRenderItem<FilterPresetPublic> = useCallback(
    ({ item, index }) => {
      const normalizedItemFilters = normalizeFilters(item.filters);
      const isCurrent = serializeFilters(normalizedItemFilters) === currentFilterSignature;
      const summary = getPresetSummary(scope, normalizedItemFilters);
      const isDefaultPreset = item.is_default;
      const favoriteDisabled = item.is_favorite || setFavoritePresetMutation.isPending;
      const deleteDisabled = isDefaultPreset || deletePresetMutation.isPending;
      const itemIndex = index ?? -1;
      const canMoveUp = itemIndex > 0;
      const canMoveDown = itemIndex >= 0 && itemIndex < presetsForRender.length - 1;

      return (
        <TouchableOpacity
          style={[styles.presetCard, isCurrent && styles.presetCardCurrent]}
          onPress={() => handleApplyPreset(item)}
          activeOpacity={0.88}
        >
          <View style={styles.presetHeader}>
            <View style={styles.presetTitleWrap}>
              <View style={styles.presetNameRow}>
                <ThemedText numberOfLines={1} style={styles.presetName}>
                  {item.name}
                </ThemedText>
              </View>
              <ThemedText numberOfLines={1} style={styles.presetMeta}>
                {summary}
              </ThemedText>
            </View>

            <View style={styles.presetHeaderActions}>
              <TouchableOpacity
                style={[
                  styles.iconActionButton,
                  item.is_favorite && styles.iconActionButtonFavorite,
                  favoriteDisabled && !item.is_favorite && styles.iconActionButtonDisabled,
                ]}
                onPress={(event) => {
                  event.stopPropagation();
                  handleSetFavoritePreset(item);
                }}
                activeOpacity={0.8}
                disabled={favoriteDisabled}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <MaterialIcons
                  name={item.is_favorite ? "star" : "star-border"}
                  size={16}
                  color={item.is_favorite ? colors.yellow.secondary : colors.textSecondary}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.iconActionButton, deleteDisabled && styles.iconActionButtonDisabled]}
                onPress={(event) => {
                  event.stopPropagation();
                  handleDeletePreset(item);
                }}
                activeOpacity={0.8}
                disabled={deleteDisabled}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <MaterialIcons name="delete-outline" size={16} color={colors.textSecondary} />
              </TouchableOpacity>

              <View style={styles.reorderControls}>
                <TouchableOpacity
                  style={[styles.iconActionButton, !canMoveUp && styles.iconActionButtonDisabled]}
                  onPress={(event) => {
                    event.stopPropagation();
                    if (canMoveUp) handleMovePreset(itemIndex, itemIndex - 1);
                  }}
                  activeOpacity={0.8}
                  disabled={!canMoveUp}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <MaterialIcons name="keyboard-arrow-up" size={17} color={colors.textSecondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.iconActionButton, !canMoveDown && styles.iconActionButtonDisabled]}
                  onPress={(event) => {
                    event.stopPropagation();
                    if (canMoveDown) handleMovePreset(itemIndex, itemIndex + 1);
                  }}
                  activeOpacity={0.8}
                  disabled={!canMoveDown}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <MaterialIcons name="keyboard-arrow-down" size={17} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [
      colors.textSecondary,
      colors.yellow.secondary,
      currentFilterSignature,
      deletePresetMutation.isPending,
      handleApplyPreset,
      handleDeletePreset,
      handleMovePreset,
      handleSetFavoritePreset,
      presetsForRender.length,
      scope,
      setFavoritePresetMutation.isPending,
      styles,
    ]
  );

  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.modalContainer} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>{getScopeLabel(scope)} Presets</ThemedText>
          <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.8}>
            <ThemedText style={styles.closeButtonText}>Close</ThemedText>
          </TouchableOpacity>
        </View>

        <View style={styles.presetsContainer}>
          {isPresetsLoading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.tint} />
              <ThemedText style={styles.loadingText}>Loading presets...</ThemedText>
            </View>
          ) : (
            <FlatList
              data={presetsForRender}
              keyExtractor={(item) => item.id}
              renderItem={renderPreset}
              style={styles.mainContent}
              contentContainerStyle={styles.content}
              ItemSeparatorComponent={() => <View style={styles.sectionSeparator} />}
              ListHeaderComponent={
                presetsForRender.length > 1 ? (
                  <ThemedText style={styles.reorderHintText}>Use arrows to reorder presets.</ThemedText>
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.emptyPresets}>
                  <ThemedText style={styles.emptyPresetsText}>
                    No filter presets yet. Use Save as preset to create one.
                  </ThemedText>
                </View>
              }
            />
          )}
        </View>

        <View style={styles.preferenceFooter}>
          <View style={styles.preferenceText}>
            <ThemedText style={styles.preferenceTitle}>Current filters</ThemedText>
            <ThemedText numberOfLines={2} style={styles.preferenceSubtitle}>
              {currentFiltersSummary}
            </ThemedText>
          </View>
          <View style={styles.preferenceActions}>
            <TouchableOpacity
              style={[
                styles.preferenceButton,
                styles.preferenceButtonSubtle,
                styles.preferenceButtonGrow,
                !canUseFavorite && styles.preferenceButtonDisabled,
              ]}
              onPress={handleUseFavorite}
              activeOpacity={0.8}
              disabled={!canUseFavorite}
            >
              <View style={styles.preferenceButtonInner}>
                <MaterialIcons name="history" size={16} color={colors.textSecondary} />
                <ThemedText style={[styles.preferenceButtonText, styles.preferenceButtonTextSubtle]}>
                  Use favorite
                </ThemedText>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.preferenceButton,
                styles.preferenceButtonSubtle,
                styles.preferenceButtonGrow,
                selectionMatchesPreset && styles.preferenceButtonDisabled,
              ]}
              onPress={handleOpenSavePresetDialog}
              activeOpacity={0.8}
              disabled={selectionMatchesPreset}
            >
              <View style={styles.preferenceButtonInner}>
                <MaterialIcons name="save" size={16} color={colors.textSecondary} />
                <ThemedText style={[styles.preferenceButtonText, styles.preferenceButtonTextSubtle]}>
                  Save as preset
                </ThemedText>
              </View>
            </TouchableOpacity>
          </View>
        </View>

        <Modal
          transparent
          visible={isSavePresetDialogVisible}
          animationType="fade"
          onRequestClose={handleCloseSavePresetDialog}
        >
          <View style={styles.dialogBackdrop}>
            <TouchableOpacity
              style={styles.dialogBackdropPressable}
              activeOpacity={1}
              onPress={handleCloseSavePresetDialog}
            />
            <View style={styles.dialogCard}>
              <View style={styles.dialogHeader}>
                <ThemedText style={styles.dialogTitle}>Save as preset</ThemedText>
                <ThemedText style={styles.dialogSubtitle}>
                  Save your current filter selection to reuse it later.
                </ThemedText>
              </View>
              <TextInput
                value={presetName}
                onChangeText={(value) => {
                  setPresetName(value);
                  if (presetError) setPresetError(null);
                }}
                placeholder="Filter preset name"
                placeholderTextColor={colors.textSecondary}
                style={styles.dialogInput}
                maxLength={80}
                autoCapitalize="words"
                autoCorrect={false}
                autoFocus
              />
              <TouchableOpacity
                style={styles.favoriteToggle}
                onPress={() => setSaveAsFavorite((current) => !current)}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name={saveAsFavorite ? "check-box" : "check-box-outline-blank"}
                  size={20}
                  color={saveAsFavorite ? colors.tint : colors.textSecondary}
                />
                <View style={styles.favoriteToggleText}>
                  <ThemedText style={styles.favoriteToggleTitle}>Save as default preset</ThemedText>
                  <ThemedText style={styles.favoriteToggleSubtitle}>
                    This marks the preset as your favorite.
                  </ThemedText>
                </View>
              </TouchableOpacity>
              {presetError ? <ThemedText style={styles.presetErrorText}>{presetError}</ThemedText> : null}
              <View style={styles.dialogActions}>
                <TouchableOpacity
                  style={[styles.dialogButton, styles.dialogButtonSecondary]}
                  onPress={handleCloseSavePresetDialog}
                  activeOpacity={0.8}
                  disabled={savePresetMutation.isPending}
                >
                  <ThemedText style={[styles.dialogButtonText, styles.dialogButtonTextSecondary]}>
                    Cancel
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.dialogButton,
                    styles.dialogButtonPrimary,
                    (savePresetMutation.isPending || presetName.trim().length === 0) &&
                      styles.dialogButtonDisabled,
                  ]}
                  onPress={handleSavePreset}
                  activeOpacity={0.8}
                  disabled={savePresetMutation.isPending || presetName.trim().length === 0}
                >
                  <ThemedText style={[styles.dialogButtonText, styles.dialogButtonTextPrimary]}>
                    {savePresetMutation.isPending ? "Saving..." : "Save"}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    modalContainer: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingHorizontal: 16,
      paddingTop: Platform.OS === "ios" ? 20 : 12,
      paddingBottom: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    title: {
      fontSize: 18,
      fontWeight: "700",
    },
    closeButton: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: colors.pillBackground,
    },
    closeButtonText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    mainContent: {
      flex: 1,
    },
    content: {
      padding: 16,
      paddingBottom: 20,
    },
    sectionSeparator: {
      height: 14,
    },
    presetsContainer: {
      flex: 1,
    },
    loadingContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: 20,
    },
    loadingText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    presetErrorText: {
      fontSize: 12,
      color: colors.red.secondary,
    },
    presetCard: {
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      padding: 12,
      gap: 10,
    },
    presetCardCurrent: {
      borderColor: colors.green.secondary,
      backgroundColor: colors.green.primary,
    },
    presetHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      gap: 8,
    },
    presetTitleWrap: {
      flex: 1,
      gap: 3,
    },
    presetNameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      minWidth: 0,
    },
    presetName: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
      flex: 1,
    },
    presetMeta: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    presetHeaderActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    iconActionButton: {
      width: 28,
      height: 28,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    iconActionButtonFavorite: {
      borderColor: colors.yellow.secondary,
      backgroundColor: colors.yellow.primary,
    },
    iconActionButtonDisabled: {
      opacity: 0.5,
    },
    reorderControls: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    reorderHintText: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 10,
    },
    emptyPresets: {
      paddingVertical: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyPresetsText: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: "center",
    },
    preferenceFooter: {
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      backgroundColor: colors.background,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 10,
      gap: 10,
    },
    preferenceText: {
      gap: 3,
    },
    preferenceSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    preferenceTitle: {
      fontSize: 13,
      fontWeight: "700",
    },
    preferenceActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      flexWrap: "nowrap",
    },
    preferenceButton: {
      minHeight: 40,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    preferenceButtonSubtle: {
      backgroundColor: colors.cardBackground,
      borderColor: colors.divider,
    },
    preferenceButtonGrow: {
      flex: 1,
    },
    preferenceButtonDisabled: {
      opacity: 0.5,
    },
    preferenceButtonInner: {
      flexDirection: "row",
      alignItems: "center",
      columnGap: 6,
    },
    preferenceButtonText: {
      fontSize: 12,
      fontWeight: "600",
    },
    preferenceButtonTextSubtle: {
      color: colors.textSecondary,
    },
    dialogBackdrop: {
      flex: 1,
      backgroundColor: "rgba(15, 18, 27, 0.55)",
      justifyContent: "center",
      paddingHorizontal: 20,
    },
    dialogBackdropPressable: {
      ...StyleSheet.absoluteFillObject,
    },
    dialogCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      padding: 16,
      gap: 12,
    },
    dialogHeader: {
      gap: 2,
    },
    dialogTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    dialogSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    dialogInput: {
      borderWidth: 1,
      borderColor: colors.divider,
      borderRadius: 12,
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.cardBackground,
      color: colors.text,
      fontSize: 14,
      fontWeight: "500",
    },
    favoriteToggle: {
      flexDirection: "row",
      alignItems: "center",
      columnGap: 10,
      paddingVertical: 2,
    },
    favoriteToggleText: {
      flex: 1,
      gap: 1,
    },
    favoriteToggleTitle: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    favoriteToggleSubtitle: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    dialogActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 8,
      marginTop: 2,
    },
    dialogButton: {
      minHeight: 38,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    dialogButtonPrimary: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    dialogButtonSecondary: {
      backgroundColor: colors.cardBackground,
      borderColor: colors.divider,
    },
    dialogButtonDisabled: {
      opacity: 0.5,
    },
    dialogButtonText: {
      fontSize: 12,
      fontWeight: "700",
    },
    dialogButtonTextPrimary: {
      color: colors.pillActiveText,
    },
    dialogButtonTextSecondary: {
      color: colors.textSecondary,
    },
  });
