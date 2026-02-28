/**
 * Mobile filter UI component: Filter Pills.
 */
import { useRef } from "react";
import { FlatList, StyleSheet, TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import {
  GLOBAL_LONG_PRESS_DELAY_MS,
  triggerLongPressHaptic,
} from "@/utils/long-press";

type FilterOption<TId extends string = string> = {
  id: TId;
  label: string;
  badgeCount?: number;
  activeBackgroundColor?: string;
  activeTextColor?: string;
  activeBorderColor?: string;
};

type CompoundRightToggle = {
  anchorId: string;
  label: string;
  onPress: () => void;
};

export type FilterPillLongPressPosition = {
  pageX: number;
  pageY: number;
};

type FilterPillsProps<TId extends string = string> = {
  filters: ReadonlyArray<FilterOption<TId>>;
  // For "single select" mode you pass a real id; for "multi active" mode most screens pass "".
  selectedId: TId | "";
  onSelect: (id: TId, position?: FilterPillLongPressPosition) => void;
  onLongPressSelect?: (id: TId, position: FilterPillLongPressPosition) => boolean | void;
  activeIds?: ReadonlyArray<TId>;
  compoundRightToggle?: CompoundRightToggle;
};

export default function FilterPills<TId extends string = string>({
  filters,
  selectedId,
  onSelect,
  onLongPressSelect,
  activeIds,
  compoundRightToggle,
}: FilterPillsProps<TId>) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const suppressNextPressIdRef = useRef<TId | null>(null);
  const pillSizeByIdRef = useRef<Map<TId, { width: number; height: number }>>(new Map());

  const getAnchorPosition = (
    id: TId,
    pageX: number,
    pageY: number,
    locationX: number,
    locationY: number
  ): FilterPillLongPressPosition => {
    const size = pillSizeByIdRef.current.get(id);
    const anchorPageX = size ? pageX - locationX + size.width / 2 : pageX;
    const anchorPageY = size ? pageY - locationY + size.height : pageY;
    return { pageX: anchorPageX, pageY: anchorPageY };
  };

  const handlePress = (id: TId, position?: FilterPillLongPressPosition) => {
    if (suppressNextPressIdRef.current === id) {
      suppressNextPressIdRef.current = null;
      return;
    }
    onSelect(id, position);
  };

  const handleLongPress = (
    id: TId,
    pageX: number,
    pageY: number,
    locationX: number,
    locationY: number
  ) => {
    if (!onLongPressSelect) return;
    const wasHandled =
      onLongPressSelect(id, getAnchorPosition(id, pageX, pageY, locationX, locationY)) === true;
    if (wasHandled) {
      triggerLongPressHaptic();
      suppressNextPressIdRef.current = id;
    }
  };

  const handlePressOut = (id: TId) => {
    if (suppressNextPressIdRef.current !== id) return;
    setTimeout(() => {
      if (suppressNextPressIdRef.current === id) {
        suppressNextPressIdRef.current = null;
      }
    }, 0);
  };

  // Nothing to render when the screen has no available filters/tabs.
  if (filters.length === 0) return null;

  // Render/output using the state and derived values prepared above.
  return (
    <View style={styles.container}>
      <FlatList
        data={filters}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          // `activeIds` supports multi-active mode; `selectedId` supports single-select mode.
          const isActive = selectedId === item.id || activeIds?.includes(item.id);
          const showBadge = typeof item.badgeCount === "number" && item.badgeCount > 0;
          const badgeText = item.badgeCount && item.badgeCount > 99 ? "99+" : String(item.badgeCount ?? 0);

          if (compoundRightToggle && item.id === compoundRightToggle.anchorId) {
            return (
              <View style={styles.compoundPill}>
                <TouchableOpacity
                  style={[
                    styles.compoundLeft,
                    isActive && styles.pillActive,
                    isActive && item.activeBackgroundColor
                      ? { backgroundColor: item.activeBackgroundColor }
                      : null,
                  ]}
                  onPress={({ nativeEvent }) =>
                    handlePress(
                      item.id,
                      getAnchorPosition(
                        item.id,
                        nativeEvent.pageX,
                        nativeEvent.pageY,
                        nativeEvent.locationX,
                        nativeEvent.locationY
                      )
                    )
                  }
                  onLongPress={({ nativeEvent }) =>
                    handleLongPress(
                      item.id,
                      nativeEvent.pageX,
                      nativeEvent.pageY,
                      nativeEvent.locationX,
                      nativeEvent.locationY
                    )
                  }
                  delayLongPress={GLOBAL_LONG_PRESS_DELAY_MS}
                  onPressOut={() => handlePressOut(item.id)}
                  onLayout={(event) => {
                    const { width, height } = event.nativeEvent.layout;
                    pillSizeByIdRef.current.set(item.id, { width, height });
                  }}
                  activeOpacity={1}
                >
                  <View style={styles.pillContent}>
                    <ThemedText
                      numberOfLines={1}
                      style={[
                        styles.pillText,
                        isActive && styles.pillTextActive,
                        isActive && item.activeTextColor ? { color: item.activeTextColor } : null,
                      ]}
                    >
                      {item.label}
                    </ThemedText>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.compoundRight}
                  onPress={compoundRightToggle.onPress}
                  activeOpacity={1}
                >
                  <ThemedText
                    numberOfLines={1}
                    style={styles.compoundRightText}
                  >
                    {compoundRightToggle.label}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            );
          }

          return (
            <TouchableOpacity
              style={[
                styles.pill,
                isActive && styles.pillActive,
                isActive && item.activeBackgroundColor
                  ? { backgroundColor: item.activeBackgroundColor }
                  : null,
                isActive && item.activeBorderColor
                  ? { borderWidth: 1, borderColor: item.activeBorderColor }
                  : null,
              ]}
              onPress={({ nativeEvent }) =>
                handlePress(
                  item.id,
                  getAnchorPosition(
                    item.id,
                    nativeEvent.pageX,
                    nativeEvent.pageY,
                    nativeEvent.locationX,
                    nativeEvent.locationY
                  )
                )
              }
              onLongPress={({ nativeEvent }) =>
                handleLongPress(
                  item.id,
                  nativeEvent.pageX,
                  nativeEvent.pageY,
                  nativeEvent.locationX,
                  nativeEvent.locationY
                )
              }
              delayLongPress={GLOBAL_LONG_PRESS_DELAY_MS}
              onPressOut={() => handlePressOut(item.id)}
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                pillSizeByIdRef.current.set(item.id, { width, height });
              }}
              activeOpacity={1}
            >
              <View style={styles.pillContent}>
                <ThemedText
                  numberOfLines={1}
                  style={[
                    styles.pillText,
                    isActive && styles.pillTextActive,
                    isActive && item.activeTextColor ? { color: item.activeTextColor } : null,
                  ]}
                >
                  {item.label}
                </ThemedText>
              </View>
              {showBadge ? (
                <View style={styles.badgeCorner}>
                  <ThemedText style={styles.badgeText}>
                    {badgeText}
                  </ThemedText>
                </View>
              ) : null}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
      backgroundColor: colors.background,
    },
    list: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      gap: 8,
    },
    pill: {
      position: "relative",
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 18,
      backgroundColor: colors.pillBackground,
      marginRight: 2,
    },
    compoundPill: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 18,
      backgroundColor: colors.pillBackground,
      borderWidth: 0,
      padding: 1,
      gap: 2,
      marginRight: 2,
    },
    compoundLeft: {
      borderRadius: 16,
      paddingHorizontal: 11,
      paddingVertical: 6,
    },
    compoundRight: {
      borderRadius: 16,
      paddingHorizontal: 11,
      paddingVertical: 6,
    },
    compoundRightText: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.pillText,
    },
    pillContent: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    pillActive: {
      backgroundColor: colors.pillActiveBackground,
    },
    pillText: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.pillText,
    },
    pillTextActive: {
      color: colors.pillActiveText,
    },
    badgeCorner: {
      position: "absolute",
      top: -6,
      right: -6,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 5,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.notificationBadge,
      zIndex: 1,
      elevation: 2,
    },
    badgeText: {
      fontSize: 10,
      lineHeight: 10,
      fontWeight: "700",
      color: "#fff",
      includeFontPadding: false,
      textAlignVertical: "center",
    },
  });
