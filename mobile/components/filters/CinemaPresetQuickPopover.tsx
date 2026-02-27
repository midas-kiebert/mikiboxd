/**
 * Floating quick-picker for cinema presets, shown from long-press on the cinemas filter pill.
 */
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useQuery } from "@tanstack/react-query";
import { MeService, type CinemaPresetPublic } from "shared";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import { ThemedText } from "@/components/themed-text";
import { type FilterPillLongPressPosition } from "@/components/filters/FilterPills";
import { loadCinemaPresetOrder, sortCinemaPresetsByOrder } from "@/components/filters/cinema-preset-order";
import { useThemeColors } from "@/hooks/use-theme-color";

type CinemaPresetQuickPopoverProps = {
  visible: boolean;
  anchor: FilterPillLongPressPosition | null;
  onClose: () => void;
  maxPresets?: number;
};

const CARD_WIDTH = 280;
const CARD_HORIZONTAL_MARGIN = 12;
const CARD_BOTTOM_MARGIN = 12;
const ARROW_SIZE = 14;
const ARROW_SIDE_GUTTER = 18;
const CARD_ANCHOR_GAP = 2;
const EMPTY_CINEMA_IDS: readonly number[] = [];

const sortCinemaIds = (cinemaIds: Iterable<number>) =>
  Array.from(new Set(cinemaIds)).sort((a, b) => a - b);
const serializeCinemaIds = (cinemaIds: Iterable<number>) => JSON.stringify(sortCinemaIds(cinemaIds));

export default function CinemaPresetQuickPopover({
  visible,
  anchor,
  onClose,
  maxPresets = 6,
}: CinemaPresetQuickPopoverProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const { selections: sessionCinemaIds, setSelections } = useSessionCinemaSelections();
  const { data: preferredCinemaIds } = useFetchSelectedCinemas();
  const selectedCinemaIds = useMemo(
    () => sessionCinemaIds ?? preferredCinemaIds ?? EMPTY_CINEMA_IDS,
    [preferredCinemaIds, sessionCinemaIds]
  );
  const currentSelectionSignature = useMemo(
    () => serializeCinemaIds(selectedCinemaIds),
    [selectedCinemaIds]
  );
  const [orderedPresetIds, setOrderedPresetIds] = useState<readonly string[]>([]);

  const { data: presets = [], isLoading } = useQuery({
    queryKey: ["cinema-presets"],
    enabled: visible,
    queryFn: () => MeService.getCinemaPresets(),
  });

  useEffect(() => {
    if (!visible) return;
    let isMounted = true;
    loadCinemaPresetOrder().then((orderedIds) => {
      if (!isMounted) return;
      setOrderedPresetIds(orderedIds);
    });
    return () => {
      isMounted = false;
    };
  }, [visible]);

  const visiblePresets = useMemo(() => {
    const ordered = sortCinemaPresetsByOrder(presets, orderedPresetIds);
    const sorted = ordered.length > 0 || presets.length === 0 ? ordered : presets;
    return sorted.slice(0, Math.max(1, maxPresets));
  }, [maxPresets, orderedPresetIds, presets]);

  const hiddenPresetCount = Math.max(0, presets.length - visiblePresets.length);

  const estimatedCardHeight =
    ARROW_SIZE / 2 +
    56 +
    Math.max(1, visiblePresets.length) * 52 +
    (hiddenPresetCount > 0 ? 24 : 0) +
    8;
  const minTop = 8 + ARROW_SIZE / 2;
  const maxTop = Math.max(minTop, screenHeight - estimatedCardHeight - CARD_BOTTOM_MARGIN);
  const anchorY = anchor?.pageY ?? 0;
  const desiredTop = anchorY + CARD_ANCHOR_GAP + ARROW_SIZE / 2;
  const cardTop = Math.max(minTop, Math.min(desiredTop, maxTop));
  const rawLeft = (anchor?.pageX ?? screenWidth / 2) - CARD_WIDTH / 2;
  const cardLeft = Math.max(
    CARD_HORIZONTAL_MARGIN,
    Math.min(rawLeft, screenWidth - CARD_WIDTH - CARD_HORIZONTAL_MARGIN)
  );
  const arrowCenterX = Math.max(
    ARROW_SIDE_GUTTER,
    Math.min((anchor?.pageX ?? screenWidth / 2) - cardLeft, CARD_WIDTH - ARROW_SIDE_GUTTER)
  );
  const arrowLeft = arrowCenterX - ARROW_SIZE / 2;

  const handleApplyPreset = (preset: CinemaPresetPublic) => {
    setSelections(sortCinemaIds(preset.cinema_ids));
    onClose();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
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
          <ThemedText style={styles.title}>Cinema presets</ThemedText>
          {isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.tint} />
              <ThemedText style={styles.loadingText}>Loading presets...</ThemedText>
            </View>
          ) : visiblePresets.length > 0 ? (
            <View style={styles.list}>
              {visiblePresets.map((preset) => {
                const isCurrent = serializeCinemaIds(preset.cinema_ids) === currentSelectionSignature;
                return (
                  <TouchableOpacity
                    key={preset.id}
                    style={[styles.presetRow, isCurrent && styles.presetRowCurrent]}
                    onPress={() => handleApplyPreset(preset)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.presetRowMain}>
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
                      <ThemedText style={styles.presetMeta}>
                        {preset.cinema_ids.length} cinema{preset.cinema_ids.length === 1 ? "" : "s"}
                      </ThemedText>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : (
            <ThemedText style={styles.emptyText}>No cinema presets saved yet.</ThemedText>
          )}
          {hiddenPresetCount > 0 ? (
            <ThemedText style={styles.hiddenCountText}>
              Showing {visiblePresets.length} of {presets.length} presets
            </ThemedText>
          ) : null}
        </View>
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
      paddingVertical: 10,
      paddingHorizontal: 10,
      shadowColor: "#000",
      shadowOpacity: 0.22,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
      gap: 8,
    },
    arrow: {
      position: "absolute",
      top: -(ARROW_SIZE / 2),
      backgroundColor: colors.background,
      borderLeftWidth: 1,
      borderTopWidth: 1,
      borderColor: colors.cardBorder,
      transform: [{ rotate: "45deg" }],
      shadowColor: "#000",
      shadowOpacity: 0.08,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    title: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
      paddingHorizontal: 4,
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
      gap: 6,
    },
    presetRow: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      paddingVertical: 8,
      paddingHorizontal: 10,
      gap: 6,
    },
    presetRowCurrent: {
      borderColor: colors.green.secondary,
      backgroundColor: colors.green.primary,
    },
    presetRowMain: {
      gap: 1,
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
    presetMeta: {
      fontSize: 11,
      color: colors.textSecondary,
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
  });
