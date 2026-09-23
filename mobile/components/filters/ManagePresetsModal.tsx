/**
 * Full-screen sheet for managing quick filters: reorder and delete. Opened
 * from the Filters modal's footer.
 */
import { useMemo } from "react";
import {
  Alert,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { BottomSheetScrollView } from "@gorhom/bottom-sheet";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";

import { ThemedText } from "@/components/themed-text";
import AppBottomSheet from "@/components/sheets/AppBottomSheet";
import { useThemeColors } from "@/hooks/use-theme-color";
import { describeDisplayPreset, type DisplayPreset } from "@/components/filters/saved-presets";
import { buildCityNameIndex } from "@/components/filters/cinema-grouping";
import { useDisplayPresets } from "@/components/filters/useDisplayPresets";
import { triggerImpactHaptic, triggerSelectionHaptic } from "@/utils/long-press";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";

type ManagePresetsModalProps = {
  visible: boolean;
  onClose: () => void;
};

export default function ManagePresetsModal({
  visible,
  onClose,
}: ManagePresetsModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  // Mounted alongside the filters sheet whether or not it is open, so the query
  // is held back until it actually is — and a guest, who has no presets and no
  // way to reach this, never fires it at all.
  const { presets, isLoading, remove, move } = useDisplayPresets({
    enabled: visible,
  });
  // A preset that follows a whole city says so by name rather than by count,
  // which needs the city names (see `formatCinemaScopeLabel`).
  const { data: allCinemas } = useFetchCinemas();
  const cityNamesById = useMemo(
    () => buildCityNameIndex(allCinemas ?? []),
    [allCinemas]
  );

  const confirmDelete = (preset: DisplayPreset) => {
    Alert.alert(
      "Delete quick filter?",
      `Remove "${preset.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            triggerImpactHaptic();
            remove(preset);
          },
        },
      ],
      { cancelable: true }
    );
  };

  return (
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      onBack={onClose}
      title="Quick filters"
      backgroundColor={colors.nestedModalBackground}
      contentReady={!isLoading}
      loadingLabel="Loading quick filters…"
      // A handful of quick filter cards — nothing that could stall the rise — so they
      // go up the moment the fetch lands rather than waiting out the animation.
      deferContent={false}
    >
        {presets.length === 0 ? (
          <View style={styles.center}>
            <ThemedText style={styles.empty}>
              No quick filters yet. Save your current filters as a quick filter to reuse them in one tap.
            </ThemedText>
          </View>
        ) : (
          <BottomSheetScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            <ThemedText style={styles.hintText}>
              Use the arrows to reorder.
            </ThemedText>
            {presets.map((preset, index) => {
              const canMoveUp = index > 0;
              const canMoveDown = index < presets.length - 1;
              return (
                <View key={preset.id} style={styles.row}>
                  <TouchableOpacity
                    style={[styles.iconBtn, !canMoveUp && styles.iconBtnDisabled]}
                    onPress={() => canMoveUp && move(index, index - 1)}
                    disabled={!canMoveUp}
                    activeOpacity={0.7}
                    hitSlop={6}
                  >
                    <MaterialIcons name="keyboard-arrow-up" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.iconBtn, !canMoveDown && styles.iconBtnDisabled]}
                    onPress={() => canMoveDown && move(index, index + 1)}
                    disabled={!canMoveDown}
                    activeOpacity={0.7}
                    hitSlop={6}
                  >
                    <MaterialIcons name="keyboard-arrow-down" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>

                  <View style={styles.nameBlock}>
                    <ThemedText style={styles.name} numberOfLines={1}>
                      {preset.name}
                    </ThemedText>
                    <ThemedText style={styles.description} numberOfLines={2}>
                      {describeDisplayPreset(preset, cityNamesById)}
                    </ThemedText>
                  </View>

                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => {
                      triggerSelectionHaptic();
                      confirmDelete(preset);
                    }}
                    activeOpacity={0.7}
                    hitSlop={6}
                  >
                    <MaterialIcons name="delete-outline" size={18} color={colors.red.secondary} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </BottomSheetScrollView>
        )}
    </AppBottomSheet>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
    empty: { fontSize: 14, color: colors.textSecondary, textAlign: "center", lineHeight: 20 },
    list: { padding: 16, gap: 8 },
    hintText: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
    row: {
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
    },
    nameBlock: { flex: 1, gap: 2 },
    name: { fontSize: 14, fontWeight: "600", color: colors.text },
    description: { fontSize: 11, color: colors.textSecondary, lineHeight: 15 },
    iconBtn: {
      width: 32,
      height: 32,
      borderRadius: 9,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.surfaceMuted,
    },
    iconBtnDisabled: { opacity: 0.4 },
  });
