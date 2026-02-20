/**
 * Mobile filter UI component: Cinema Filter Modal.
 */
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  type ListRenderItem,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SafeAreaView } from "react-native-safe-area-context";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MeService,
  type CinemaPresetCreate,
  type CinemaPresetPublic,
  type CinemaPublic,
  type CityPublic,
} from "shared";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type CinemaFilterModalProps = {
  visible: boolean;
  onClose: () => void;
};

type CityGroup = {
  city: CityPublic;
  cinemas: CinemaPublic[];
};

type CinemaSection = {
  key: string;
  title: string;
  meta?: string;
  cinemas: CinemaPublic[];
  cityId?: number;
  showCity?: boolean;
};

type CinemaColorKey =
  | "pink"
  | "purple"
  | "green"
  | "orange"
  | "yellow"
  | "blue"
  | "teal"
  | "red"
  | "cyan";

type CinemaColorPalette = {
  primary: string;
  secondary: string;
};

type CinemaModalPage = "selection" | "presets";

const GROUPING_MINIMUM = 3;

function groupCinemas(cinemas: CinemaPublic[]) {
  const groupedByCity = new Map<number, CityGroup>();

  cinemas.forEach((cinema) => {
    const existing = groupedByCity.get(cinema.city.id);
    if (existing) {
      existing.cinemas.push(cinema);
      return;
    }
    groupedByCity.set(cinema.city.id, {
      city: cinema.city,
      cinemas: [cinema],
    });
  });

  const sortedGroups = Array.from(groupedByCity.values()).sort((a, b) =>
    a.city.name.localeCompare(b.city.name)
  );

  sortedGroups.forEach((group) => {
    group.cinemas.sort((a, b) => a.name.localeCompare(b.name));
  });

  const groupedCities: CityGroup[] = [];
  const ungrouped: CinemaPublic[] = [];

  // Only larger cities get a dedicated group; small city lists are merged into "Other cinemas".
  sortedGroups.forEach((group) => {
    if (group.cinemas.length >= GROUPING_MINIMUM) {
      groupedCities.push(group);
    } else {
      ungrouped.push(...group.cinemas);
    }
  });

  ungrouped.sort((a, b) => {
    const cityCompare = a.city.name.localeCompare(b.city.name);
    if (cityCompare !== 0) return cityCompare;
    return a.name.localeCompare(b.name);
  });

  return { groupedCities, ungrouped };
}

const sortCinemaIds = (cinemaIds: Iterable<number>) => Array.from(new Set(cinemaIds)).sort((a, b) => a - b);
const serializeCinemaIds = (cinemaIds: Iterable<number>) => JSON.stringify(sortCinemaIds(cinemaIds));

const setsMatch = (left: Set<number>, right: Set<number>) => {
  if (left.size !== right.size) return false;
  for (const id of left) {
    if (!right.has(id)) return false;
  }
  return true;
};

type CinemaRowChipProps = {
  cinema: CinemaPublic;
  showCity: boolean;
  selected: boolean;
  accentColor: string;
  checkColor: string;
  styles: ReturnType<typeof createStyles>;
  onToggle: (cinemaId: number) => void;
};

const CinemaRowChip = memo(function CinemaRowChip({
  cinema,
  showCity,
  selected,
  accentColor,
  checkColor,
  styles,
  onToggle,
}: CinemaRowChipProps) {
  return (
    <TouchableOpacity
      style={[styles.cinemaRow, selected && styles.cinemaRowSelected]}
      onPressIn={() => onToggle(cinema.id)}
      activeOpacity={0.8}
    >
      <View style={styles.cinemaInfo}>
        <View style={styles.cinemaNameRow}>
          <ThemedText numberOfLines={1} style={styles.cinemaName}>
            {cinema.name}
          </ThemedText>
        </View>
        {showCity ? (
          <ThemedText numberOfLines={1} style={styles.cinemaCity}>
            {cinema.city.name}
          </ThemedText>
        ) : null}
      </View>
      <View
        style={[
          styles.checkbox,
          selected && { borderColor: accentColor, backgroundColor: accentColor },
        ]}
      >
        {selected ? <MaterialIcons name="check" size={11} color={checkColor} /> : null}
      </View>
    </TouchableOpacity>
  );
});

const getCinemaPalette = (
  colors: typeof import("@/constants/theme").Colors.light,
  cinema: CinemaPublic
) => {
  const cinemaColorKey = cinema.badge_bg_color as CinemaColorKey;
  const cinemaPalette = (colors as Record<CinemaColorKey, CinemaColorPalette>)[cinemaColorKey];
  return {
    accentColor: cinemaPalette?.secondary ?? colors.textSecondary,
  };
};

export default function CinemaFilterModal({ visible, onClose }: CinemaFilterModalProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  const [page, setPage] = useState<CinemaModalPage>("selection");
  const [presetName, setPresetName] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);

  // Data hooks keep this module synced with backend data and shared cache state.
  const { data: cinemas } = useFetchCinemas();
  const { data: favoriteCinemaIds } = useFetchSelectedCinemas();
  const { selections: sessionCinemaIds, setSelections: setSessionCinemaIds } =
    useSessionCinemaSelections();

  const selectedCinemas = useMemo(
    () => sessionCinemaIds ?? favoriteCinemaIds ?? [],
    [sessionCinemaIds, favoriteCinemaIds]
  );
  const [localSelectedCinemaSet, setLocalSelectedCinemaSet] = useState<Set<number>>(
    () => new Set(selectedCinemas)
  );
  const selectedCinemaSet = useMemo(() => new Set(selectedCinemas), [selectedCinemas]);
  const favoriteCinemaSet = useMemo(() => new Set(favoriteCinemaIds ?? []), [favoriteCinemaIds]);

  // Keep modal interactions local for instant UI feedback; commit to shared state on close.
  useEffect(() => {
    if (!visible) return;
    setLocalSelectedCinemaSet(new Set(selectedCinemas));
    setPresetError(null);
    setPresetName("");
    setPage("selection");
  }, [visible, selectedCinemas]);

  const presetsQueryKey = useMemo(() => ["cinema-presets"] as const, []);
  const { data: presets = [], isLoading: isPresetsLoading } = useQuery({
    queryKey: presetsQueryKey,
    enabled: visible,
    queryFn: () => MeService.getCinemaPresets(),
  });

  const savePresetMutation = useMutation({
    mutationFn: (requestBody: CinemaPresetCreate) => MeService.saveCinemaPreset({ requestBody }),
    onSuccess: () => {
      setPresetError(null);
      setPresetName("");
      queryClient.invalidateQueries({ queryKey: presetsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["user", "cinema_selections"] });
    },
    onError: () => {
      setPresetError("Could not save cinema preset. Please try again.");
    },
  });

  const deletePresetMutation = useMutation({
    mutationFn: (presetId: string) => MeService.deleteCinemaPreset({ presetId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: presetsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["user", "cinema_selections"] });
    },
  });

  const setFavoritePresetMutation = useMutation({
    mutationFn: (presetId: string) => MeService.setFavoriteCinemaPreset({ presetId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: presetsQueryKey });
      queryClient.invalidateQueries({ queryKey: ["user", "cinema_selections"] });
    },
  });

  const selectedCount = localSelectedCinemaSet.size;
  const hasFavoriteSelection = favoriteCinemaIds !== undefined;
  const selectionMatchesFavorite = hasFavoriteSelection
    ? setsMatch(localSelectedCinemaSet, favoriteCinemaSet)
    : true;
  const favoriteStatus = hasFavoriteSelection
    ? selectionMatchesFavorite
      ? "Matches your favorite cinema preset."
      : "Different from your favorite cinema preset."
    : "No favorite cinema preset selected.";
  const canUseFavorite = hasFavoriteSelection && !selectionMatchesFavorite;

  const currentSelectionSignature = useMemo(
    () => serializeCinemaIds(localSelectedCinemaSet),
    [localSelectedCinemaSet]
  );

  const cinemaList = useMemo(() => cinemas ?? [], [cinemas]);

  const { groupedCities, ungrouped } = useMemo(() => groupCinemas(cinemaList), [cinemaList]);

  const cinemaSections = useMemo<CinemaSection[]>(
    () => [
      ...groupedCities.map((group) => ({
        key: `city-${group.city.id}`,
        title: group.city.name,
        meta: `${group.cinemas.length} cinemas`,
        cinemas: group.cinemas,
        cityId: group.city.id,
      })),
      ...(ungrouped.length > 0
        ? [
            {
              key: "other-cinemas",
              title: "Other cinemas",
              cinemas: ungrouped,
              showCity: true,
            },
          ]
        : []),
    ],
    [groupedCities, ungrouped]
  );

  // Collect all cinema IDs for bulk select/deselect actions.
  const allCinemaIds = useMemo(() => cinemaList.map((cinema) => cinema.id), [cinemaList]);
  const allSelected =
    allCinemaIds.length > 0 && allCinemaIds.every((id) => localSelectedCinemaSet.has(id));

  const accentColorByCinemaId = useMemo(
    () =>
      new Map(
        cinemaList.map((cinema) => [cinema.id, getCinemaPalette(colors, cinema).accentColor] as const)
      ),
    [cinemaList, colors]
  );

  // Toggle a single cinema in this modal session.
  const handleToggle = useCallback((cinemaId: number) => {
    setLocalSelectedCinemaSet((current) => {
      const next = new Set(current);
      if (next.has(cinemaId)) {
        next.delete(cinemaId);
      } else {
        next.add(cinemaId);
      }
      return next;
    });
  }, []);

  // Toggle every cinema inside one city section.
  const handleToggleCity = useCallback(
    (cityId: number) => {
      const cityCinemas = groupedCities.find((group) => group.city.id === cityId)?.cinemas || [];
      if (cityCinemas.length === 0) return;
      setLocalSelectedCinemaSet((current) => {
        const next = new Set(current);
        const cityCinemaIds = cityCinemas.map((cinema) => cinema.id);
        const isAllSelected = cityCinemaIds.every((id) => next.has(id));
        if (isAllSelected) {
          cityCinemaIds.forEach((id) => next.delete(id));
        } else {
          cityCinemaIds.forEach((id) => next.add(id));
        }
        return next;
      });
    },
    [groupedCities]
  );

  // Toggle the entire list in one action.
  const handleToggleAll = useCallback(() => {
    setLocalSelectedCinemaSet((current) => {
      const isAllSelected = allCinemaIds.length > 0 && allCinemaIds.every((id) => current.has(id));
      if (isAllSelected) return new Set<number>();
      return new Set(allCinemaIds);
    });
  }, [allCinemaIds]);

  const handleUseFavorite = useCallback(() => {
    if (favoriteCinemaIds === undefined) return;
    setLocalSelectedCinemaSet(new Set(favoriteCinemaIds));
  }, [favoriteCinemaIds]);

  const handleClose = useCallback(() => {
    if (!setsMatch(localSelectedCinemaSet, selectedCinemaSet)) {
      setSessionCinemaIds(sortCinemaIds(localSelectedCinemaSet));
    }
    onClose();
  }, [localSelectedCinemaSet, onClose, selectedCinemaSet, setSessionCinemaIds]);

  const handleSavePreset = useCallback(() => {
    const trimmed = presetName.trim();
    if (!trimmed) {
      setPresetError("Enter a preset name.");
      return;
    }

    savePresetMutation.mutate({
      name: trimmed,
      cinema_ids: sortCinemaIds(localSelectedCinemaSet),
    });
  }, [localSelectedCinemaSet, presetName, savePresetMutation]);

  const handleApplyPreset = useCallback((preset: CinemaPresetPublic) => {
    setLocalSelectedCinemaSet(new Set(preset.cinema_ids));
    setPage("selection");
  }, []);

  const handleDeletePreset = useCallback(
    (preset: CinemaPresetPublic) => {
      deletePresetMutation.mutate(preset.id);
    },
    [deletePresetMutation]
  );

  const handleSetFavoritePreset = useCallback(
    (preset: CinemaPresetPublic) => {
      if (preset.is_favorite) return;
      setFavoritePresetMutation.mutate(preset.id);
    },
    [setFavoritePresetMutation]
  );

  const renderCinemaSection: ListRenderItem<CinemaSection> = useCallback(
    ({ item }) => {
      const citySelected =
        item.cityId !== undefined &&
        item.cinemas.length > 0 &&
        item.cinemas.every((cinema) => localSelectedCinemaSet.has(cinema.id));

      return (
        <View style={styles.sectionCard}>
          <View style={styles.sectionHeader}>
            <View>
              <ThemedText style={styles.cityTitle}>{item.title}</ThemedText>
              {item.meta ? <ThemedText style={styles.sectionMeta}>{item.meta}</ThemedText> : null}
            </View>
            {item.cityId !== undefined ? (
              <TouchableOpacity
                style={styles.toggleButton}
                onPress={() => handleToggleCity(item.cityId!)}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.toggleButtonText}>
                  {citySelected ? "Deselect all" : "Select all"}
                </ThemedText>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.cinemaList}>
            {item.cinemas.map((cinema) => (
              <CinemaRowChip
                key={cinema.id}
                cinema={cinema}
                showCity={item.showCity === true}
                selected={localSelectedCinemaSet.has(cinema.id)}
                accentColor={accentColorByCinemaId.get(cinema.id) ?? colors.textSecondary}
                checkColor={colors.pillActiveText}
                styles={styles}
                onToggle={handleToggle}
              />
            ))}
          </View>
        </View>
      );
    },
    [
      accentColorByCinemaId,
      colors.pillActiveText,
      colors.textSecondary,
      handleToggle,
      handleToggleCity,
      localSelectedCinemaSet,
      styles,
    ]
  );

  const renderPreset: ListRenderItem<CinemaPresetPublic> = useCallback(
    ({ item }) => {
      const isCurrent = serializeCinemaIds(item.cinema_ids) === currentSelectionSignature;

      return (
        <View style={styles.presetCard}>
          <View style={styles.presetHeader}>
            <View style={styles.presetTitleWrap}>
              <ThemedText style={styles.presetName}>{item.name}</ThemedText>
              <ThemedText style={styles.presetMeta}>
                {item.cinema_ids.length} cinema{item.cinema_ids.length === 1 ? "" : "s"}
              </ThemedText>
            </View>
            <View style={styles.presetBadges}>
              {item.is_favorite ? (
                <View style={[styles.presetBadge, styles.favoriteBadge]}>
                  <ThemedText style={[styles.presetBadgeText, styles.favoriteBadgeText]}>
                    Favorite
                  </ThemedText>
                </View>
              ) : null}
              {isCurrent ? (
                <View style={[styles.presetBadge, styles.currentBadge]}>
                  <ThemedText style={[styles.presetBadgeText, styles.currentBadgeText]}>Current</ThemedText>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.presetActions}>
            <TouchableOpacity
              style={[styles.actionButton, styles.applyButton]}
              onPress={() => handleApplyPreset(item)}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.actionButtonText, styles.applyButtonText]}>Apply</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.actionButton,
                item.is_favorite ? styles.favoriteActionButtonActive : styles.favoriteActionButton,
              ]}
              onPress={() => handleSetFavoritePreset(item)}
              activeOpacity={0.8}
              disabled={item.is_favorite || setFavoritePresetMutation.isPending}
            >
              <ThemedText
                style={[
                  styles.actionButtonText,
                  item.is_favorite ? styles.favoriteActionButtonTextActive : styles.favoriteActionButtonText,
                ]}
              >
                {item.is_favorite
                  ? "Favorited"
                  : setFavoritePresetMutation.isPending
                    ? "Saving..."
                    : "Favorite"}
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, styles.deleteButton]}
              onPress={() => handleDeletePreset(item)}
              activeOpacity={0.8}
              disabled={deletePresetMutation.isPending}
            >
              <ThemedText style={[styles.actionButtonText, styles.deleteButtonText]}>
                {deletePresetMutation.isPending ? "Deleting..." : "Delete"}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      );
    },
    [
      currentSelectionSignature,
      deletePresetMutation.isPending,
      handleApplyPreset,
      handleDeletePreset,
      handleSetFavoritePreset,
      setFavoritePresetMutation.isPending,
      styles,
    ]
  );

  const isLoadingSelection =
    cinemas === undefined || (sessionCinemaIds === undefined && favoriteCinemaIds === undefined);

  // Render/output using the state and derived values prepared above.
  return (
    <Modal
      animationType="slide"
      visible={visible}
      onRequestClose={handleClose}
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.modalContainer} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <ThemedText style={styles.title}>Cinemas</ThemedText>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton} activeOpacity={0.8}>
            <ThemedText style={styles.closeButtonText}>Close</ThemedText>
          </TouchableOpacity>
        </View>

        <View style={styles.pageSwitcher}>
          <TouchableOpacity
            style={[styles.pageButton, page === "selection" && styles.pageButtonActive]}
            onPress={() => setPage("selection")}
            activeOpacity={0.8}
          >
            <ThemedText
              style={[styles.pageButtonText, page === "selection" && styles.pageButtonTextActive]}
            >
              Selection
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pageButton, page === "presets" && styles.pageButtonActive]}
            onPress={() => setPage("presets")}
            activeOpacity={0.8}
          >
            <ThemedText
              style={[styles.pageButtonText, page === "presets" && styles.pageButtonTextActive]}
            >
              Presets
            </ThemedText>
          </TouchableOpacity>
        </View>

        {page === "selection" ? (
          isLoadingSelection ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.tint} />
              <ThemedText style={styles.loadingText}>Loading cinemas...</ThemedText>
            </View>
          ) : (
            <FlatList
              style={styles.mainContent}
              contentContainerStyle={styles.content}
              data={cinemaSections}
              keyExtractor={(item) => item.key}
              renderItem={renderCinemaSection}
              initialNumToRender={2}
              maxToRenderPerBatch={2}
              windowSize={5}
              removeClippedSubviews
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <View style={styles.sectionCard}>
                  <View style={styles.sectionHeader}>
                    <View>
                      <ThemedText style={styles.sectionTitle}>All cinemas</ThemedText>
                      <ThemedText style={styles.sectionMeta}>
                        {selectedCount} of {allCinemaIds.length} selected
                      </ThemedText>
                    </View>
                    <TouchableOpacity
                      style={styles.toggleButton}
                      onPress={handleToggleAll}
                      activeOpacity={0.8}
                    >
                      <ThemedText style={styles.toggleButtonText}>
                        {allSelected ? "Deselect all" : "Select all"}
                      </ThemedText>
                    </TouchableOpacity>
                  </View>
                </View>
              }
              ItemSeparatorComponent={() => <View style={styles.sectionSeparator} />}
            />
          )
        ) : (
          <View style={styles.presetsContainer}>
            <View style={styles.savePresetSection}>
              <View style={styles.savePresetRow}>
                <TextInput
                  value={presetName}
                  onChangeText={setPresetName}
                  placeholder="Cinema preset name"
                  placeholderTextColor={colors.textSecondary}
                  style={styles.presetInput}
                  maxLength={80}
                  autoCapitalize="words"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={[
                    styles.savePresetButton,
                    (savePresetMutation.isPending || presetName.trim().length === 0) &&
                      styles.savePresetButtonDisabled,
                  ]}
                  onPress={handleSavePreset}
                  activeOpacity={0.8}
                  disabled={savePresetMutation.isPending || presetName.trim().length === 0}
                >
                  <ThemedText style={styles.savePresetButtonText}>
                    {savePresetMutation.isPending ? "Saving..." : "Save"}
                  </ThemedText>
                </TouchableOpacity>
              </View>
              {presetError ? <ThemedText style={styles.presetErrorText}>{presetError}</ThemedText> : null}
            </View>

            {isPresetsLoading ? (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={colors.tint} />
                <ThemedText style={styles.loadingText}>Loading presets...</ThemedText>
              </View>
            ) : (
              <FlatList
                data={presets}
                keyExtractor={(item) => item.id}
                renderItem={renderPreset}
                style={styles.mainContent}
                contentContainerStyle={styles.content}
                ItemSeparatorComponent={() => <View style={styles.sectionSeparator} />}
                ListEmptyComponent={
                  <View style={styles.emptyPresets}>
                    <ThemedText style={styles.emptyPresetsText}>
                      No cinema presets yet. Save your current cinema selection.
                    </ThemedText>
                  </View>
                }
              />
            )}
          </View>
        )}

        <View style={styles.preferenceFooter}>
          {page === "selection" ? (
            <>
              <View style={styles.preferenceText}>
                <ThemedText style={styles.preferenceTitle}>Session selection</ThemedText>
                <ThemedText style={styles.preferenceSubtitle}>{favoriteStatus}</ThemedText>
              </View>
              <View style={styles.preferenceActions}>
                <TouchableOpacity
                  style={[
                    styles.preferenceButton,
                    styles.preferenceButtonPrimary,
                    !canUseFavorite && styles.preferenceButtonDisabled,
                  ]}
                  onPress={handleUseFavorite}
                  activeOpacity={0.8}
                  disabled={!canUseFavorite}
                >
                  <View style={styles.preferenceButtonInner}>
                    <MaterialIcons
                      name="history"
                      size={16}
                      color={canUseFavorite ? colors.pillActiveText : colors.textSecondary}
                    />
                    <ThemedText
                      style={[
                        styles.preferenceButtonText,
                        styles.preferenceButtonTextPrimary,
                        !canUseFavorite && styles.preferenceButtonTextDisabled,
                      ]}
                    >
                      Use favorite
                    </ThemedText>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.preferenceButton, styles.preferenceButtonSubtle]}
                  onPress={() => setPage("presets")}
                  activeOpacity={0.8}
                >
                  <View style={styles.preferenceButtonInner}>
                    <MaterialIcons name="bookmark-border" size={16} color={colors.textSecondary} />
                    <ThemedText style={[styles.preferenceButtonText, styles.preferenceButtonTextSubtle]}>
                      Presets
                    </ThemedText>
                  </View>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <View style={styles.preferenceActions}>
              <TouchableOpacity
                style={[styles.preferenceButton, styles.preferenceButtonSubtle]}
                onPress={() => setPage("selection")}
                activeOpacity={0.8}
              >
                <View style={styles.preferenceButtonInner}>
                  <MaterialIcons name="arrow-back" size={16} color={colors.textSecondary} />
                  <ThemedText style={[styles.preferenceButtonText, styles.preferenceButtonTextSubtle]}>
                    Back to selection
                  </ThemedText>
                </View>
              </TouchableOpacity>
            </View>
          )}
        </View>
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
      paddingVertical: 12,
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
    pageSwitcher: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      flexDirection: "row",
      gap: 8,
    },
    pageButton: {
      flex: 1,
      minHeight: 38,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    pageButtonActive: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    pageButtonText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    pageButtonTextActive: {
      color: colors.pillActiveText,
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
    sectionCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      padding: 12,
    },
    sectionMeta: {
      fontSize: 12,
      color: colors.textSecondary,
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
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "700",
    },
    cityTitle: {
      fontSize: 15,
      fontWeight: "700",
    },
    toggleButton: {
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    toggleButtonText: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    cinemaList: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
      marginTop: 8,
    },
    cinemaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-start",
      alignSelf: "flex-start",
      maxWidth: "100%",
      columnGap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
    },
    cinemaRowSelected: {
      backgroundColor: colors.pillBackground,
    },
    cinemaInfo: {
      flexShrink: 1,
      gap: 2,
    },
    cinemaNameRow: {
      flexDirection: "row",
      alignItems: "center",
    },
    cinemaName: {
      fontSize: 14,
      fontWeight: "600",
    },
    cinemaCity: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    checkbox: {
      width: 16,
      height: 16,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: colors.divider,
      backgroundColor: "transparent",
      alignItems: "center",
      justifyContent: "center",
    },
    presetsContainer: {
      flex: 1,
    },
    savePresetSection: {
      paddingHorizontal: 16,
      paddingTop: 12,
      gap: 8,
    },
    savePresetRow: {
      flexDirection: "row",
      columnGap: 8,
    },
    presetInput: {
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
    savePresetButton: {
      borderRadius: 12,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.tint,
    },
    savePresetButtonDisabled: {
      opacity: 0.5,
    },
    savePresetButtonText: {
      color: colors.pillActiveText,
      fontSize: 13,
      fontWeight: "700",
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
    presetHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 8,
    },
    presetTitleWrap: {
      flex: 1,
      gap: 3,
    },
    presetName: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
    },
    presetMeta: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    presetBadges: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    presetBadge: {
      borderRadius: 10,
      paddingHorizontal: 8,
      paddingVertical: 3,
      backgroundColor: colors.pillBackground,
    },
    presetBadgeText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    favoriteBadge: {
      backgroundColor: colors.yellow.primary,
    },
    favoriteBadgeText: {
      color: colors.yellow.secondary,
    },
    currentBadge: {
      backgroundColor: colors.tint,
    },
    currentBadgeText: {
      color: colors.pillActiveText,
    },
    presetActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    actionButton: {
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    actionButtonText: {
      fontSize: 12,
      fontWeight: "700",
    },
    applyButton: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    applyButtonText: {
      color: colors.pillActiveText,
    },
    favoriteActionButton: {
      backgroundColor: colors.cardBackground,
      borderColor: colors.divider,
    },
    favoriteActionButtonText: {
      color: colors.textSecondary,
    },
    favoriteActionButtonActive: {
      backgroundColor: colors.yellow.primary,
      borderColor: colors.yellow.secondary,
    },
    favoriteActionButtonTextActive: {
      color: colors.yellow.secondary,
    },
    deleteButton: {
      backgroundColor: colors.cardBackground,
      borderColor: colors.divider,
    },
    deleteButtonText: {
      color: colors.textSecondary,
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
    preferenceButtonPrimary: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
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
    preferenceButtonTextPrimary: {
      color: colors.pillActiveText,
    },
    preferenceButtonTextSubtle: {
      color: colors.textSecondary,
    },
    preferenceButtonTextDisabled: {
      color: colors.textSecondary,
    },
  });
