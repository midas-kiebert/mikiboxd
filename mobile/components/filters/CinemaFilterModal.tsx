/**
 * Mobile filter UI component: Cinema Filter Modal.
 *
 * Laid out like FiltersModal: a scroll box holding nothing but the cinemas
 * themselves, plus a footer pinned below it for the actions that end the visit
 * (saving the selection as a preset, and managing presets). Presets are applied
 * from the top bar and from the Filters sheet, not from in here, so the list is
 * never a wall of preset cards standing between the user and the cinemas.
 *
 * The cinemas are drawn by the shared {@link CinemaPickerList}, so the sheet and
 * the cinema-preset feature tip pick cinemas in exactly the same way.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import { QueryClientProvider, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MeService,
  type CinemaPresetCreate,
  type CinemaPresetPublic,
} from "shared";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import { ThemedText } from "@/components/themed-text";
import CinemaPickerList from "@/components/filters/CinemaPickerList";
import { serializeCinemaIds, sortCinemaIds } from "@/components/filters/cinema-grouping";
import { invalidateCinemaPresets, useCinemaPresets } from "@/components/filters/cinema-presets";
import {
  loadCinemaPresetOrder,
  sanitizeCinemaPresetOrderIds,
  saveCinemaPresetOrder,
  sortCinemaPresetsByOrder,
} from "@/components/filters/cinema-preset-order";
import { useThemeColors } from "@/hooks/use-theme-color";
import AppBottomSheet from "@/components/sheets/AppBottomSheet";
import { triggerSelectionHaptic } from "@/utils/long-press";

type CinemaFilterModalProps = {
  visible: boolean;
  onClose: () => void;
  onBack?: () => void;
  initialPage?: CinemaModalPage;
};

type CinemaModalPage = "selection" | "presets";

const setsMatch = (left: Set<number>, right: Set<number>) => {
  if (left.size !== right.size) return false;
  for (const id of left) { if (!right.has(id)) return false; }
  return true;
};

export default function CinemaFilterModal({ visible, onClose, onBack, initialPage = "selection" }: CinemaFilterModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const { bottom: bottomInset } = useSafeAreaInsets();

  const [page, setPage] = useState<CinemaModalPage>("selection");
  const [presetName, setPresetName] = useState("");
  // Uncontrolled input (no `value` prop) to avoid swallowing fast keystrokes.
  const presetNameInputRef = useRef<TextInput>(null);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [isSavePresetDialogVisible, setIsSavePresetDialogVisible] = useState(false);
  const [saveAsFavorite, setSaveAsFavorite] = useState(false);
  const [presetOrderIds, setPresetOrderIds] = useState<readonly string[]>([]);

  const { data: cinemas } = useFetchCinemas();
  const { data: favoriteCinemaIds, isLoading: isFavoritesLoading } = useFetchSelectedCinemas();
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

  // Commit the pending selection (if changed) when the sheet closes.
  const handleClose = useCallback(() => {
    const current = localSelectedCinemaSetRef.current;
    const preferred = selectedCinemaSetRef.current;
    if (!setsMatch(current, preferred)) {
      setSessionCinemaIds(sortCinemaIds(current));
    }
    onClose();
  }, [onClose, setSessionCinemaIds]);

  // Header back button: step back from the presets page, else return to the
  // parent sheet (when opened nested), else nothing (root selection page).
  const headerBack =
    page === "presets" ? () => setPage("selection") : onBack;

  const handleAndroidBack = useCallback(() => {
    if (page === "presets") {
      setPage("selection");
      return true;
    }
    if (onBack) {
      onBack();
      return true;
    }
    handleClose();
    return true;
  }, [page, onBack, handleClose]);

  useEffect(() => {
    if (!visible) return;
    setLocalSelectedCinemaSet(new Set(selectedCinemas));
    setPresetError(null);
    setPresetName("");
    presetNameInputRef.current?.clear();
    setIsSavePresetDialogVisible(false);
    setSaveAsFavorite(false);
    setPage(initialPage);
  }, [visible, selectedCinemas, initialPage]);

  const { data: presets = [], isLoading: isPresetsLoading } = useCinemaPresets({
    enabled: visible,
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
      presetNameInputRef.current?.clear();
      setSaveAsFavorite(false);
      setIsSavePresetDialogVisible(false);
      invalidateCinemaPresets(queryClient);
    },
    onError: () => {
      setPresetError("Could not save cinema preset. Please try again.");
    },
  });

  const deletePresetMutation = useMutation({
    mutationFn: (presetId: string) => MeService.deleteCinemaPreset({ presetId }),
    onSuccess: () => {
      invalidateCinemaPresets(queryClient);
    },
  });

  const setFavoritePresetMutation = useMutation({
    mutationFn: (presetId: string) => MeService.setFavoriteCinemaPreset({ presetId }),
    onSuccess: () => {
      invalidateCinemaPresets(queryClient);
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
  // Nothing to save while the selection is already a preset, and a preset
  // covering no cinema would filter every showtime away.
  const canSaveSelection = selectedCount > 0 && !selectionMatchesPreset;

  const handleToggle = useCallback((cinemaId: number) => {
    setLocalSelectedCinemaSet((current) => {
      const next = new Set(current);
      if (next.has(cinemaId)) { next.delete(cinemaId); } else { next.add(cinemaId); }
      return next;
    });
  }, []);

  const handleSelectCinemas = useCallback((cinemaIds: readonly number[]) => {
    setLocalSelectedCinemaSet((current) => {
      const next = new Set(current);
      cinemaIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const handleDeselectCinemas = useCallback((cinemaIds: readonly number[]) => {
    setLocalSelectedCinemaSet((current) => {
      const next = new Set(current);
      cinemaIds.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    triggerSelectionHaptic();
    setLocalSelectedCinemaSet(new Set(allCinemaIds));
  }, [allCinemaIds]);

  const handleClearAll = useCallback(() => {
    triggerSelectionHaptic();
    setLocalSelectedCinemaSet(new Set());
  }, []);

  const handleApplyPreset = useCallback((preset: CinemaPresetPublic) => {
    triggerSelectionHaptic();
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
    if (!canSaveSelection) return;
    triggerSelectionHaptic();
    setPresetName("");
    presetNameInputRef.current?.clear();
    setPresetError(null);
    setSaveAsFavorite(false);
    setIsSavePresetDialogVisible(true);
  }, [canSaveSelection]);

  const handleCloseSavePresetDialog = useCallback(() => {
    if (savePresetMutation.isPending) return;
    setIsSavePresetDialogVisible(false);
    setPresetError(null);
  }, [savePresetMutation.isPending]);

  // Block only while the cinema list is unavailable or the favourites query is
  // still in-flight. Once favourites settles — even on error (e.g. a rejected
  // token or a network blip) — fall through with an empty selection instead of
  // spinning forever.
  const isLoadingSelection =
    cinemas === undefined ||
    (sessionCinemaIds === undefined && favoriteCinemaIds === undefined && isFavoritesLoading);

  return (
    <>
      <AppBottomSheet
        visible={visible}
        onClose={handleClose}
        onBack={headerBack}
        handleAndroidBack={handleAndroidBack}
        title={page === "presets" ? "Manage presets" : "Cinemas"}
        backgroundColor={colors.nestedModalBackground}
        // This sheet opens both on its own (the cinema chip) and on top of the
        // Filters sheet, so it has to re-mount each time to stay in front — see
        // AppBottomSheet's `dismissWhenClosed`.
        dismissWhenClosed
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
                    const favoriteDisabled = item.is_favorite || setFavoritePresetMutation.isPending;
                    const deleteDisabled = deletePresetMutation.isPending;
                    const canMoveUp = index > 0;
                    const canMoveDown = index < presetsForRender.length - 1;
                    const n = item.cinema_ids.length;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.manageRow}
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
            <>
              <BottomSheetScrollView
                style={styles.scroll}
                contentContainerStyle={styles.scrollContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <View style={styles.pickerHeader}>
                  <ThemedText style={styles.selectionCount}>
                    {selectedCount} of {allCinemaIds.length} selected
                  </ThemedText>
                  <View style={styles.pickerHeaderActions}>
                    {!allSelected ? (
                      <TouchableOpacity
                        onPress={handleSelectAll}
                        activeOpacity={0.7}
                        hitSlop={8}
                        accessibilityRole="button"
                      >
                        <ThemedText style={styles.headerAction}>Select all</ThemedText>
                      </TouchableOpacity>
                    ) : null}
                    {selectedCount > 0 ? (
                      <TouchableOpacity
                        onPress={handleClearAll}
                        activeOpacity={0.7}
                        hitSlop={8}
                        accessibilityRole="button"
                      >
                        <ThemedText style={styles.headerAction}>Clear all</ThemedText>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>

                <CinemaPickerList
                  cinemas={cinemaList}
                  selectedIds={localSelectedCinemaSet}
                  onToggleCinema={handleToggle}
                  onSelectCinemas={handleSelectCinemas}
                  onDeselectCinemas={handleDeselectCinemas}
                />
              </BottomSheetScrollView>

              {/* Pinned footer: the preset actions stay reachable at any scroll
                  position, since the cinema list is far longer than a screen. */}
              <View style={[styles.footer, { paddingBottom: bottomInset + 12 }]}>
                <TouchableOpacity
                  style={[
                    styles.footerButton,
                    canSaveSelection
                      ? styles.footerButtonHighlighted
                      : styles.footerButtonDisabled,
                  ]}
                  onPress={handleOpenSavePresetDialog}
                  activeOpacity={0.8}
                  disabled={!canSaveSelection}
                  accessibilityRole="button"
                >
                  <MaterialIcons
                    name="bookmark-add"
                    size={17}
                    color={canSaveSelection ? colors.green.secondary : colors.textSecondary}
                  />
                  <ThemedText
                    style={[
                      styles.footerButtonText,
                      canSaveSelection && styles.footerButtonTextHighlighted,
                    ]}
                    numberOfLines={1}
                  >
                    Save current selection
                  </ThemedText>
                </TouchableOpacity>
                {presets.length > 0 && (
                  <TouchableOpacity
                    style={[styles.footerButton, styles.managePresetsButton]}
                    onPress={() => {
                      triggerSelectionHaptic();
                      setPage("presets");
                    }}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Manage presets"
                  >
                    <MaterialIcons name="tune" size={17} color={colors.textSecondary} />
                    <ThemedText style={styles.footerButtonText} numberOfLines={1}>
                      Presets
                    </ThemedText>
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
        </QueryClientProvider>
      </AppBottomSheet>

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
              ref={presetNameInputRef}
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

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    // The scroll box owns the full width between the header and the pinned
    // footer; only its content is inset.
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 20 },
    loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 40 },
    loadingText: { fontSize: 14, color: colors.textSecondary },
    // Cinema selection
    pickerHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      marginBottom: 10,
    },
    pickerHeaderActions: { flexDirection: "row", alignItems: "center", gap: 14 },
    selectionCount: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    headerAction: { fontSize: 13, fontWeight: "700", color: colors.tint },
    // Pinned footer (mirrors FiltersModal's preset actions)
    footer: {
      flexDirection: "row",
      alignItems: "stretch",
      gap: 8,
      paddingHorizontal: 20,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      backgroundColor: colors.nestedModalBackground,
    },
    footerButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 7,
      paddingHorizontal: 14,
      paddingVertical: 11,
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      // "Save current selection" is the primary of the two, so it takes the
      // leftover width while "Presets" stays at its label's size.
      flex: 1,
    },
    // Saving is only worth a tap once the selection is actually new, so the
    // button stays quiet until then — a soft tinted fill rather than an outline,
    // at the same border width so nothing shifts when the state flips.
    footerButtonHighlighted: {
      backgroundColor: colors.green.primary,
      borderColor: colors.green.primary,
    },
    footerButtonDisabled: { opacity: 0.5 },
    managePresetsButton: { flex: 0 },
    footerButtonText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
    footerButtonTextHighlighted: { color: colors.green.secondary },
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
