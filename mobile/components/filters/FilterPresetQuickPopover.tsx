import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MeService,
  type FilterPresetCreate,
  type FilterPresetPublic,
  type FilterPresetScope,
} from "shared";

import {
  type PageFilterPresetState,
} from "@/components/filters/FilterPresetsModal";
import { type FilterPillLongPressPosition } from "@/components/filters/FilterPills";
import {
  canonicalizeDaySelections,
  formatDayPillLabel,
} from "@/components/filters/day-filter-utils";
import {
  loadFilterPresetOrder,
  sanitizeFilterPresetOrderIds,
  sortFilterPresetsByOrder,
} from "@/components/filters/filter-preset-order";
import {
  formatTimePillLabel,
  normalizeSingleTimeRangeSelection,
} from "@/components/filters/time-range-utils";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";

type FilterPresetQuickPopoverProps = {
  visible: boolean;
  anchor: FilterPillLongPressPosition | null;
  onClose: () => void;
  onOpenModal: () => void;
  scope: FilterPresetScope;
  currentFilters: PageFilterPresetState;
  onApply: (filters: PageFilterPresetState) => void;
  maxPresets?: number;
};

const CARD_WIDTH = 280;
const CARD_HORIZONTAL_MARGIN = 12;
const CARD_BOTTOM_MARGIN = 12;
const ARROW_SIZE = 14;
const CARD_ANCHOR_GAP = 2;
const SUMMARY_CARD_HEIGHT = 58;
const QUICK_ACTION_HEIGHT = 40;
const OPEN_MODAL_ROW_HEIGHT = 42;
const ACTION_GAP = 8;

const normalizeFilters = (
  filters: PageFilterPresetState | FilterPresetPublic["filters"]
): PageFilterPresetState => {
  const selectedShowtimeFilter =
    filters.selected_showtime_filter === "all" ||
    filters.selected_showtime_filter === "interested" ||
    filters.selected_showtime_filter === "going"
      ? filters.selected_showtime_filter
      : null;
  const showtimeAudience =
    filters.showtime_audience === "including-friends" ||
    filters.showtime_audience === "only-you"
      ? filters.showtime_audience
      : "including-friends";

  return {
    selected_showtime_filter: selectedShowtimeFilter,
    showtime_audience: showtimeAudience,
    watchlist_only: Boolean(filters.watchlist_only),
    days: canonicalizeDaySelections(filters.days),
    time_ranges: normalizeSingleTimeRangeSelection(filters.time_ranges ?? []),
  };
};

const serializeFilters = (filters: PageFilterPresetState) =>
  JSON.stringify(normalizeFilters(filters));

const toPresetBodyFilters = (
  filters: PageFilterPresetState
): FilterPresetCreate["filters"] => {
  const normalized = normalizeFilters(filters);
  return {
    selected_showtime_filter: normalized.selected_showtime_filter,
    showtime_audience:
      normalized.showtime_audience === "only-you" ? "only-you" : "including-friends",
    watchlist_only: Boolean(normalized.watchlist_only),
    days: normalized.days ?? null,
    time_ranges: normalized.time_ranges ?? null,
  };
};

const getAudienceSummary = (value: PageFilterPresetState["showtime_audience"]) =>
  value === "only-you" ? "You" : "Friends";

const getStatusSummary = (
  value: PageFilterPresetState["selected_showtime_filter"],
  audience: PageFilterPresetState["showtime_audience"]
) => {
  const audienceSummary = getAudienceSummary(audience);
  if (value === "going") return `Going (${audienceSummary})`;
  if (value === "interested") return `Interested (${audienceSummary})`;
  return null;
};

const buildCurrentFiltersSummary = (
  scope: FilterPresetScope,
  filters: PageFilterPresetState
) => {
  const normalized = normalizeFilters(filters);
  const parts: string[] = [];

  if (scope === "SHOWTIMES") {
    const status = getStatusSummary(
      normalized.selected_showtime_filter,
      normalized.showtime_audience
    );
    if (status) parts.push(status);
    if (!status && normalized.showtime_audience === "only-you") parts.push("Only you");
  }

  if (normalized.watchlist_only) parts.push("Watchlist");

  const dayLabel = formatDayPillLabel(normalized.days ?? []);
  if (dayLabel !== "Any Day") parts.push(dayLabel);

  const timeLabel = formatTimePillLabel(normalized.time_ranges ?? []);
  if (timeLabel.toLowerCase() !== "any time") parts.push(timeLabel);

  if (parts.length === 0) return "No restrictions";
  return parts.join(" • ");
};

export default function FilterPresetQuickPopover({
  visible,
  anchor,
  onClose,
  onOpenModal,
  scope,
  currentFilters,
  onApply,
  maxPresets = 6,
}: FilterPresetQuickPopoverProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const modalRootRef = useRef<View | null>(null);
  const [modalRootTop, setModalRootTop] = useState(0);
  const queryClient = useQueryClient();
  const [presetName, setPresetName] = useState("");
  const [presetError, setPresetError] = useState<string | null>(null);
  const [isSavePresetDialogVisible, setIsSavePresetDialogVisible] = useState(false);
  const [saveAsFavorite, setSaveAsFavorite] = useState(false);
  const [presetOrderIds, setPresetOrderIds] = useState<readonly string[]>([]);
  const updateModalRootTop = useCallback(() => {
    modalRootRef.current?.measureInWindow((_x, y) => {
      setModalRootTop(y);
    });
  }, []);

  useEffect(() => {
    if (visible) return;
    setIsSavePresetDialogVisible(false);
    setPresetName("");
    setPresetError(null);
    setSaveAsFavorite(false);
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let isMounted = true;
    loadFilterPresetOrder(scope).then((orderedIds) => {
      if (!isMounted) return;
      setPresetOrderIds(orderedIds);
    });
    return () => {
      isMounted = false;
    };
  }, [scope, visible]);

  const { data: presets = [], isLoading } = useQuery({
    queryKey: ["filter-presets", scope],
    enabled: visible,
    queryFn: () => MeService.getFilterPresets({ scope }),
  });
  const presetsQueryKey = useMemo(() => ["filter-presets", scope] as const, [scope]);
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

  useEffect(() => {
    if (presetOrderIds.length === 0 || presets.length === 0) return;
    const presetIdSet = new Set(presets.map((preset) => preset.id));
    const trimmedOrder = presetOrderIds.filter((presetId) => presetIdSet.has(presetId));
    if (trimmedOrder.length === presetOrderIds.length) return;
    setPresetOrderIds(sanitizeFilterPresetOrderIds(trimmedOrder));
  }, [presetOrderIds, presets]);

  const orderedPresets = useMemo(
    () => sortFilterPresetsByOrder(presets, presetOrderIds),
    [presetOrderIds, presets]
  );
  const presetsForRender = useMemo(
    () => (orderedPresets.length > 0 || presets.length === 0 ? orderedPresets : presets),
    [orderedPresets, presets]
  );
  const visiblePresets = useMemo(
    () => presetsForRender.slice(0, Math.max(1, maxPresets)),
    [maxPresets, presetsForRender]
  );
  const hiddenPresetCount = Math.max(0, presetsForRender.length - visiblePresets.length);
  const currentSignature = useMemo(
    () => serializeFilters(currentFilters),
    [currentFilters]
  );
  const currentPreset = useMemo(
    () =>
      presets.find(
        (preset) => serializeFilters(normalizeFilters(preset.filters)) === currentSignature
      ) ?? null,
    [currentSignature, presets]
  );
  const favoritePreset = useMemo(
    () => presets.find((preset) => preset.is_favorite) ?? null,
    [presets]
  );
  const isFavoriteApplied = useMemo(() => {
    if (!favoritePreset) return false;
    return (
      serializeFilters(normalizeFilters(favoritePreset.filters)) === currentSignature
    );
  }, [currentSignature, favoritePreset]);
  const summaryTitle = "Current filters";
  const summaryText = useMemo(
    () => buildCurrentFiltersSummary(scope, currentFilters),
    [currentFilters, scope]
  );
  const shouldShowCurrentFiltersCard = !currentPreset;
  const canUseFavorite = Boolean(favoritePreset) && !isFavoriteApplied;
  const canSaveCurrent = !currentPreset;

  const estimatedCardHeight =
    ARROW_SIZE / 2 +
    (shouldShowCurrentFiltersCard ? SUMMARY_CARD_HEIGHT + ACTION_GAP : 0) +
    QUICK_ACTION_HEIGHT +
    ACTION_GAP +
    Math.max(1, visiblePresets.length) * 44 +
    (hiddenPresetCount > 0 ? 24 : 0) +
    OPEN_MODAL_ROW_HEIGHT +
    8;
  const minTop = 8;
  const maxTop = Math.max(minTop, screenHeight - estimatedCardHeight - CARD_BOTTOM_MARGIN);
  const anchorY = (anchor?.pageY ?? screenHeight) - modalRootTop;
  const desiredTop = anchorY - CARD_ANCHOR_GAP - estimatedCardHeight;
  const cardTop = Math.max(minTop, Math.min(desiredTop, maxTop));
  const rawLeft = (anchor?.pageX ?? screenWidth / 2) - CARD_WIDTH / 2;
  const cardLeft = Math.max(
    CARD_HORIZONTAL_MARGIN,
    Math.min(rawLeft, screenWidth - CARD_WIDTH - CARD_HORIZONTAL_MARGIN)
  );
  const arrowLeftRaw = (anchor?.pageX ?? screenWidth / 2) - cardLeft - ARROW_SIZE / 2;
  const arrowLeft = Math.max(0, Math.min(arrowLeftRaw, CARD_WIDTH - ARROW_SIZE));
  const arrowCenterX = cardLeft + arrowLeft + ARROW_SIZE / 2;
  const cardBottom = cardTop + estimatedCardHeight;
  const arrowTipY = cardBottom + ARROW_SIZE / 2;

  useEffect(() => {
    if (!__DEV__ || !visible) return;
    console.log("[FilterPresetQuickPopover] layout", {
      anchorPageX: anchor?.pageX ?? null,
      anchorPageY: anchor?.pageY ?? null,
      modalRootTop,
      anchorY,
      screenWidth,
      screenHeight,
      cardTop,
      cardLeft,
      estimatedCardHeight,
      cardBottom,
      arrowLeftRaw,
      arrowLeft,
      arrowCenterX,
      arrowTipY,
    });
  }, [
    anchor?.pageX,
    anchor?.pageY,
    anchorY,
    arrowCenterX,
    arrowLeft,
    arrowLeftRaw,
    arrowTipY,
    cardBottom,
    cardLeft,
    cardTop,
    estimatedCardHeight,
    modalRootTop,
    screenHeight,
    screenWidth,
    visible,
  ]);

  const handleApplyPreset = (preset: FilterPresetPublic) => {
    onApply(normalizeFilters(preset.filters));
    onClose();
  };

  const handleUseFavorite = () => {
    if (!favoritePreset) return;
    handleApplyPreset(favoritePreset);
  };

  const handleOpenSavePresetDialog = () => {
    if (!canSaveCurrent) return;
    setPresetName("");
    setPresetError(null);
    setSaveAsFavorite(false);
    setIsSavePresetDialogVisible(true);
  };

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

  const handleToggleSaveAsFavorite = useCallback(() => {
    setSaveAsFavorite((current) => !current);
  }, []);

  const handleChangePresetName = useCallback(
    (value: string) => {
      setPresetName(value);
      if (presetError) setPresetError(null);
    },
    [presetError]
  );

  const handleClose = useCallback(() => {
    if (savePresetMutation.isPending) return;
    onClose();
  }, [onClose, savePresetMutation.isPending]);

  const handleSaveCurrent = () => {
    handleOpenSavePresetDialog();
  };

  const handleOpenModal = () => {
    handleClose();
    onOpenModal();
  };

  return (
    <Modal
      transparent
      statusBarTranslucent
      visible={visible}
      animationType="fade"
      onShow={updateModalRootTop}
      onRequestClose={handleClose}
    >
      <View ref={modalRootRef} style={styles.modalRoot} onLayout={updateModalRootTop}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
        <View style={[styles.card, { top: cardTop, left: cardLeft, width: CARD_WIDTH }]}>
          <View
            style={[
              styles.arrow,
              {
                left: arrowLeft,
                width: ARROW_SIZE,
                height: ARROW_SIZE,
              },
            ]}
          />
          {shouldShowCurrentFiltersCard ? (
            <View style={[styles.summaryCard, styles.summaryCardCurrent]}>
              <View style={styles.summaryTitleRow}>
                <ThemedText numberOfLines={1} style={styles.summaryTitle}>
                  {summaryTitle}
                </ThemedText>
              </View>
              <ThemedText numberOfLines={2} style={styles.summaryText}>
                {summaryText}
              </ThemedText>
            </View>
          ) : null}
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.actionButton, !canUseFavorite && styles.actionButtonDisabled]}
              onPress={handleUseFavorite}
              activeOpacity={0.8}
              disabled={!canUseFavorite}
            >
              <MaterialIcons
                name="star"
                size={12}
                color={canUseFavorite ? colors.text : colors.textSecondary}
              />
              <ThemedText style={styles.actionButtonText}>
                {!favoritePreset
                  ? "Use favorite"
                  : isFavoriteApplied
                    ? "Using favorite"
                    : "Use favorite"}
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.actionButton, !canSaveCurrent && styles.actionButtonDisabled]}
              onPress={handleSaveCurrent}
              activeOpacity={0.8}
              disabled={!canSaveCurrent}
            >
              <MaterialIcons
                name="bookmark-add"
                size={12}
                color={canSaveCurrent ? colors.text : colors.textSecondary}
              />
              <ThemedText style={styles.actionButtonText}>
                {canSaveCurrent ? "Save current" : "Saved"}
              </ThemedText>
            </TouchableOpacity>
          </View>
          {isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.tint} />
              <ThemedText style={styles.loadingText}>Loading presets...</ThemedText>
            </View>
          ) : visiblePresets.length > 0 ? (
            <View style={styles.list}>
              {visiblePresets.map((preset) => {
                const isCurrent =
                  serializeFilters(normalizeFilters(preset.filters)) === currentSignature;
                return (
                  <TouchableOpacity
                    key={preset.id}
                    style={[styles.presetRow, isCurrent && styles.presetRowCurrent]}
                    onPress={() => handleApplyPreset(preset)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.presetNameRow}>
                      {preset.is_favorite ? (
                        <MaterialIcons
                          name="star"
                          size={12}
                          color={colors.yellow.secondary}
                          style={styles.favoriteStar}
                        />
                      ) : null}
                      <ThemedText numberOfLines={1} style={styles.presetName}>
                        {preset.name}
                      </ThemedText>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <ThemedText style={styles.emptyText}>No filter presets saved yet.</ThemedText>
          )}
          {hiddenPresetCount > 0 ? (
            <ThemedText style={styles.hiddenCountText}>
              Showing {visiblePresets.length} of {presets.length} presets
            </ThemedText>
          ) : null}
          <TouchableOpacity
            style={styles.openModalRow}
            onPress={handleOpenModal}
            activeOpacity={0.8}
          >
            <ThemedText numberOfLines={1} style={styles.openModalText}>
              Manage all presets
            </ThemedText>
          </TouchableOpacity>
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
                onChangeText={handleChangePresetName}
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
                onPress={handleToggleSaveAsFavorite}
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
      </View>
    </Modal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    modalRoot: {
      flex: 1,
    },
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "transparent",
    },
    card: {
      position: "absolute",
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      paddingVertical: 8,
      paddingHorizontal: 10,
      shadowColor: "#000",
      shadowOpacity: 0.22,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
      gap: 6,
    },
    summaryCard: {
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 3,
    },
    summaryCardCurrent: {
      borderColor: colors.green.secondary,
      backgroundColor: colors.green.primary,
    },
    summaryTitleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      minWidth: 0,
    },
    summaryTitle: {
      flex: 1,
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    summaryText: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    actionsRow: {
      flexDirection: "row",
      gap: 6,
    },
    actionButton: {
      flex: 1,
      minHeight: 36,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      paddingHorizontal: 8,
    },
    actionButtonDisabled: {
      opacity: 0.5,
    },
    actionButtonText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.text,
    },
    arrow: {
      position: "absolute",
      bottom: -(ARROW_SIZE / 2),
      backgroundColor: colors.background,
      borderRightWidth: 1,
      borderBottomWidth: 1,
      borderColor: colors.cardBorder,
      transform: [{ rotate: "45deg" }],
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    loadingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 4,
    },
    loadingText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    list: {
      gap: 5,
    },
    presetRow: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      paddingVertical: 6,
      paddingHorizontal: 10,
    },
    presetRowCurrent: {
      borderColor: colors.green.secondary,
      backgroundColor: colors.green.primary,
    },
    presetNameRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      minWidth: 0,
    },
    favoriteStar: {
      marginTop: 0.5,
    },
    presetName: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
      flex: 1,
    },
    emptyText: {
      fontSize: 12,
      color: colors.textSecondary,
      paddingHorizontal: 4,
      paddingVertical: 4,
    },
    hiddenCountText: {
      fontSize: 11,
      color: colors.textSecondary,
      paddingHorizontal: 4,
      marginTop: -2,
    },
    openModalRow: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.tint,
      backgroundColor: colors.searchBackground,
      paddingVertical: 9,
      paddingHorizontal: 10,
      minHeight: 42,
      justifyContent: "center",
      marginTop: 2,
    },
    openModalText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.tint,
      textAlign: "center",
    },
    dialogBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.28)",
      justifyContent: "center",
      alignItems: "center",
      paddingHorizontal: 20,
    },
    dialogBackdropPressable: {
      ...StyleSheet.absoluteFillObject,
    },
    dialogCard: {
      width: "100%",
      maxWidth: 360,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      paddingHorizontal: 14,
      paddingTop: 14,
      paddingBottom: 12,
      gap: 11,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 9,
    },
    dialogHeader: {
      gap: 3,
    },
    dialogTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    dialogSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 18,
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
      alignItems: "flex-start",
      gap: 10,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
      paddingHorizontal: 10,
      paddingVertical: 10,
    },
    favoriteToggleText: {
      flex: 1,
      gap: 2,
    },
    favoriteToggleTitle: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    favoriteToggleSubtitle: {
      fontSize: 11,
      color: colors.textSecondary,
      lineHeight: 16,
    },
    presetErrorText: {
      fontSize: 12,
      color: colors.red.secondary,
    },
    dialogActions: {
      flexDirection: "row",
      gap: 8,
    },
    dialogButton: {
      flex: 1,
      minHeight: 38,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
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
      fontSize: 13,
      fontWeight: "700",
    },
    dialogButtonTextPrimary: {
      color: colors.pillActiveText,
    },
    dialogButtonTextSecondary: {
      color: colors.textSecondary,
    },
  });
