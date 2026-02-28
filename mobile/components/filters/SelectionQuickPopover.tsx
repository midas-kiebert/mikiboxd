import { useMemo } from "react";
import {
  Modal,
  Platform,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { type FilterPillLongPressPosition } from "@/components/filters/FilterPills";
import { useThemeColors } from "@/hooks/use-theme-color";

export type QuickSelectionPopoverOption = {
  id: string;
  label: string;
  meta?: string;
};

type SelectionQuickPopoverProps = {
  visible: boolean;
  anchor: FilterPillLongPressPosition | null;
  onClose: () => void;
  options: readonly QuickSelectionPopoverOption[];
  selectedOptionId?: string | null;
  onSelectOption: (optionId: string) => void;
  footerActionLabel?: string;
  onPressFooterAction?: () => void;
  cardWidth?: number;
};

const DEFAULT_CARD_WIDTH = 252;
const CARD_HORIZONTAL_MARGIN = 12;
const CARD_BOTTOM_MARGIN = 12;
const ARROW_SIZE = 14;
const ARROW_SIDE_GUTTER = 18;
const CARD_ANCHOR_GAP = 2;
const ANDROID_STATUSBAR_OFFSET = Platform.OS === "android" ? (StatusBar.currentHeight ?? 0) : 0;

export default function SelectionQuickPopover({
  visible,
  anchor,
  onClose,
  options,
  selectedOptionId = null,
  onSelectOption,
  footerActionLabel,
  onPressFooterAction,
  cardWidth = DEFAULT_CARD_WIDTH,
}: SelectionQuickPopoverProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();

  const estimatedCardHeight =
    ARROW_SIZE / 2 +
    Math.max(1, options.length) * 52 +
    (footerActionLabel && onPressFooterAction ? 50 : 0) +
    8;
  const minTop = 8 + ARROW_SIZE / 2;
  const maxTop = Math.max(minTop, screenHeight - estimatedCardHeight - CARD_BOTTOM_MARGIN);
  const anchorY = (anchor?.pageY ?? 0) - ANDROID_STATUSBAR_OFFSET;
  const desiredTop = anchorY + CARD_ANCHOR_GAP + ARROW_SIZE / 2;
  const cardTop = Math.max(minTop, Math.min(desiredTop, maxTop));
  const rawLeft = (anchor?.pageX ?? screenWidth / 2) - cardWidth / 2;
  const cardLeft = Math.max(
    CARD_HORIZONTAL_MARGIN,
    Math.min(rawLeft, screenWidth - cardWidth - CARD_HORIZONTAL_MARGIN)
  );
  const arrowCenterX = Math.max(
    ARROW_SIDE_GUTTER,
    Math.min((anchor?.pageX ?? screenWidth / 2) - cardLeft, cardWidth - ARROW_SIDE_GUTTER)
  );
  const arrowLeft = arrowCenterX - ARROW_SIZE / 2;

  const handleSelectOption = (optionId: string) => {
    onSelectOption(optionId);
    onClose();
  };

  const handlePressFooterAction = () => {
    if (!onPressFooterAction) return;
    onClose();
    onPressFooterAction();
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalRoot}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
        <View style={[styles.card, { top: cardTop, left: cardLeft, width: cardWidth }]}>
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
          <View style={styles.list}>
            {options.map((option) => {
              const isSelected = option.id === selectedOptionId;
              return (
                <TouchableOpacity
                  key={option.id}
                  style={[styles.optionRow, isSelected && styles.optionRowSelected]}
                  onPress={() => handleSelectOption(option.id)}
                  activeOpacity={0.8}
                >
                  <View style={styles.optionTextWrap}>
                    <ThemedText numberOfLines={1} style={styles.optionLabel}>
                      {option.label}
                    </ThemedText>
                    {option.meta ? (
                      <ThemedText numberOfLines={1} style={styles.optionMeta}>
                        {option.meta}
                      </ThemedText>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
            {footerActionLabel && onPressFooterAction ? (
              <TouchableOpacity
                style={styles.footerActionRow}
                onPress={handlePressFooterAction}
                activeOpacity={0.8}
              >
                <ThemedText numberOfLines={1} style={styles.footerActionText}>
                  {footerActionLabel}
                </ThemedText>
              </TouchableOpacity>
            ) : null}
          </View>
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
      paddingVertical: 8,
      paddingHorizontal: 10,
      shadowColor: "#000",
      shadowOpacity: 0.22,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
      gap: 6,
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
    list: {
      gap: 6,
    },
    optionRow: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      paddingVertical: 8,
      paddingHorizontal: 10,
      minHeight: 42,
      justifyContent: "center",
    },
    optionRowSelected: {
      borderColor: colors.green.secondary,
      backgroundColor: colors.green.primary,
    },
    optionTextWrap: {
      minWidth: 0,
      gap: 1,
    },
    optionLabel: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    optionMeta: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    footerActionRow: {
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
    footerActionText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.tint,
      textAlign: "center",
    },
  });
