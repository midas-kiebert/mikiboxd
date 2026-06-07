import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService, type FilterPresetScope } from "shared";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { type PageFilterPresetState } from "@/components/filters/FilterPresetsModal";
import {
  buildSavedPresetCreate,
  displayPresetsQueryKey,
  summarizeCurrentSelections,
  type PresetDimension,
} from "@/components/filters/saved-presets";

type SavePresetDialogProps = {
  visible: boolean;
  onClose: () => void;
  scope: FilterPresetScope;
  currentFilters: PageFilterPresetState;
  cinemaIds: number[];
  cinemaLabel: string;
  cinemaActive: boolean;
  canUseWatchlistFilter: boolean;
  showRuntime: boolean;
  showGroupBy: boolean;
};

export default function SavePresetDialog({
  visible,
  onClose,
  scope,
  currentFilters,
  cinemaIds,
  cinemaLabel,
  cinemaActive,
  canUseWatchlistFilter,
  showRuntime,
  showGroupBy,
}: SavePresetDialogProps) {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();

  const summaries = useMemo(
    () =>
      summarizeCurrentSelections({
        currentFilters,
        cinemaLabel,
        cinemaActive,
        canUseWatchlistFilter,
        showRuntime,
        showGroupBy,
      }),
    [currentFilters, cinemaLabel, cinemaActive, canUseWatchlistFilter, showRuntime, showGroupBy]
  );

  const [name, setName] = useState("");
  const [saveAsDefault, setSaveAsDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [included, setIncluded] = useState<Set<PresetDimension>>(new Set());

  useEffect(() => {
    if (!visible) return;
    setName("");
    setSaveAsDefault(false);
    setError(null);
    setIncluded(
      new Set(summaries.filter((row) => row.active).map((row) => row.dimension))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const { mutate: save, isPending } = useMutation({
    mutationFn: async () => {
      const created = await MeService.createSavedPreset({
        requestBody: buildSavedPresetCreate({
          name: name.trim(),
          scope,
          isFavorite: saveAsDefault,
          includedFields: summaries
            .map((row) => row.dimension)
            .filter((dimension) => included.has(dimension)),
          currentFilters,
          cinemaIds,
        }),
      });
      if (saveAsDefault) {
        await MeService.clearFavoriteFilterPreset({ scope });
      }
      return created;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: displayPresetsQueryKey(scope) });
      queryClient.invalidateQueries({ queryKey: ["user", "favorite_saved_preset", scope] });
      queryClient.invalidateQueries({ queryKey: ["user", "favorite_filter_preset", scope] });
      onClose();
    },
    onError: () => setError("Could not save preset. Please try again."),
  });

  const toggle = (dimension: PresetDimension) => {
    setIncluded((current) => {
      const next = new Set(current);
      if (next.has(dimension)) next.delete(dimension);
      else next.add(dimension);
      return next;
    });
    if (error) setError(null);
  };

  const canSave = name.trim().length > 0 && included.size > 0 && !isPending;

  const handleSave = () => {
    if (!name.trim()) { setError("Enter a preset name."); return; }
    if (included.size === 0) { setError("Include at least one filter."); return; }
    save();
  };

  const showCinemaWarning = saveAsDefault && included.has("cinemas");

  return (
    <Modal
      transparent
      statusBarTranslucent
      visible={visible}
      animationType="fade"
      onRequestClose={() => { if (!isPending) onClose(); }}
    >
      {/* Tappable dim backdrop — sits behind everything */}
      <TouchableOpacity
        style={[StyleSheet.absoluteFill, styles.backdrop]}
        activeOpacity={1}
        onPress={() => { if (!isPending) onClose(); }}
      />

      {/* KAV only wraps the card, shifts it above keyboard without resizing the backdrop */}
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.kav}
        pointerEvents="box-none"
      >
        <View style={styles.card}>
          <View style={styles.header}>
            <ThemedText style={styles.title}>Save filter preset</ThemedText>
            <ThemedText style={styles.subtitle}>
              Check the filters to include. Applying the preset later only changes the checked ones — everything else stays as-is.
            </ThemedText>
          </View>

          <TextInput
            value={name}
            onChangeText={(value) => { setName(value); if (error) setError(null); }}
            placeholder="Preset name"
            placeholderTextColor={colors.textSecondary}
            style={styles.input}
            maxLength={80}
            autoCapitalize="words"
            autoCorrect={false}
            autoFocus
          />

          {/* Compact pill grid — one pill per dimension */}
          <View style={styles.pillGrid}>
            {summaries.map((row) => {
              const isChecked = included.has(row.dimension);
              return (
                <TouchableOpacity
                  key={row.dimension}
                  style={[styles.pill, isChecked && styles.pillChecked]}
                  onPress={() => toggle(row.dimension)}
                  activeOpacity={0.75}
                >
                  <MaterialIcons
                    name={isChecked ? "check-box" : "check-box-outline-blank"}
                    size={16}
                    color={isChecked ? colors.tint : colors.textSecondary}
                  />
                  <View style={styles.pillTextBlock}>
                    <ThemedText style={[styles.pillLabel, isChecked && styles.pillLabelChecked]}>
                      {row.title}
                    </ThemedText>
                    <ThemedText style={styles.pillValue} numberOfLines={1}>
                      {row.valueLabel}
                    </ThemedText>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity
            style={styles.defaultRow}
            onPress={() => setSaveAsDefault((v) => !v)}
            activeOpacity={0.8}
          >
            <MaterialIcons
              name={saveAsDefault ? "check-box" : "check-box-outline-blank"}
              size={18}
              color={saveAsDefault ? colors.tint : colors.textSecondary}
            />
            <View style={styles.defaultText}>
              <ThemedText style={styles.defaultLabel}>Set as default</ThemedText>
              <ThemedText style={styles.defaultSub}>
                These filters will be selected by default when you open the app.
              </ThemedText>
            </View>
          </TouchableOpacity>

          {showCinemaWarning && (
            <View style={styles.warning}>
              <MaterialIcons name="info-outline" size={13} color={colors.yellow.secondary} />
              <ThemedText style={styles.warningText}>
                Setting a preset with cinema selections as default will override your default cinema selection. You will still revert to your default cinema selection when you clear your filters.
              </ThemedText>
            </View>
          )}

          {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.btn, styles.btnSecondary]}
              onPress={onClose}
              activeOpacity={0.8}
              disabled={isPending}
            >
              <ThemedText style={[styles.btnText, styles.btnTextSecondary]}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, !canSave && styles.btnDisabled]}
              onPress={handleSave}
              activeOpacity={0.8}
              disabled={!canSave}
            >
              <ThemedText style={[styles.btnText, styles.btnTextPrimary]}>
                {isPending ? "Saving…" : "Save"}
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    backdrop: {
      backgroundColor: "rgba(0,0,0,0.45)",
    },
    kav: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: 20,
    },
    card: {
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      padding: 16,
      gap: 12,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 9,
    },
    header: { gap: 4 },
    title: { fontSize: 15, fontWeight: "700", color: colors.text },
    subtitle: { fontSize: 11, color: colors.textSecondary, lineHeight: 16 },
    input: {
      borderWidth: 1,
      borderColor: colors.divider,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 9,
      backgroundColor: colors.cardBackground,
      color: colors.text,
      fontSize: 14,
      fontWeight: "500",
    },
    pillGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
    },
    pillChecked: {
      borderColor: colors.tint,
    },
    pillTextBlock: { gap: 0 },
    pillLabel: { fontSize: 12, fontWeight: "600", color: colors.textSecondary, lineHeight: 15 },
    pillLabelChecked: { color: colors.text },
    pillValue: { fontSize: 10, color: colors.textSecondary, lineHeight: 13 },
    defaultRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 8,
    },
    defaultText: { flex: 1, gap: 2 },
    defaultLabel: { fontSize: 13, fontWeight: "600", color: colors.text },
    defaultSub: { fontSize: 11, color: colors.textSecondary, lineHeight: 15 },
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
    errorText: { fontSize: 12, color: colors.red.secondary },
    actions: { flexDirection: "row", gap: 8 },
    btn: {
      flex: 1,
      minHeight: 36,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    btnPrimary: { backgroundColor: colors.tint, borderColor: colors.tint },
    btnSecondary: { backgroundColor: colors.cardBackground, borderColor: colors.divider },
    btnDisabled: { opacity: 0.5 },
    btnText: { fontSize: 13, fontWeight: "700" },
    btnTextPrimary: { color: colors.pillActiveText },
    btnTextSecondary: { color: colors.textSecondary },
  });
