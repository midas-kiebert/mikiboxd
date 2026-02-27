import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type ListRenderItem,
} from "react-native";
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

type PresetDetail = {
  key: string;
  label: string;
  value: string;
};

const getScopeLabel = (scope: FilterPresetScope) => {
  if (scope === "SHOWTIMES") return "Showtimes";
  return "Movies";
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
  if (selectedShowtimeFilter === "going") return "Going only";
  if (selectedShowtimeFilter === "interested") return "Interested + Going";
  return "Any status";
};

const getWatchlistFilterLabel = (watchlistOnly: boolean | undefined) =>
  watchlistOnly ? "Only watchlist titles" : "Include all titles";

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
      return `${preset.label} (${preset.range})`;
    })
    .join(", ");
};

const getPresetDetails = (
  scope: FilterPresetScope,
  filters: PageFilterPresetState
): PresetDetail[] => {
  const details: PresetDetail[] = [];
  if (scope === "SHOWTIMES") {
    details.push({
      key: "status",
      label: "Status",
      value: getShowtimeFilterLabel(filters.selected_showtime_filter),
    });
    details.push({
      key: "audience",
      label: "Audience",
      value: getShowtimeAudienceLabel(filters.showtime_audience),
    });
  }
  details.push(
    {
      key: "watchlist",
      label: "Watchlist",
      value: getWatchlistFilterLabel(filters.watchlist_only),
    },
    {
      key: "days",
      label: "Days",
      value: getDaysFilterLabel(filters.days),
    },
    {
      key: "times",
      label: "Times",
      value: getTimeRangesFilterLabel(filters.time_ranges),
    }
  );
  return details;
};

export default function FilterPresetsModal({
  visible,
  onClose,
  scope,
  currentFilters,
  onApply,
}: FilterPresetsModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const [presetName, setPresetName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setPresetName("");
    setSaveError(null);
  }, [visible, scope]);

  const presetsQueryKey = useMemo(() => ["filter-presets", scope] as const, [scope]);
  const { data: presets = [], isLoading } = useQuery({
    queryKey: presetsQueryKey,
    enabled: visible,
    queryFn: () => MeService.getFilterPresets({ scope }),
  });

  const savePresetMutation = useMutation({
    mutationFn: (requestBody: FilterPresetCreate) => MeService.saveFilterPreset({ requestBody }),
    onSuccess: () => {
      setPresetName("");
      setSaveError(null);
      queryClient.invalidateQueries({ queryKey: presetsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["user", "favorite_filter_preset", scope] });
    },
    onError: () => {
      setSaveError("Could not save preset. Please try again.");
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

  const activeFilterSignature = useMemo(() => serializeFilters(currentFilters), [currentFilters]);

  const handleSavePreset = useCallback(() => {
    const trimmed = presetName.trim();
    if (!trimmed) {
      setSaveError("Enter a preset name.");
      return;
    }

    savePresetMutation.mutate({
      name: trimmed,
      scope,
      filters: toPresetBodyFilters(currentFilters),
    });
  }, [currentFilters, presetName, savePresetMutation, scope]);

  const handleApplyPreset = useCallback(
    (preset: FilterPresetPublic) => {
      onApply(normalizeFilters(preset.filters));
      onClose();
    },
    [onApply, onClose]
  );

  const handleDeletePreset = useCallback(
    (preset: FilterPresetPublic) => {
      if (preset.is_default) return;
      deletePresetMutation.mutate(preset.id);
    },
    [deletePresetMutation]
  );

  const handleSetFavoritePreset = useCallback(
    (preset: FilterPresetPublic) => {
      if (preset.is_favorite || preset.is_default) return;
      setFavoritePresetMutation.mutate(preset.id);
    },
    [setFavoritePresetMutation]
  );

  const renderPreset: ListRenderItem<FilterPresetPublic> = useCallback(
    ({ item }) => {
      const normalizedItemFilters = normalizeFilters(item.filters);
      const isCurrent = serializeFilters(normalizedItemFilters) === activeFilterSignature;
      const details = getPresetDetails(scope, normalizedItemFilters);

      return (
        <View style={styles.presetCard}>
          <View style={styles.presetHeader}>
            <View style={styles.presetTitleWrap}>
              <ThemedText style={styles.presetName}>{item.name}</ThemedText>
              <View style={styles.presetBadges}>
                {item.is_default ? (
                  <View style={styles.badge}>
                    <ThemedText style={styles.badgeText}>Default</ThemedText>
                  </View>
                ) : null}
                {item.is_favorite ? (
                  <View style={[styles.badge, styles.favoriteBadge]}>
                    <ThemedText style={[styles.badgeText, styles.favoriteBadgeText]}>Favorite</ThemedText>
                  </View>
                ) : null}
                {isCurrent ? (
                  <View style={[styles.badge, styles.currentBadge]}>
                    <ThemedText style={[styles.badgeText, styles.currentBadgeText]}>Current</ThemedText>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          <View style={styles.presetDetails}>
            {details.map((detail) => (
              <View key={`${item.id}-${detail.key}`} style={styles.detailRow}>
                <ThemedText style={styles.detailLabel}>{detail.label}</ThemedText>
                <ThemedText style={styles.detailValue}>{detail.value}</ThemedText>
              </View>
            ))}
          </View>

          <View style={styles.presetActions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.applyButton]}
              onPress={() => handleApplyPreset(item)}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.actionText, styles.applyButtonText]}>Apply</ThemedText>
            </TouchableOpacity>
            {!item.is_default ? (
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  item.is_favorite ? styles.favoriteButtonActive : styles.favoriteButton,
                ]}
                onPress={() => handleSetFavoritePreset(item)}
                activeOpacity={0.8}
                disabled={item.is_favorite || setFavoritePresetMutation.isPending}
              >
                <ThemedText
                  style={[
                    styles.actionText,
                    item.is_favorite ? styles.favoriteButtonActiveText : styles.favoriteButtonText,
                  ]}
                >
                  {item.is_favorite
                    ? "Favorited"
                    : setFavoritePresetMutation.isPending
                      ? "Saving..."
                      : "Favorite"}
                </ThemedText>
              </TouchableOpacity>
            ) : null}
            {!item.is_default ? (
              <TouchableOpacity
                style={[styles.actionButton, styles.deleteButton]}
              onPress={() => handleDeletePreset(item)}
              activeOpacity={0.8}
              disabled={deletePresetMutation.isPending}
              >
                <ThemedText style={[styles.actionText, styles.deleteButtonText]}>
                  Delete
                </ThemedText>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      );
    },
    [
      activeFilterSignature,
      deletePresetMutation.isPending,
      handleApplyPreset,
      handleDeletePreset,
      handleSetFavoritePreset,
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
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <View>
            <ThemedText style={styles.title}>Filter Presets</ThemedText>
            <ThemedText style={styles.subtitle}>{getScopeLabel(scope)} page presets</ThemedText>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton} activeOpacity={0.8}>
            <ThemedText style={styles.closeButtonText}>Close</ThemedText>
          </TouchableOpacity>
        </View>

        <View style={styles.saveSection}>
          <View style={styles.saveRow}>
            <TextInput
              value={presetName}
              onChangeText={setPresetName}
              placeholder="Preset name"
              placeholderTextColor={colors.textSecondary}
              style={styles.input}
              maxLength={80}
              autoCapitalize="words"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={[
                styles.saveButton,
                (savePresetMutation.isPending || presetName.trim().length === 0) &&
                  styles.saveButtonDisabled,
              ]}
              onPress={handleSavePreset}
              activeOpacity={0.8}
              disabled={savePresetMutation.isPending || presetName.trim().length === 0}
            >
              <ThemedText style={styles.saveButtonText}>
                {savePresetMutation.isPending ? "Saving..." : "Save"}
              </ThemedText>
            </TouchableOpacity>
          </View>
          {saveError ? <ThemedText style={styles.errorText}>{saveError}</ThemedText> : null}
        </View>

        {isLoading ? (
          <View style={styles.loading}>
            <ActivityIndicator size="large" color={colors.tint} />
          </View>
        ) : (
          <FlatList
            data={presets}
            keyExtractor={(item) => item.id}
            renderItem={renderPreset}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
            ListEmptyComponent={
              <View style={styles.empty}>
                <ThemedText style={styles.emptyText}>
                  No presets yet. Save your current filters to create one.
                </ThemedText>
              </View>
            }
          />
        )}
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      paddingHorizontal: 16,
      paddingTop: Platform.OS === "ios" ? 22 : 14,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    title: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
    },
    subtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
    },
    closeButton: {
      borderRadius: 14,
      paddingHorizontal: 10,
      paddingVertical: 6,
      backgroundColor: colors.pillBackground,
    },
    closeButtonText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    saveSection: {
      paddingHorizontal: 16,
      paddingTop: 12,
      gap: 8,
    },
    saveRow: {
      flexDirection: "row",
      columnGap: 8,
    },
    input: {
      flex: 1,
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
    saveButton: {
      borderRadius: 12,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.tint,
    },
    saveButtonDisabled: {
      opacity: 0.5,
    },
    saveButtonText: {
      color: colors.pillActiveText,
      fontSize: 13,
      fontWeight: "700",
    },
    errorText: {
      fontSize: 12,
      color: colors.red.secondary,
    },
    loading: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    list: {
      flex: 1,
      marginTop: 10,
    },
    listContent: {
      paddingHorizontal: 16,
      paddingBottom: 20,
    },
    separator: {
      height: 10,
    },
    empty: {
      paddingVertical: 40,
      alignItems: "center",
      justifyContent: "center",
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: "center",
    },
    presetCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      padding: 12,
      gap: 10,
    },
    presetHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    presetTitleWrap: {
      flex: 1,
      gap: 6,
    },
    presetName: {
      fontSize: 15,
      fontWeight: "700",
      color: colors.text,
    },
    presetBadges: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    badge: {
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 3,
      backgroundColor: colors.pillBackground,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    currentBadge: {
      backgroundColor: colors.tint,
    },
    currentBadgeText: {
      color: colors.pillActiveText,
    },
    favoriteBadge: {
      backgroundColor: colors.yellow.primary,
    },
    favoriteBadgeText: {
      color: colors.yellow.secondary,
    },
    presetDetails: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 6,
    },
    detailRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      justifyContent: "space-between",
      columnGap: 8,
    },
    detailLabel: {
      minWidth: 64,
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
    },
    detailValue: {
      flex: 1,
      textAlign: "right",
      fontSize: 12,
      fontWeight: "600",
      color: colors.text,
    },
    presetActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    actionButton: {
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    applyButton: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    applyButtonText: {
      color: colors.pillActiveText,
    },
    deleteButton: {
      backgroundColor: colors.cardBackground,
      borderColor: colors.divider,
    },
    deleteButtonText: {
      color: colors.textSecondary,
    },
    favoriteButton: {
      backgroundColor: colors.cardBackground,
      borderColor: colors.divider,
    },
    favoriteButtonText: {
      color: colors.textSecondary,
    },
    favoriteButtonActive: {
      backgroundColor: colors.yellow.primary,
      borderColor: colors.yellow.secondary,
    },
    favoriteButtonActiveText: {
      color: colors.yellow.secondary,
    },
    actionText: {
      fontSize: 12,
      fontWeight: "700",
    },
  });
