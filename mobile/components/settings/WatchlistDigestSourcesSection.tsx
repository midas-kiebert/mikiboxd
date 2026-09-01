/**
 * The "advanced" body of the watchlist digest settings: a user may have any
 * number of digest sources, each an independent {frequency, list/watchlist,
 * cinema restriction} rule (see `services/watchlist_digest.py` on the
 * backend, which sends each source's email on its own schedule). The master
 * on/off switch lives above this in `settings.tsx`; everything here only
 * renders once that switch is on.
 */
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useQuery } from '@tanstack/react-query';
import { UtilsService, type DigestFrequency } from 'shared';
import {
  useFetchLetterboxdLists,
  useLetterboxdListMutations,
} from 'shared/hooks/useLetterboxdLists';

import {
  findMyCinemasPreset,
  findNamedCinemaPresets,
  useCinemaPresets,
} from '@/components/filters/cinema-presets';
import CustomCinemaPickerModal from '@/components/settings/CustomCinemaPickerModal';
import { ThemedText } from '@/components/themed-text';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import SegmentedControl, { type SegmentedOption } from '@/components/ui/SegmentedControl';
import { useThemeColors } from '@/hooks/use-theme-color';
import {
  useWatchlistDigestSourceMutations,
  useWatchlistDigestSources,
} from '@/hooks/useWatchlistDigestSources';

const DIGEST_FREQUENCY_OPTIONS: readonly SegmentedOption<DigestFrequency>[] = [
  { value: 'daily', label: 'Eager' },
  { value: 'weekly_or_urgent', label: 'Weekly' },
];

const MAX_SOURCES = 5;

type WatchlistDigestSourcesSectionProps = {
  isSignedIn: boolean;
  enabled: boolean;
  letterboxdUsername: string | null;
};

export default function WatchlistDigestSourcesSection({
  isSignedIn,
  enabled,
  letterboxdUsername,
}: WatchlistDigestSourcesSectionProps) {
  const colors = useThemeColors();
  const styles = createStyles(colors);

  const shouldLoad = isSignedIn && enabled;
  const { data: sources = [] } = useWatchlistDigestSources(shouldLoad);
  const { data: digestLists = [] } = useFetchLetterboxdLists(shouldLoad);
  const { data: cinemaPresets = [] } = useCinemaPresets({ enabled: shouldLoad });
  const { addList } = useLetterboxdListMutations();
  const { createSource, updateSource, deleteSource } = useWatchlistDigestSourceMutations();

  const [newListUrl, setNewListUrl] = useState('');
  const [isFrequencyInfoVisible, setIsFrequencyInfoVisible] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [cinemaPickerSourceId, setCinemaPickerSourceId] = useState<string | null>(null);

  const { data: frequencyInfo } = useQuery({
    queryKey: ['watchlist-digest-frequency-info'],
    queryFn: () => UtilsService.getWatchlistDigestFrequencyInfo(),
    enabled: shouldLoad,
    staleTime: Infinity,
  });

  const favoriteCinemaPreset = findMyCinemasPreset(cinemaPresets);
  const namedCinemaPresets = findNamedCinemaPresets(cinemaPresets);

  const handleAddList = useCallback(() => {
    const url = newListUrl.trim();
    if (!url) return;
    addList.mutate(url, { onSuccess: () => setNewListUrl('') });
  }, [addList, newListUrl]);

  const handleAddSource = useCallback(() => {
    createSource.mutate({});
  }, [createSource]);

  const cinemaPickerSource = sources.find((source) => source.id === cinemaPickerSourceId) ?? null;

  return (
    <View style={styles.container}>
      <View style={styles.listSection}>
        <ThemedText style={styles.label}>Your Letterboxd lists</ThemedText>
        <View style={styles.addListRow}>
          <TextInput
            style={styles.addListInput}
            placeholder="Paste a Letterboxd list URL"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            keyboardType="url"
            value={newListUrl}
            onChangeText={setNewListUrl}
          />
          <TouchableOpacity
            style={styles.addListButton}
            onPress={handleAddList}
            disabled={!newListUrl.trim() || addList.isPending}
            activeOpacity={0.8}
          >
            {addList.isPending ? (
              <ActivityIndicator size="small" color={colors.pillActiveText} />
            ) : (
              <MaterialIcons name="add" size={18} color={colors.pillActiveText} />
            )}
          </TouchableOpacity>
        </View>
        {addList.isError ? (
          <ThemedText style={styles.errorText}>
            Couldn&apos;t add that list. Check the URL and try again.
          </ThemedText>
        ) : null}
      </View>

      {sources.map((source, index) => (
        <View key={source.id} style={styles.sourceCard}>
          <View style={styles.sourceHeaderRow}>
            <ThemedText style={styles.sourceTitle}>Source {index + 1}</ThemedText>
            <TouchableOpacity
              onPress={() => setPendingDeleteId(source.id)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Remove this source"
            >
              <MaterialIcons name="delete-outline" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <View style={styles.fieldRow}>
            <View style={styles.fieldLabelRow}>
              <ThemedText style={styles.fieldLabel}>Frequency</ThemedText>
              <TouchableOpacity
                onPress={() => setIsFrequencyInfoVisible(true)}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="What do Eager and Weekly mean?"
              >
                <MaterialIcons name="info-outline" size={14} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <SegmentedControl
              options={DIGEST_FREQUENCY_OPTIONS}
              value={source.frequency}
              onChange={(frequency) =>
                updateSource.mutate({ sourceId: source.id, payload: { frequency } })
              }
              accessibilityLabelPrefix="Frequency"
              disabled={updateSource.isPending}
            />
          </View>

          <View style={styles.fieldRow}>
            <ThemedText style={styles.fieldLabel}>List</ThemedText>
            <View style={styles.chipRow}>
              {letterboxdUsername ? (
                <SourceChip
                  label="My watchlist"
                  isActive={source.list_id === null}
                  onPress={() =>
                    updateSource.mutate({ sourceId: source.id, payload: { list_id: null } })
                  }
                  styles={styles}
                />
              ) : null}
              {digestLists.map((list) => (
                <SourceChip
                  key={list.id}
                  label={`${list.title ?? list.list_slug}${list.is_curated ? ' (curated)' : ''}`}
                  isActive={source.list_id === list.id}
                  onPress={() =>
                    updateSource.mutate({ sourceId: source.id, payload: { list_id: list.id } })
                  }
                  styles={styles}
                />
              ))}
            </View>
            {!letterboxdUsername && !source.list_id ? (
              <ThemedText style={styles.noticeText}>
                No watchlist connected — connect Letterboxd above, or pick a list here.
              </ThemedText>
            ) : null}
          </View>

          <View style={styles.fieldRow}>
            <ThemedText style={styles.fieldLabel}>Cinemas</ThemedText>
            <View style={styles.chipRow}>
              <SourceChip
                label="All cinemas"
                isActive={!source.cinema_preset_id && !source.custom_cinema_ids}
                onPress={() =>
                  updateSource.mutate({
                    sourceId: source.id,
                    payload: { cinema_preset_id: null, custom_cinema_ids: null },
                  })
                }
                styles={styles}
              />
              {favoriteCinemaPreset ? (
                <SourceChip
                  label={`Default (${favoriteCinemaPreset.name})`}
                  isActive={source.cinema_preset_id === favoriteCinemaPreset.id}
                  onPress={() =>
                    updateSource.mutate({
                      sourceId: source.id,
                      payload: { cinema_preset_id: favoriteCinemaPreset.id },
                    })
                  }
                  styles={styles}
                />
              ) : null}
              {namedCinemaPresets.map((preset) => (
                <SourceChip
                  key={preset.id}
                  label={preset.name}
                  isActive={source.cinema_preset_id === preset.id}
                  onPress={() =>
                    updateSource.mutate({
                      sourceId: source.id,
                      payload: { cinema_preset_id: preset.id },
                    })
                  }
                  styles={styles}
                />
              ))}
              <SourceChip
                label={
                  source.custom_cinema_ids
                    ? `Custom (${source.custom_cinema_ids.length})`
                    : 'Custom cinemas…'
                }
                isActive={!!source.custom_cinema_ids}
                onPress={() => setCinemaPickerSourceId(source.id)}
                styles={styles}
              />
            </View>
          </View>
        </View>
      ))}

      {sources.length < MAX_SOURCES ? (
        <TouchableOpacity
          style={styles.addSourceButton}
          onPress={handleAddSource}
          disabled={createSource.isPending}
          activeOpacity={0.8}
        >
          {createSource.isPending ? (
            <ActivityIndicator size="small" color={colors.tint} />
          ) : (
            <MaterialIcons name="add" size={16} color={colors.tint} />
          )}
          <ThemedText style={styles.addSourceText}>Add source</ThemedText>
        </TouchableOpacity>
      ) : null}

      <ConfirmDialog
        visible={isFrequencyInfoVisible}
        title="Eager vs Weekly"
        message={
          frequencyInfo
            ? `${frequencyInfo.daily.label}: ${frequencyInfo.daily.description}\n\n${frequencyInfo.weekly_or_urgent.label}: ${frequencyInfo.weekly_or_urgent.description}`
            : undefined
        }
        icon="info-outline"
        confirmLabel="Got it"
        tone="primary"
        onConfirm={() => setIsFrequencyInfoVisible(false)}
        onCancel={() => setIsFrequencyInfoVisible(false)}
      />

      <ConfirmDialog
        visible={pendingDeleteId !== null}
        title="Remove this source?"
        message="It will stop sending its own emails. This can't be undone."
        icon="delete-outline"
        confirmLabel="Remove"
        cancelLabel="Cancel"
        tone="destructive"
        onConfirm={() => {
          if (pendingDeleteId) deleteSource.mutate(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />

      <CustomCinemaPickerModal
        visible={cinemaPickerSourceId !== null}
        initialCinemaIds={cinemaPickerSource?.custom_cinema_ids ?? []}
        onCancel={() => setCinemaPickerSourceId(null)}
        onSave={(cinemaIds) => {
          if (cinemaPickerSourceId) {
            updateSource.mutate({
              sourceId: cinemaPickerSourceId,
              payload: { custom_cinema_ids: cinemaIds },
            });
          }
          setCinemaPickerSourceId(null);
        }}
      />
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

function SourceChip({
  label,
  isActive,
  onPress,
  styles,
}: {
  label: string;
  isActive: boolean;
  onPress: () => void;
  styles: Styles;
}) {
  return (
    <TouchableOpacity
      style={[styles.chip, isActive && styles.chipActive]}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <ThemedText style={[styles.chipText, isActive && styles.chipTextActive]}>
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: { gap: 12 },
    listSection: { gap: 6 },
    label: { fontSize: 11, color: colors.textSecondary },
    addListRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
    addListInput: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      fontSize: 13,
      color: colors.text,
      backgroundColor: colors.pillBackground,
    },
    addListButton: {
      width: 36,
      height: 36,
      borderRadius: 8,
      backgroundColor: colors.tint,
      alignItems: 'center',
      justifyContent: 'center',
    },
    errorText: { fontSize: 12, color: colors.red.secondary },
    sourceCard: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 12,
      padding: 12,
      gap: 10,
      backgroundColor: colors.surfaceMuted,
    },
    sourceHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    sourceTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
    fieldRow: { gap: 6 },
    fieldLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    fieldLabel: { fontSize: 11, color: colors.textSecondary },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      paddingVertical: 6,
      paddingHorizontal: 10,
      backgroundColor: colors.pillBackground,
    },
    chipActive: {
      borderColor: colors.tint,
      backgroundColor: colors.tint,
    },
    chipText: { fontSize: 12, fontWeight: '600', color: colors.text },
    chipTextActive: { color: colors.pillActiveText },
    noticeText: { fontSize: 11, color: colors.textSecondary },
    addSourceButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderWidth: 1,
      borderColor: colors.tint,
      borderRadius: 10,
      paddingVertical: 10,
    },
    addSourceText: { fontSize: 13, fontWeight: '700', color: colors.tint },
  });
