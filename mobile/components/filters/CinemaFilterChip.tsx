import { useEffect, useRef, useState } from "react";
import { Animated, Dimensions, LayoutChangeEvent, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useQuery } from "@tanstack/react-query";
import { MeService } from "shared";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useFiltersModal } from "@/components/filters/FiltersModalProvider";
import { triggerSelectionHaptic } from "@/utils/long-press";

type CinemaFilterChipProps = {
  /** Opens the full Filters modal. */
  onOpenFilters: () => void;
  /**
   * Opens the cinema selection modal. Defaults to the FiltersModalProvider's
   * cinema modal (used on the tab screens). Pages rendered outside that provider
   * (movie / friend agenda) pass their own local cinema modal opener.
   */
  onOpenCinemaModal?: () => void;
};

const DROPDOWN_WIDTH = 252;

export default function CinemaFilterChip({ onOpenFilters, onOpenCinemaModal }: CinemaFilterChipProps) {
  const colors = useThemeColors();
  const { openCinemaModal } = useFiltersModal();
  const styles = createStyles(colors);

  const chipRef = useRef<View>(null);
  // Height captured from onLayout — always reliable, used as fallback when measure() returns 0.
  const chipHeightRef = useRef<number>(0);
  const [dropdownVisible, setDropdownVisible] = useState(false);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);

  // Caret rotation: 0 = closed (0°), 1 = open (180°)
  const caretRotation = useRef(new Animated.Value(0)).current;
  const caretSpin = caretRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  useEffect(() => {
    Animated.timing(caretRotation, {
      toValue: dropdownVisible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [dropdownVisible, caretRotation]);

  const { data: allCinemas = [] } = useFetchCinemas();
  const { data: preferredCinemaIds } = useFetchSelectedCinemas();
  const { selections: sessionCinemaIds, setSelections: setSessionCinemaIds } =
    useSessionCinemaSelections();
  const { data: cinemaPresets = [] } = useQuery({
    queryKey: ["cinema-presets"],
    queryFn: () => MeService.getCinemaPresets(),
  });

  const effectiveIds = sessionCinemaIds ?? preferredCinemaIds ?? [];
  const sortedEffectiveIds = Array.from(new Set(effectiveIds)).sort((a, b) => a - b);
  const sig = JSON.stringify(sortedEffectiveIds);

  const isAllCinemas =
    allCinemas.length > 0 && sortedEffectiveIds.length === allCinemas.length;
  const matchingPreset = isAllCinemas
    ? null
    : cinemaPresets.find(
        (p) =>
          JSON.stringify(Array.from(new Set(p.cinema_ids)).sort((a, b) => a - b)) === sig
      );

  const label = isAllCinemas
    ? "All cinemas"
    : matchingPreset?.name ?? `${sortedEffectiveIds.length} cinemas`;

  const hintText =
    cinemaPresets.length === 0
      ? "Select cinemas and save presets"
      : "Select cinemas or manage presets";

  // Capture height from the layout event — this is always accurate.
  const handleChipLayout = (e: LayoutChangeEvent) => {
    chipHeightRef.current = e.nativeEvent.layout.height;
  };

  const openDropdown = () => {
    triggerSelectionHaptic();
    // measure() gives pageX/pageY (absolute screen coords) + dimensions.
    // More reliable than measureInWindow inside a ScrollView on Android.
    chipRef.current?.measure(
      (_x: number, _y: number, _width: number, height: number, pageX: number, pageY: number) => {
        const { width: screenWidth } = Dimensions.get("window");
        const chipH = height > 0 ? height : chipHeightRef.current;
        const left = Math.min(Math.max(pageX, 16), screenWidth - DROPDOWN_WIDTH - 16);
        setDropdownPos({ top: pageY + chipH + 6, left });
        setDropdownVisible(true);
      }
    );
  };

  const closeDropdown = () => setDropdownVisible(false);

  const applyPreset = (ids: readonly number[]) => {
    triggerSelectionHaptic();
    setSessionCinemaIds(Array.from(ids));
    closeDropdown();
  };

  const handleOpenFilters = () => {
    triggerSelectionHaptic();
    closeDropdown();
    (onOpenCinemaModal ?? openCinemaModal)();
  };

  return (
    <>
      <View ref={chipRef} collapsable={false} onLayout={handleChipLayout}>
        <TouchableOpacity style={styles.chip} onPress={openDropdown} activeOpacity={0.75}>
          <ThemedText style={styles.chipLabel} numberOfLines={1}>
            {label}
          </ThemedText>
          <Animated.View style={{ transform: [{ rotate: caretSpin }] }}>
            <MaterialIcons name="expand-more" size={13} color={colors.pillText} />
          </Animated.View>
        </TouchableOpacity>
      </View>

      {dropdownVisible && dropdownPos && (
        <Modal
          transparent
          visible
          statusBarTranslucent
          animationType="fade"
          onRequestClose={closeDropdown}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFillObject}
            activeOpacity={1}
            onPress={closeDropdown}
          />
          <View style={[styles.dropdown, { top: dropdownPos.top, left: dropdownPos.left }]}>
            {cinemaPresets.length === 0 ? (
              <View style={styles.emptyRow}>
                <ThemedText style={styles.emptyText}>No cinema presets yet</ThemedText>
              </View>
            ) : (
              <ScrollView
                style={{ maxHeight: 240 }}
                showsVerticalScrollIndicator={false}
                bounces={false}
              >
                {cinemaPresets.map((preset) => {
                  const presetSig = JSON.stringify(
                    Array.from(new Set(preset.cinema_ids)).sort((a, b) => a - b)
                  );
                  const isActive = presetSig === sig;
                  return (
                    <TouchableOpacity
                      key={preset.id}
                      style={[styles.presetRow, isActive && styles.presetRowActive]}
                      onPress={() => applyPreset(preset.cinema_ids)}
                      activeOpacity={0.8}
                    >
                      {preset.is_favorite && (
                        <MaterialIcons
                          name="star"
                          size={13}
                          color={isActive ? colors.pillActiveText : colors.yellow.secondary}
                        />
                      )}
                      <ThemedText
                        style={[styles.presetLabel, isActive && styles.presetLabelActive]}
                        numberOfLines={1}
                      >
                        {preset.name}
                      </ThemedText>
                      {isActive && (
                        <MaterialIcons name="check" size={14} color={colors.pillActiveText} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            <TouchableOpacity
              style={styles.hintRow}
              onPress={handleOpenFilters}
              activeOpacity={0.7}
            >
              <ThemedText style={styles.hintText} numberOfLines={2}>
                {hintText}
              </ThemedText>
              <MaterialIcons name="chevron-right" size={14} color={colors.tint} />
            </TouchableOpacity>
          </View>
        </Modal>
      )}
    </>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 14,
      backgroundColor: colors.pillBackground,
      borderWidth: 1,
      borderColor: colors.divider,
      alignSelf: "center",
    },
    chipLabel: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.pillText,
      flexShrink: 1,
    },
    dropdown: {
      position: "absolute",
      width: DROPDOWN_WIDTH,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      shadowColor: "#000",
      shadowOpacity: 0.16,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 4 },
      elevation: 10,
      overflow: "hidden",
    },
    emptyRow: {
      paddingHorizontal: 16,
      paddingVertical: 14,
    },
    emptyText: {
      fontSize: 13,
      color: colors.textSecondary,
    },
    presetRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    presetRowActive: {
      backgroundColor: colors.pillActiveBackground,
    },
    presetLabel: {
      flex: 1,
      fontSize: 14,
      fontWeight: "500",
      color: colors.pillText,
    },
    presetLabelActive: {
      color: colors.pillActiveText,
    },
    hintRow: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      gap: 6,
    },
    hintText: {
      flex: 1,
      fontSize: 12,
      color: colors.tint,
      fontWeight: "500",
    },
  });
