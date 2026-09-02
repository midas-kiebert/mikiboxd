/**
 * A one-off cinema multi-select for a watchlist digest source. Deliberately
 * not the shared `CinemaFilterModal` — that one is tightly bound to the
 * global session cinema selection and preset CRUD. This picker only ever
 * hands the caller a raw `cinema_ids` array; nothing here is ever saved as a
 * `CinemaPreset` row.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useFetchCinemas } from 'shared/hooks/useFetchCinemas';

import CinemaPickerList from '@/components/filters/CinemaPickerList';
import { sortCinemaIds } from '@/components/filters/cinema-grouping';
import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/hooks/use-theme-color';

type CustomCinemaPickerModalProps = {
  visible: boolean;
  initialCinemaIds: readonly number[];
  onCancel: () => void;
  onSave: (cinemaIds: number[]) => void;
};

export default function CustomCinemaPickerModal({
  visible,
  initialCinemaIds,
  onCancel,
  onSave,
}: CustomCinemaPickerModalProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { data: cinemas } = useFetchCinemas();
  const cinemaList = useMemo(() => cinemas ?? [], [cinemas]);

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(
    () => new Set(initialCinemaIds)
  );

  // Reset to the source's saved selection each time the picker opens, rather
  // than carrying over whatever was left ticked from a previous open/cancel.
  useEffect(() => {
    if (visible) setSelectedIds(new Set(initialCinemaIds));
  }, [visible, initialCinemaIds]);

  const handleToggleCinema = useCallback((cinemaId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(cinemaId)) {
        next.delete(cinemaId);
      } else {
        next.add(cinemaId);
      }
      return next;
    });
  }, []);

  const handleSelectCinemas = useCallback((cinemaIds: readonly number[]) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      cinemaIds.forEach((id) => next.add(id));
      return next;
    });
  }, []);

  const handleDeselectCinemas = useCallback((cinemaIds: readonly number[]) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      cinemaIds.forEach((id) => next.delete(id));
      return next;
    });
  }, []);

  const handleSave = useCallback(() => {
    onSave(sortCinemaIds(selectedIds));
  }, [onSave, selectedIds]);

  if (!visible) return null;

  return (
    <Modal transparent statusBarTranslucent visible animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onCancel} />
        <View style={styles.card}>
          <ThemedText style={styles.title}>Custom cinemas</ThemedText>
          <ThemedText style={styles.subtitle}>
            {selectedIds.size} of {cinemaList.length} selected. This won&apos;t be saved as a
            preset.
          </ThemedText>
          <ScrollView
            style={styles.pickerBox}
            contentContainerStyle={styles.pickerContent}
            nestedScrollEnabled
          >
            <CinemaPickerList
              cinemas={cinemaList}
              selectedIds={selectedIds}
              onToggleCinema={handleToggleCinema}
              onSelectCinemas={handleSelectCinemas}
              onDeselectCinemas={handleDeselectCinemas}
            />
          </ScrollView>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.cancelButton]}
              onPress={onCancel}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.cancelText}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={handleSave}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.confirmText}>Save</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.28)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 20,
    },
    card: {
      width: '100%',
      maxWidth: 420,
      maxHeight: '80%',
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 14,
      gap: 8,
      shadowColor: '#000',
      shadowOpacity: 0.2,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
    title: { fontSize: 17, fontWeight: '700', color: colors.text },
    subtitle: { fontSize: 12, color: colors.textSecondary },
    pickerBox: {
      marginHorizontal: -20,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      backgroundColor: colors.background,
    },
    pickerContent: {
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
    button: {
      flex: 1,
      minHeight: 42,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelButton: {
      backgroundColor: colors.pillBackground,
      borderColor: colors.cardBorder,
    },
    cancelText: { fontSize: 14, fontWeight: '700', color: colors.text },
    primaryButton: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    confirmText: { fontSize: 14, fontWeight: '700', color: colors.pillActiveText },
  });
