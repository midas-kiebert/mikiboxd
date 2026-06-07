/**
 * Full-screen sheet for managing saved presets: favorite (applied on startup),
 * reorder, and delete. Opened from the Filters modal's Presets section.
 */
import { useEffect, useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { type FilterPresetScope } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { describeDisplayPreset, type DisplayPreset } from "@/components/filters/saved-presets";
import { useDisplayPresets } from "@/components/filters/useDisplayPresets";

type ManagePresetsModalProps = {
  visible: boolean;
  onClose: () => void;
  scope: FilterPresetScope;
};

export default function ManagePresetsModal({
  visible,
  onClose,
  scope,
}: ManagePresetsModalProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { presets, isLoading, remove, setFavorite, move } = useDisplayPresets(scope);

  const translateY = useSharedValue(0);

  useEffect(() => {
    if (visible) translateY.value = 0;
  }, [visible, translateY]);

  const panGesture = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((e) => {
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > 80 || e.velocityY > 800) {
        onClose();
      } else {
        translateY.value = withSpring(0, { damping: 20 });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  const favoriteHasCinemas = presets.some(
    (p) => p.isFavorite && p.includedFields.includes("cinemas")
  );

  const confirmDelete = (preset: DisplayPreset) => {
    Alert.alert(
      "Delete preset?",
      `Remove "${preset.name}"?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => remove(preset) },
      ],
      { cancelable: true }
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.wrapper}>
        <Animated.View style={[styles.sheet, sheetStyle]}>
          <SafeAreaView style={{ flex: 1 }} edges={["bottom"]}>
            <GestureDetector gesture={panGesture}>
              <View>
                <View style={styles.dragHandleBar} />
                <View style={styles.header}>
                  <ThemedText style={styles.title}>Manage presets</ThemedText>
                  <TouchableOpacity onPress={onClose} style={styles.closeBtn} activeOpacity={0.8}>
                    <ThemedText style={styles.closeText}>Done</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            </GestureDetector>

        {isLoading ? (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={colors.tint} />
          </View>
        ) : presets.length === 0 ? (
          <View style={styles.center}>
            <ThemedText style={styles.empty}>
              No presets yet. Save your filters as a preset to reuse them in one tap.
            </ThemedText>
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
            <ThemedText style={styles.hintText}>
              The starred preset is applied on startup. Use the arrows to reorder.
            </ThemedText>
            {favoriteHasCinemas && (
              <View style={styles.warning}>
                <MaterialIcons name="info-outline" size={13} color={colors.yellow.secondary} />
                <ThemedText style={styles.warningText}>
                  Your default preset includes a cinema selection, which will override your default cinema selection. You will still revert to your default cinema selection when you clear your filters.
                </ThemedText>
              </View>
            )}
            {presets.map((preset, index) => {
              const canMoveUp = index > 0;
              const canMoveDown = index < presets.length - 1;
              return (
                <View key={`${preset.source}-${preset.id}`} style={styles.row}>
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
                      {describeDisplayPreset(preset)}
                    </ThemedText>
                  </View>

                  <TouchableOpacity
                    style={[styles.iconBtn, preset.isFavorite && styles.iconBtnFavorite]}
                    onPress={() => setFavorite({ preset, makeFavorite: !preset.isFavorite })}
                    activeOpacity={0.7}
                    hitSlop={6}
                  >
                    <MaterialIcons
                      name={preset.isFavorite ? "star" : "star-border"}
                      size={18}
                      color={preset.isFavorite ? colors.yellow.secondary : colors.textSecondary}
                    />
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => confirmDelete(preset)}
                    activeOpacity={0.7}
                    hitSlop={6}
                  >
                    <MaterialIcons name="delete-outline" size={18} color={colors.red.secondary} />
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>
        )}
          </SafeAreaView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    wrapper: { flex: 1, justifyContent: "flex-end" },
    sheet: { height: "88%", backgroundColor: colors.nestedModalBackground, borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
    dragHandleBar: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.textSecondary, opacity: 0.35, alignSelf: "center", marginTop: 10, marginBottom: 6 },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    title: { fontSize: 18, fontWeight: "700" },
    closeBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 16,
      backgroundColor: colors.pillBackground,
    },
    closeText: { fontSize: 13, fontWeight: "600", color: colors.textSecondary },
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
      backgroundColor: colors.pillBackground,
    },
    iconBtnFavorite: { backgroundColor: colors.yellow.primary },
    iconBtnDisabled: { opacity: 0.4 },
    warning: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 7,
      paddingHorizontal: 10,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.yellow.secondary,
      backgroundColor: colors.yellow.primary,
    },
    warningText: { flex: 1, fontSize: 11, color: colors.text, lineHeight: 16 },
  });
