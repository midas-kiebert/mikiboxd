import { useEffect, useMemo, useRef, useState } from "react";
import {
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import {
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MeService, type FilterPresetScope } from "shared";

import { ThemedText } from "@/components/themed-text";
import AppBottomSheet from "@/components/sheets/AppBottomSheet";
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
  const { bottom: bottomInset } = useSafeAreaInsets();

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
  // Uncontrolled input (no `value` prop): avoids React's reconciliation forcing
  // the value back onto the native input and swallowing fast keystrokes.
  const nameInputRef = useRef<{ clear: () => void } | null>(null);

  useEffect(() => {
    if (!visible) return;
    setName("");
    nameInputRef.current?.clear();
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
    <AppBottomSheet
      visible={visible}
      onClose={onClose}
      onBack={isPending ? undefined : onClose}
      title="Save filter preset"
      backgroundColor={colors.nestedModalBackground}
      enablePanDownToClose={!isPending}
      backdropPressBehavior={isPending ? "none" : "close"}
      keyboardBehavior="extend"
    >
      <BottomSheetScrollView contentContainerStyle={[styles.content, { paddingBottom: bottomInset + 16 }]}>
        <View style={styles.header}>
          <ThemedText style={styles.subtitle}>
            Check the filters to include. Applying the preset later only changes the checked ones — everything else stays as-is.
          </ThemedText>
        </View>

        <BottomSheetTextInput
          ref={nameInputRef as never}
          onChangeText={(value) => { setName(value); if (error) setError(null); }}
          placeholder="Preset name"
          placeholderTextColor={colors.textSecondary}
          style={styles.input}
          maxLength={80}
          autoCapitalize="words"
          autoCorrect={false}
          autoFocus
        />

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
      </BottomSheetScrollView>
    </AppBottomSheet>
  );
}

const createStyles = (colors: ReturnType<typeof useThemeColors>) =>
  StyleSheet.create({
    content: {
      paddingHorizontal: 16,
      paddingTop: 8,
      gap: 12,
    },
    header: { gap: 4 },
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
