/**
 * Mobile filter UI component: Cinema Filter Modal.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
  loadCinemaPresetOrder,
  sanitizeCinemaPresetOrderIds,
  saveCinemaPresetOrder,
  sortCinemaPresetsByOrder,
} from "@/components/filters/cinema-preset-order";
import { useThemeColors } from "@/hooks/use-theme-color";

type CinemaFilterModalProps = {
  visible: boolean;
  onClose: () => void;
  initialPage?: CinemaModalPage;
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

type CinemaColorKey = "pink" | "purple" | "green" | "orange" | "yellow" | "blue" | "teal" | "red" | "cyan";
type CinemaColorPalette = { primary: string; secondary: string };
type CinemaModalPage = "selection" | "presets";

const GROUPING_MINIMUM = 3;

function groupCinemas(cinemas: CinemaPublic[]) {
  const groupedByCity = new Map<number, CityGroup>();
  cinemas.forEach((cinema) => {
    const existing = groupedByCity.get(cinema.city.id);
    if (existing) { existing.cinemas.push(cinema); return; }
    groupedByCity.set(cinema.city.id, { city: cinema.city, cinemas: [cinema] });
  });
  const sortedGroups = Array.from(groupedByCity.values()).sort((a, b) => a.city.name.localeCompare(b.city.name));
  sortedGroups.forEach((group) => { group.cinemas.sort((a, b) => a.name.localeCompare(b.name)); });
  const groupedCities: CityGroup[] = [];
  const ungrouped: CinemaPublic[] = [];
  sortedGroups.forEach((group) => {
    if (group.cinemas.length >= GROUPING_MINIMUM) { groupedCities.push(group); }
    else { ungrouped.push(...group.cinemas); }
  });
  ungrouped.sort((a, b) => {
    const cityCompare = a.city.name.localeCompare(b.city.name);
    if (cityCompare !== 0) return cityCompare;
    return a.name.localeCompare(b.name);
  });
  return { groupedCities, ungrouped };
}

const sortCinemaIds = (cinemaIds: Iterable<number>) =>
  Array.from(new Set(cinemaIds)).sort((a, b) => a - b);

const serializeCinemaIds = (cinemaIds: Iterable<number>) =>
  JSON.stringify(sortCinemaIds(cinemaIds));

const setsMatch = (left: Set<number>, right: Set<number>) => {
  if (left.size !== right.size) return false;
  for (const id of left) { if (!right.has(id)) return false; }
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
  cinema, showCity, selected, accentColor, checkColor, styles, onToggle,
}: CinemaRowChipProps) {
  return (
    <TouchableOpacity
      style={[styles.cinemaRow, selected && styles.cinemaRowSelected]}
      onPress={() => onToggle(cinema.id)}
      activeOpacity={0.8}
    >
      <View style={styles.cinemaInfo}>
        <View style={styles.cinemaNameRow}>
          <ThemedText numberOfLines={1} style={styles.cinemaName}>{cinema.name}</ThemedText>
        </View>
        {showCity ? <ThemedText numberOfLines={1} style={styles.cinemaCity}>{cinema.city.name}</ThemedText> : null}
      </View>
      <View style={[styles.checkbox, selected && { borderColor: accentColor, backgroundColor: accentColor }]}>
        {selected ? <MaterialIcons name="check" size={11} color={checkColor} /> : null}
      </View>
    </TouchableOpacity>
  );
});

const getCinemaPalette = (
  colors: typeof import("@/constants/theme").Colors.light,
  cinema: CinemaPublic,
) => {
  const cinemaColorKey = cinema.badge_bg_color as CinemaColorKey;
  const cinemaPalette = (colors as Record<CinemaColorKey, CinemaColorPalette>)[cinemaColorKey];
  return { accentColor: cinemaPalette?.secondary ?? colors.textSecondary };
};

export default function CinemaFilterModal({ visible, onClose, initialPage = "selection" }: CinemaFilterModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();

  const bottomSheetModalRef = useRef<BottomSheetModal>(null);
  const hasEverPresentedRef = useRef(false);
  const closedByGorhomRef = useRef(false);
  const snapPoints = useMemo(() => ["88%"], []);

  const [page, setPage] = useState<CinemaModalPage>("selection");
  const [presetName, setPresetName] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);
  const [isSavePresetDialogVisible, setIsSavePresetDialogVisible] = useState(false);
  const [saveAsFavorite, setSaveAsFavorite] = useState(false);
  const [presetOrderIds, setPresetOrderIds] = useState<readonly string[]>([]);

  const { data: cinemas } = useFetchCinemas();
  const { data: favoriteCinemaIds } = useFetchSelectedCinemas();
  const { selections: sessionCinemaIds, setSelections: setSessionCinemaIds } = useSessionCinemaSelections();

  const selectedCinemas = useMemo(
    () => sessionCinemaIds ?? favoriteCinemaIds ?? [],
    [sessionCinemaIds, favoriteCinemaIds],
  );
  const [localSelectedCinemaSet, setLocalSelectedCinemaSet] = useState<Set<number>>(
    () => new Set(selectedCinemas),
  );
  const selectedCinemaSet = useMemo(() => new Set(selectedCinemas), [selectedCinemas]);

  // Refs so handleSheetChange can commit the latest selection without stale closure.
  const localSelectedCinemaSetRef = useRef(localSelectedCinemaSet);
  useEffect(() => { localSelectedCinemaSetRef.current = localSelectedCinemaSet; }, [localSelectedCinemaSet]);
  const selectedCinemaSetRef = useRef(selectedCinemaSet);
  useEffect(() => { selectedCinemaSetRef.current = selectedCinemaSet; }, [selectedCinemaSet]);

  const handleSheetChange = useCallback((index: number) => {
    if (index === -1) {
      closedByGorhomRef.current = true;
      const current = localSelectedCinemaSetRef.current;
      const preferred = selectedCinemaSetRef.current;
      if (!setsMatch(current, preferred)) {
        setSessionCinemaIds(sortCinemaIds(current));
      }
      onClose();
    }
  }, [onClose, setSessionCinemaIds]);

  // Drive the gorhom sheet imperatively from the controlled `visible` prop.
  useEffect(() => {
    if (visible) {
      hasEverPresentedRef.current = true;
      closedByGorhomRef.current = false;
      bottomSheetModalRef.current?.present();
    } else if (hasEverPresentedRef.current && !closedByGorhomRef.current) {
      bottomSheetModalRef.current?.close();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    setLocalSelectedCinemaSet(new Set(selectedCinemas));
    setPresetError(null);
    setPresetName("");
    setIsSavePresetDialogVisible(false);
    setSaveAsFavorite(false);
    setPage(initialPage);
  }, [visible, selectedCinemas]);

  const presetsQueryKey = useMemo(() => ["cinema-presets"] as const, []);
  const { data: presets = [], isLoading: isPresetsLoading } = useQuery({
    queryKey: presetsQueryKey,
    enabled: visible,
    queryFn: () => MeService.getCinemaPresets(),
  });

  useEffect(() => {
    if (!visible) return;
    let isMounted = true;
    loadCinemaPresetOrder().then((orderedIds) => {
      if (!isMounted) return;
      setPresetOrderIds(orderedIds);
    });
    return () => { isMounted = false; };
  }, [visible]);

  const savePresetMutation = useMutation({
    mutationFn: (requestBody: CinemaPresetCreate) => MeService.createCinemaPreset({ requestBody }),
    onSuccess: () => {
      setPresetError(null);
      setPresetName("");
      setSaveAsFavorite(false);
      setIsSavePresetDialogVisible(false);
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

  const orderedPresets = useMemo(
    () => sortCinemaPresetsByOrder(presets, presetOrderIds),
    [presetOrderIds, presets],
  );
  const presetsForRender = useMemo(
    () => (orderedPresets.length > 0 || presets.length === 0 ? orderedPresets : presets),
    [orderedPresets, presets],
  );

  useEffect(() => {
    if (presetOrderIds.length === 0 || presets.length === 0) return;
    const presetIdSet = new Set(presets.map((p) => p.id));
    const trimmedOrder = presetOrderIds.filter((id) => presetIdSet.has(id));
    if (trimmedOrder.length === presetOrderIds.length) return;
    const normalizedOrder = sanitizeCinemaPresetOrderIds(trimmedOrder);
    setPresetOrderIds(normalizedOrder);
    saveCinemaPresetOrder(normalizedOrder).catch(() => undefined);
  }, [presetOrderIds, presets]);

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
        ? [{ key: "other-cinemas", title: "Other cinemas", cinemas: ungrouped, showCity: true }]
        : []),
    ],
    [groupedCities, ungrouped],
  );

  const allCinemaIds = useMemo(() => cinemaList.map((c) => c.id), [cinemaList]);
  const allSelected = allCinemaIds.length > 0 && allCinemaIds.every((id) => localSelectedCinemaSet.has(id));
  const selectedCount = localSelectedCinemaSet.size;
  const currentSelectionSignature = useMemo(
    () => serializeCinemaIds(localSelectedCinemaSet),
    [localSelectedCinemaSet],
  );
  const selectionMatchesPreset = useMemo(
    () => presets.some((p) => serializeCinemaIds(p.cinema_ids) === currentSelectionSignature),
    [currentSelectionSignature, presets],
  );

  const accentColorByCinemaId = useMemo(
    () => new Map(cinemaList.map((c) => [c.id, getCinemaPalette(colors, c).accentColor] as const)),
    [cinemaList, colors],
  );

  const handleToggle = useCallback((cinemaId: number) => {
    setLocalSelectedCinemaSet((current) => {
      const next = new Set(current);
      if (next.has(cinemaId)) { next.delete(cinemaId); } else { next.add(cinemaId); }
      return next;
    });
  }, []);

  const handleToggleCity = useCallback((cityId: number) => {
    const cityCinemas = groupedCities.find((g) => g.city.id === cityId)?.cinemas ?? [];
    if (cityCinemas.length === 0) return;
    setLocalSelectedCinemaSet((current) => {
      const next = new Set(current);
      const ids = cityCinemas.map((c) => c.id);
      const isAllSelected = ids.every((id) => next.has(id));
      if (isAllSelected) { ids.forEach((id) => next.delete(id)); }
      else { ids.forEach((id) => next.add(id)); }
      return next;
    });
  }, [groupedCities]);

  const handleToggleAll = useCallback(() => {
    setLocalSelectedCinemaSet((current) => {
      const isAllSelected = allCinemaIds.length > 0 && allCinemaIds.every((id) => current.has(id));
      if (isAllSelected) return new Set<number>();
      return new Set(allCinemaIds);
    });
  }, [allCinemaIds]);

  const handleApplyPreset = useCallback((preset: CinemaPresetPublic) => {
    setLocalSelectedCinemaSet(new Set(preset.cinema_ids));
  }, []);

  const handleDeletePreset = useCallback((preset: CinemaPresetPublic) => {
    Alert.alert(
      "Delete preset?",
      `Are you sure you want to delete "${preset.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deletePresetMutation.mutate(preset.id) },
      ],
      { cancelable: true },
    );
  }, [deletePresetMutation]);

  const handleSetFavoritePreset = useCallback((preset: CinemaPresetPublic) => {
    if (preset.is_favorite) return;
    setFavoritePresetMutation.mutate(preset.id);
  }, [setFavoritePresetMutation]);

  const persistPresetOrder = useCallback((orderedIds: readonly string[]) => {
    const normalizedOrder = sanitizeCinemaPresetOrderIds(orderedIds);
    setPresetOrderIds(normalizedOrder);
    saveCinemaPresetOrder(normalizedOrder).catch(() => undefined);
  }, []);

  const handleMovePreset = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex || toIndex >= presetsForRender.length) return;
    const reordered = [...presetsForRender];
    const [moved] = reordered.splice(fromIndex, 1);
    if (!moved) return;
    reordered.splice(toIndex, 0, moved);
    persistPresetOrder(reordered.map((p) => p.id));
  }, [persistPresetOrder, presetsForRender]);

  const handleSavePreset = useCallback(() => {
    const trimmed = presetName.trim();
    if (!trimmed) { setPresetError("Enter a preset name."); return; }
    savePresetMutation.mutate({
      name: trimmed,
      cinema_ids: sortCinemaIds(localSelectedCinemaSet),
      is_favorite: saveAsFavorite,
    });
  }, [localSelectedCinemaSet, presetName, saveAsFavorite, savePresetMutation]);

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

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} opacity={0.45} pressBehavior="close" />
    ),
    []
  );

  const renderHandle = useCallback(
    () => (
      <View>
        <View style={styles.dragHandleBar} />
        <View style={styles.header}>
          {page === "presets" && (
            <TouchableOpacity onPress={() => setPage("selection")} hitSlop={8} style={styles.backButton}>
              <MaterialIcons name="arrow-back" size={20} color={colors.text} />
            </TouchableOpacity>
          )}
          <ThemedText style={styles.title}>
            {page === "presets" ? "Manage presets" : "Cinemas"}
          </ThemedText>
          <TouchableOpacity onPress={() => bottomSheetModalRef.current?.close()} hitSlop={8}>
            <MaterialIcons name="close" size={22} color={colors.text} />
          </TouchableOpacity>
        </View>
      </View>
    ),
    [colors, styles, page]
  );

  const isLoadingSelection =
    cinemas === undefined || (sessionCinemaIds === undefined && favoriteCinemaIds === undefined);

  return (
    <>
      <BottomSheetModal
        ref={bottomSheetModalRef}
        snapPoints={snapPoints}
        enablePanDownToClose
        enableDismissOnClose={false}
        animationConfigs={{ duration: 220 }}
        backdropComponent={renderBackdrop}
        handleComponent={renderHandle}
        backgroundStyle={{ backgroundColor: colors.nestedModalBackground }}
        topInset={topInset}
        onChange={handleSheetChange}
      >
        {/* @gorhom/portal does not forward React context; re-provide QueryClient for hooks inside. */}
        <QueryClientProvider client={queryClient}>
          {isLoadingSelection ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={colors.tint} />
              <ThemedText style={styles.loadingText}>Loading cinemas...</ThemedText>
            </View>
          ) : page === "presets" ? (
            /* ── Manage presets page ── */
            <BottomSheetScrollView
              contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {isPresetsLoading ? (
                <View style={styles.loadingContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </View>
              ) : presetsForRender.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <ThemedText style={styles.emptyText}>No presets yet.</ThemedText>
                </View>
              ) : (
                <>
                  <ThemedText style={styles.hintText}>
                    The starred preset is applied on startup. Use the arrows to reorder.
                  </ThemedText>
                  {presetsForRender.map((item, index) => {
                    const isCurrent = serializeCinemaIds(item.cinema_ids) === currentSelectionSignature;
                    const favoriteDisabled = item.is_favorite || setFavoritePresetMutation.isPending;
                    const deleteDisabled = deletePresetMutation.isPending;
                    const canMoveUp = index > 0;
                    const canMoveDown = index < presetsForRender.length - 1;
                    const n = item.cinema_ids.length;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={[styles.manageRow, isCurrent && styles.manageRowCurrent]}
                        onPress={() => { handleApplyPreset(item); setPage("selection"); }}
                        activeOpacity={0.88}
                      >
                        <TouchableOpacity
                          style={[styles.iconBtn, !canMoveUp && styles.iconBtnDisabled]}
                          onPress={(e) => { e.stopPropagation(); if (canMoveUp) handleMovePreset(index, index - 1); }}
                          disabled={!canMoveUp}
                          activeOpacity={0.7}
                          hitSlop={6}
                        >
                          <MaterialIcons name="keyboard-arrow-up" size={20} color={colors.textSecondary} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.iconBtn, !canMoveDown && styles.iconBtnDisabled]}
                          onPress={(e) => { e.stopPropagation(); if (canMoveDown) handleMovePreset(index, index + 1); }}
                          disabled={!canMoveDown}
                          activeOpacity={0.7}
                          hitSlop={6}
                        >
                          <MaterialIcons name="keyboard-arrow-down" size={20} color={colors.textSecondary} />
                        </TouchableOpacity>
                        <View style={styles.manageNameBlock}>
                          <ThemedText style={styles.manageName} numberOfLines={1}>{item.name}</ThemedText>
                          <ThemedText style={styles.manageMeta} numberOfLines={1}>
                            {n} cinema{n === 1 ? "" : "s"}
                          </ThemedText>
                        </View>
                        <TouchableOpacity
                          style={[
                            styles.iconBtn,
                            item.is_favorite && styles.iconBtnFavorite,
                            favoriteDisabled && !item.is_favorite && styles.iconBtnDisabled,
                          ]}
                          onPress={(e) => { e.stopPropagation(); handleSetFavoritePreset(item); }}
                          activeOpacity={0.7}
                          disabled={favoriteDisabled}
                          hitSlop={6}
                        >
                          <MaterialIcons
                            name={item.is_favorite ? "star" : "star-border"}
                            size={18}
                            color={item.is_favorite ? colors.yellow.secondary : colors.textSecondary}
                          />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.iconBtn, deleteDisabled && styles.iconBtnDisabled]}
                          onPress={(e) => { e.stopPropagation(); handleDeletePreset(item); }}
                          activeOpacity={0.7}
                          disabled={deleteDisabled}
                          hitSlop={6}
                        >
                          <MaterialIcons name="delete-outline" size={18} color={colors.red.secondary} />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  })}
                </>
              )}
            </BottomSheetScrollView>
          ) : (
            /* ── Cinema selection page ── */
            <BottomSheetScrollView
              contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset }]}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Presets section */}
              <SectionLabel label="Presets" colors={colors} />
              {presets.length > 0 && (
                <View style={styles.presetGrid}>
                  {presetsForRender.map((preset) => {
                    const isActive = serializeCinemaIds(preset.cinema_ids) === currentSelectionSignature;
                    const n = new Set(preset.cinema_ids).size;
                    return (
                      <TouchableOpacity
                        key={preset.id}
                        style={[styles.presetCard, isActive && styles.presetCardActive]}
                        onPress={() => handleApplyPreset(preset)}
                        activeOpacity={0.75}
                      >
                        <View style={styles.presetCardRow}>
                          <ThemedText
                            style={[styles.presetCardName, isActive && styles.presetCardNameActive]}
                            numberOfLines={2}
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
                        <ThemedText style={[styles.presetCardDesc, isActive && styles.presetCardDescActive]}>
                          {n} cinema{n === 1 ? "" : "s"}
                        </ThemedText>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              <View style={styles.presetActions}>
                <TouchableOpacity
                  style={[styles.actionRow, selectionMatchesPreset && styles.actionRowDisabled]}
                  onPress={handleOpenSavePresetDialog}
                  activeOpacity={0.8}
                  disabled={selectionMatchesPreset}
                >
                  <View style={styles.actionIcon}>
                    <MaterialIcons name="bookmark-add" size={17} color={colors.tint} />
                  </View>
                  <View style={styles.actionTextBlock}>
                    <ThemedText style={styles.actionTitle}>Save current selection</ThemedText>
                    <ThemedText style={styles.actionSubtitle}>
                      Save as a preset for quick access
                    </ThemedText>
                  </View>
                  <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
                </TouchableOpacity>

                {presets.length > 0 && (
                  <TouchableOpacity
                    style={styles.actionRow}
                    onPress={() => setPage("presets")}
                    activeOpacity={0.8}
                  >
                    <View style={styles.actionIcon}>
                      <MaterialIcons name="tune" size={17} color={colors.tint} />
                    </View>
                    <View style={styles.actionTextBlock}>
                      <ThemedText style={styles.actionTitle}>Manage presets</ThemedText>
                      <ThemedText style={styles.actionSubtitle}>
                        Reorder, delete or set a default
                      </ThemedText>
                    </View>
                    <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>

              <Divider colors={colors} />

              {/* Cinema selection */}
              <SectionLabel label="Select cinemas" colors={colors} />
              <View style={styles.allCinemasRow}>
                <ThemedText style={styles.selectionCount}>
                  {selectedCount} of {allCinemaIds.length} selected
                </ThemedText>
                <TouchableOpacity style={styles.toggleButton} onPress={handleToggleAll} activeOpacity={0.8}>
                  <ThemedText style={styles.toggleButtonText}>
                    {allSelected ? "Deselect all" : "Select all"}
                  </ThemedText>
                </TouchableOpacity>
              </View>

              {cinemaSections.map((section) => {
                const citySelected =
                  section.cityId !== undefined &&
                  section.cinemas.length > 0 &&
                  section.cinemas.every((c) => localSelectedCinemaSet.has(c.id));
                return (
                  <View key={section.key} style={styles.sectionCard}>
                    <View style={styles.sectionHeader}>
                      <View>
                        <ThemedText style={styles.cityTitle}>{section.title}</ThemedText>
                        {section.meta ? (
                          <ThemedText style={styles.sectionMeta}>{section.meta}</ThemedText>
                        ) : null}
                      </View>
                      {section.cityId !== undefined ? (
                        <TouchableOpacity
                          style={styles.toggleButton}
                          onPress={() => handleToggleCity(section.cityId!)}
                          activeOpacity={0.8}
                        >
                          <ThemedText style={styles.toggleButtonText}>
                            {citySelected ? "Deselect all" : "Select all"}
                          </ThemedText>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                    <View style={styles.cinemaList}>
                      {section.cinemas.map((cinema) => (
                        <CinemaRowChip
                          key={cinema.id}
                          cinema={cinema}
                          showCity={section.showCity === true}
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
              })}

              <View style={{ height: 20 }} />
            </BottomSheetScrollView>
          )}
        </QueryClientProvider>
      </BottomSheetModal>

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
                Save your current cinema selection to reuse it later.
              </ThemedText>
            </View>
            <TextInput
              value={presetName}
              onChangeText={(value) => {
                setPresetName(value);
                if (presetError) setPresetError(null);
              }}
              placeholder="Cinema preset name"
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
            {presetError ? (
              <ThemedText style={styles.presetErrorText}>{presetError}</ThemedText>
            ) : null}
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
    </>
  );
}

function SectionLabel({ label, colors }: { label: string; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <ThemedText style={{
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: "600",
      textTransform: "uppercase",
      letterSpacing: 0.6,
      marginBottom: 7,
    }}>
      {label}
    </ThemedText>
  );
}

function Divider({ colors }: { colors: ReturnType<typeof useThemeColors> }) {
  return <View style={{ height: 1, backgroundColor: colors.divider, marginVertical: 12 }} />;
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    dragHandleBar: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.textSecondary,
      opacity: 0.35,
      alignSelf: "center",
      marginTop: 10,
      marginBottom: 6,
    },
    header: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    backButton: { marginRight: 8 },
    title: { fontSize: 17, fontWeight: "700", flex: 1 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 14 },
    loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
    loadingText: { fontSize: 14, color: colors.textSecondary },
    // Presets grid
    presetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
    presetCard: {
      flexBasis: "47%",
      flexGrow: 1,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      gap: 4,
    },
    presetCardActive: { borderColor: colors.tint, backgroundColor: colors.pillActiveBackground },
    presetCardRow: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
    presetCardName: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.text },
    presetCardNameActive: { color: colors.pillActiveText },
    presetCardDesc: { fontSize: 11, color: colors.textSecondary },
    presetCardDescActive: { color: colors.pillActiveText, opacity: 0.8 },
    // Preset action rows
    presetActions: { gap: 8 },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
    },
    actionRowDisabled: { opacity: 0.5 },
    actionIcon: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.pillBackground,
    },
    actionTextBlock: { flex: 1 },
    actionTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
    actionSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
    // Cinema selection
    allCinemasRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 10,
    },
    selectionCount: { fontSize: 13, color: colors.textSecondary },
    toggleButton: {
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    toggleButtonText: { fontSize: 12, fontWeight: "600", color: colors.textSecondary },
    sectionCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      padding: 12,
      marginBottom: 10,
    },
    sectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    sectionMeta: { fontSize: 12, color: colors.textSecondary },
    cityTitle: { fontSize: 15, fontWeight: "700" },
    cinemaList: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
    cinemaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-start",
      alignSelf: "flex-start",
      maxWidth: "100%",
      columnGap: 6,
      paddingHorizontal: 8,
      paddingVertical: 6,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
    },
    cinemaRowSelected: { backgroundColor: colors.pillBackground },
    cinemaInfo: { flexShrink: 1, gap: 1 },
    cinemaNameRow: { flexDirection: "row", alignItems: "center" },
    cinemaName: { fontSize: 12, fontWeight: "600" },
    cinemaCity: { fontSize: 10, color: colors.textSecondary },
    checkbox: {
      width: 13,
      height: 13,
      borderRadius: 6.5,
      borderWidth: 1.2,
      borderColor: colors.divider,
      backgroundColor: "transparent",
      alignItems: "center",
      justifyContent: "center",
    },
    // Manage presets page
    emptyContainer: { paddingVertical: 40, alignItems: "center", justifyContent: "center" },
    emptyText: { fontSize: 14, color: colors.textSecondary, textAlign: "center" },
    hintText: { fontSize: 12, color: colors.textSecondary, marginBottom: 8 },
    manageRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      paddingLeft: 12,
      paddingRight: 8,
      paddingVertical: 8,
      marginBottom: 8,
    },
    manageRowCurrent: { borderColor: colors.tint, backgroundColor: colors.pillActiveBackground },
    manageNameBlock: { flex: 1, gap: 2 },
    manageName: { fontSize: 14, fontWeight: "600", color: colors.text },
    manageMeta: { fontSize: 11, color: colors.textSecondary },
    iconBtn: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.pillBackground,
    },
    iconBtnFavorite: { backgroundColor: colors.yellow.primary },
    iconBtnDisabled: { opacity: 0.4 },
    // Save preset dialog
    presetErrorText: { fontSize: 12, color: colors.red.secondary },
    dialogBackdrop: {
      flex: 1,
      backgroundColor: "rgba(15, 18, 27, 0.55)",
      justifyContent: "center",
      paddingHorizontal: 20,
    },
    dialogBackdropPressable: { ...StyleSheet.absoluteFillObject },
    dialogCard: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      padding: 16,
      gap: 12,
    },
    dialogHeader: { gap: 2 },
    dialogTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
    dialogSubtitle: { fontSize: 12, color: colors.textSecondary },
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
    favoriteToggle: { flexDirection: "row", alignItems: "center", columnGap: 10, paddingVertical: 2 },
    favoriteToggleText: { flex: 1, gap: 1 },
    favoriteToggleTitle: { fontSize: 13, fontWeight: "700", color: colors.text },
    favoriteToggleSubtitle: { fontSize: 11, color: colors.textSecondary },
    dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 2 },
    dialogButton: {
      minHeight: 38,
      paddingHorizontal: 14,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    dialogButtonPrimary: { backgroundColor: colors.tint, borderColor: colors.tint },
    dialogButtonSecondary: { backgroundColor: colors.cardBackground, borderColor: colors.divider },
    dialogButtonDisabled: { opacity: 0.5 },
    dialogButtonText: { fontSize: 12, fontWeight: "700" },
    dialogButtonTextPrimary: { color: colors.pillActiveText },
    dialogButtonTextSecondary: { color: colors.textSecondary },
  });
