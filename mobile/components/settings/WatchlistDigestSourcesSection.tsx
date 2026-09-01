/**
 * The "advanced" body of the watchlist digest settings: a user may have any
 * number of digest sources, each an independent {frequency, list/watchlist,
 * cinema restriction} rule (see `services/watchlist_digest.py` on the
 * backend, which sends each source's email on its own schedule). The master
 * on/off switch lives above this in `settings.tsx`; everything here only
 * renders once that switch is on.
 *
 * A new source is drafted locally — `draft` below — until "Save source" is
 * pressed; cancelling it never reaches the backend. Saved sources render as
 * a compact one-line summary with their own "Edit" toggle, so the panel
 * stays scannable once someone has more than one.
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
import {
  type CinemaPresetPublic,
  type DigestFrequency,
  type LetterboxdListPublic,
  UtilsService,
  type WatchlistDigestSourcePublic,
} from 'shared';
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

type SourceDraft = {
  frequency: DigestFrequency;
  list_id: string | null;
  cinema_preset_id: string | null;
  custom_cinema_ids: number[] | null;
};

const makeEmptyDraft = (): SourceDraft => ({
  frequency: 'weekly_or_urgent',
  list_id: null,
  cinema_preset_id: null,
  custom_cinema_ids: null,
});

function summarizeSource(
  source: WatchlistDigestSourcePublic,
  digestLists: readonly LetterboxdListPublic[],
  cinemaPresets: readonly CinemaPresetPublic[],
  letterboxdUsername: string | null
): string {
  const frequencyLabel = source.frequency === 'daily' ? 'Eager' : 'Weekly';

  let listLabel: string;
  if (source.list_id) {
    const list = digestLists.find((candidate) => candidate.id === source.list_id);
    listLabel = list ? (list.title ?? list.list_slug) : 'a list';
  } else {
    listLabel = letterboxdUsername ? 'My watchlist' : 'No watchlist connected';
  }

  let cinemaLabel = 'All cinemas';
  if (source.cinema_preset_id) {
    const preset = cinemaPresets.find((candidate) => candidate.id === source.cinema_preset_id);
    cinemaLabel = preset ? preset.name : 'a cinema preset';
  } else if (source.custom_cinema_ids && source.custom_cinema_ids.length > 0) {
    cinemaLabel = `${source.custom_cinema_ids.length} cinema${
      source.custom_cinema_ids.length === 1 ? '' : 's'
    }`;
  }

  return `${frequencyLabel} · ${listLabel} · ${cinemaLabel}`;
}

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

  const [isFrequencyInfoVisible, setIsFrequencyInfoVisible] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // 'draft' targets the not-yet-saved source below; any other value is a
  // saved source's id.
  const [cinemaPickerTarget, setCinemaPickerTarget] = useState<string | null>(null);

  const [isAddingSource, setIsAddingSource] = useState(false);
  const [draft, setDraft] = useState<SourceDraft>(makeEmptyDraft);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);

  const { data: frequencyInfo } = useQuery({
    queryKey: ['watchlist-digest-frequency-info'],
    queryFn: () => UtilsService.getWatchlistDigestFrequencyInfo(),
    enabled: shouldLoad,
    staleTime: Infinity,
  });

  const favoriteCinemaPreset = findMyCinemasPreset(cinemaPresets);
  const namedCinemaPresets = findNamedCinemaPresets(cinemaPresets);

  const handleStartAddSource = useCallback(() => {
    setDraft(makeEmptyDraft());
    setIsAddingSource(true);
  }, []);

  const handleCancelAddSource = useCallback(() => {
    setIsAddingSource(false);
  }, []);

  const handleSaveDraftSource = useCallback(() => {
    createSource.mutate(
      {
        frequency: draft.frequency,
        list_id: draft.list_id,
        cinema_preset_id: draft.cinema_preset_id,
        custom_cinema_ids: draft.custom_cinema_ids,
      },
      { onSuccess: () => setIsAddingSource(false) }
    );
  }, [createSource, draft]);

  const cinemaPickerInitialIds =
    cinemaPickerTarget === 'draft'
      ? (draft.custom_cinema_ids ?? [])
      : (sources.find((source) => source.id === cinemaPickerTarget)?.custom_cinema_ids ?? []);

  return (
    <View style={styles.container}>
      <ThemedText style={styles.explainerText}>
        A source is one rule for this digest: which movies to watch for — your
        Letterboxd watchlist, or a list you pick — and which cinemas to check
        them at. You can have up to {MAX_SOURCES}, each on its own schedule.
      </ThemedText>

      {sources.map((source) => {
        const isExpanded = expandedSourceId === source.id;
        return (
          <View key={source.id} style={styles.sourceCard}>
            <View style={styles.sourceHeaderRow}>
              <ThemedText style={styles.sourceSummary} numberOfLines={1}>
                {summarizeSource(source, digestLists, cinemaPresets, letterboxdUsername)}
              </ThemedText>
              <View style={styles.sourceHeaderActions}>
                <TouchableOpacity
                  onPress={() => setExpandedSourceId(isExpanded ? null : source.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={isExpanded ? 'Done editing this source' : 'Edit this source'}
                >
                  <MaterialIcons
                    name={isExpanded ? 'check' : 'edit'}
                    size={18}
                    color={colors.tint}
                  />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setPendingDeleteId(source.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Remove this source"
                >
                  <MaterialIcons name="delete-outline" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>
            </View>

            {isExpanded ? (
              <SourceFieldsEditor
                colors={colors}
                styles={styles}
                frequency={source.frequency}
                listId={source.list_id}
                cinemaPresetId={source.cinema_preset_id}
                customCinemaIds={source.custom_cinema_ids}
                letterboxdUsername={letterboxdUsername}
                digestLists={digestLists}
                favoriteCinemaPreset={favoriteCinemaPreset}
                namedCinemaPresets={namedCinemaPresets}
                addList={addList}
                onChangeFrequency={(frequency) =>
                  updateSource.mutate({ sourceId: source.id, payload: { frequency } })
                }
                onChangeList={(listId) =>
                  updateSource.mutate({ sourceId: source.id, payload: { list_id: listId } })
                }
                onChangeCinemaPreset={(cinemaPresetId) =>
                  updateSource.mutate({
                    sourceId: source.id,
                    payload: { cinema_preset_id: cinemaPresetId, custom_cinema_ids: null },
                  })
                }
                onOpenCustomCinemaPicker={() => setCinemaPickerTarget(source.id)}
                onShowFrequencyInfo={() => setIsFrequencyInfoVisible(true)}
                disabled={updateSource.isPending}
              />
            ) : null}
          </View>
        );
      })}

      {isAddingSource ? (
        <View style={[styles.sourceCard, styles.draftCard]}>
          <ThemedText style={styles.draftTitle}>New source</ThemedText>
          <SourceFieldsEditor
            colors={colors}
            styles={styles}
            frequency={draft.frequency}
            listId={draft.list_id}
            cinemaPresetId={draft.cinema_preset_id}
            customCinemaIds={draft.custom_cinema_ids}
            letterboxdUsername={letterboxdUsername}
            digestLists={digestLists}
            favoriteCinemaPreset={favoriteCinemaPreset}
            namedCinemaPresets={namedCinemaPresets}
            addList={addList}
            onChangeFrequency={(frequency) => setDraft((current) => ({ ...current, frequency }))}
            onChangeList={(listId) => setDraft((current) => ({ ...current, list_id: listId }))}
            onChangeCinemaPreset={(cinemaPresetId) =>
              setDraft((current) => ({
                ...current,
                cinema_preset_id: cinemaPresetId,
                custom_cinema_ids: null,
              }))
            }
            onOpenCustomCinemaPicker={() => setCinemaPickerTarget('draft')}
            onShowFrequencyInfo={() => setIsFrequencyInfoVisible(true)}
            disabled={createSource.isPending}
          />
          <View style={styles.draftActionsRow}>
            <TouchableOpacity
              style={styles.draftCancelButton}
              onPress={handleCancelAddSource}
              disabled={createSource.isPending}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.draftCancelText}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.draftSaveButton}
              onPress={handleSaveDraftSource}
              disabled={createSource.isPending}
              activeOpacity={0.8}
            >
              {createSource.isPending ? (
                <ActivityIndicator size="small" color={colors.pillActiveText} />
              ) : (
                <ThemedText style={styles.draftSaveText}>Save source</ThemedText>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : sources.length < MAX_SOURCES ? (
        <TouchableOpacity
          style={styles.addSourceButton}
          onPress={handleStartAddSource}
          activeOpacity={0.8}
        >
          <MaterialIcons name="add" size={16} color={colors.tint} />
          <ThemedText style={styles.addSourceText}>Add a source</ThemedText>
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
          if (pendingDeleteId) {
            deleteSource.mutate(pendingDeleteId);
            if (expandedSourceId === pendingDeleteId) setExpandedSourceId(null);
          }
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />

      <CustomCinemaPickerModal
        visible={cinemaPickerTarget !== null}
        initialCinemaIds={cinemaPickerInitialIds}
        onCancel={() => setCinemaPickerTarget(null)}
        onSave={(cinemaIds) => {
          if (cinemaPickerTarget === 'draft') {
            setDraft((current) => ({ ...current, custom_cinema_ids: cinemaIds }));
          } else if (cinemaPickerTarget) {
            updateSource.mutate({
              sourceId: cinemaPickerTarget,
              payload: { custom_cinema_ids: cinemaIds },
            });
          }
          setCinemaPickerTarget(null);
        }}
      />
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;
type AddListMutation = ReturnType<typeof useLetterboxdListMutations>['addList'];

/** The {frequency, list, cinemas} fields shared by a draft and an expanded,
 * already-saved source — every change here calls straight back to the
 * caller, which decides whether that means updating local draft state or
 * PATCHing the real source. */
function SourceFieldsEditor({
  colors,
  styles,
  frequency,
  listId,
  cinemaPresetId,
  customCinemaIds,
  letterboxdUsername,
  digestLists,
  favoriteCinemaPreset,
  namedCinemaPresets,
  addList,
  onChangeFrequency,
  onChangeList,
  onChangeCinemaPreset,
  onOpenCustomCinemaPicker,
  onShowFrequencyInfo,
  disabled,
}: {
  colors: ReturnType<typeof useThemeColors>;
  styles: Styles;
  frequency: DigestFrequency;
  listId: string | null;
  cinemaPresetId: string | null;
  customCinemaIds: number[] | null;
  letterboxdUsername: string | null;
  digestLists: readonly LetterboxdListPublic[];
  favoriteCinemaPreset: CinemaPresetPublic | null;
  namedCinemaPresets: readonly CinemaPresetPublic[];
  addList: AddListMutation;
  onChangeFrequency: (frequency: DigestFrequency) => void;
  onChangeList: (listId: string | null) => void;
  onChangeCinemaPreset: (cinemaPresetId: string | null) => void;
  onOpenCustomCinemaPicker: () => void;
  onShowFrequencyInfo: () => void;
  disabled: boolean;
}) {
  const [listUrl, setListUrl] = useState('');

  const handleAddList = useCallback(() => {
    const url = listUrl.trim();
    if (!url) return;
    addList.mutate(url, { onSuccess: () => setListUrl('') });
  }, [addList, listUrl]);

  return (
    <>
      <View style={styles.fieldRow}>
        <View style={styles.fieldLabelRow}>
          <ThemedText style={styles.fieldLabel}>Frequency</ThemedText>
          <TouchableOpacity
            onPress={onShowFrequencyInfo}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="What do Eager and Weekly mean?"
          >
            <MaterialIcons name="info-outline" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>
        <SegmentedControl
          options={DIGEST_FREQUENCY_OPTIONS}
          value={frequency}
          onChange={onChangeFrequency}
          accessibilityLabelPrefix="Frequency"
          disabled={disabled}
        />
      </View>

      <View style={styles.fieldRow}>
        <ThemedText style={styles.fieldLabel}>List</ThemedText>
        <View style={styles.chipRow}>
          {letterboxdUsername ? (
            <SourceChip
              label="My watchlist"
              isActive={listId === null}
              onPress={() => onChangeList(null)}
              styles={styles}
            />
          ) : null}
          {digestLists.map((list) => (
            <SourceChip
              key={list.id}
              label={`${list.title ?? list.list_slug}${list.is_curated ? ' (curated)' : ''}`}
              isActive={listId === list.id}
              onPress={() => onChangeList(list.id)}
              styles={styles}
            />
          ))}
        </View>
        {!letterboxdUsername && !listId ? (
          <ThemedText style={styles.noticeText}>
            No watchlist connected — connect Letterboxd above, or pick a list below.
          </ThemedText>
        ) : null}
        <View style={styles.addListRow}>
          <TextInput
            style={styles.addListInput}
            placeholder="Paste a Letterboxd list URL"
            placeholderTextColor={colors.textSecondary}
            autoCapitalize="none"
            keyboardType="url"
            value={listUrl}
            onChangeText={setListUrl}
          />
          <TouchableOpacity
            style={styles.addListButton}
            onPress={handleAddList}
            disabled={!listUrl.trim() || addList.isPending}
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

      <View style={styles.fieldRow}>
        <ThemedText style={styles.fieldLabel}>Cinemas</ThemedText>
        <View style={styles.chipRow}>
          <SourceChip
            label="All cinemas"
            isActive={!cinemaPresetId && !customCinemaIds}
            onPress={() => onChangeCinemaPreset(null)}
            styles={styles}
          />
          {favoriteCinemaPreset ? (
            <SourceChip
              label={`Default (${favoriteCinemaPreset.name})`}
              isActive={cinemaPresetId === favoriteCinemaPreset.id}
              onPress={() => onChangeCinemaPreset(favoriteCinemaPreset.id)}
              styles={styles}
            />
          ) : null}
          {namedCinemaPresets.map((preset) => (
            <SourceChip
              key={preset.id}
              label={preset.name}
              isActive={cinemaPresetId === preset.id}
              onPress={() => onChangeCinemaPreset(preset.id)}
              styles={styles}
            />
          ))}
          <SourceChip
            label={customCinemaIds ? `Custom (${customCinemaIds.length})` : 'Custom cinemas…'}
            isActive={!!customCinemaIds}
            onPress={onOpenCustomCinemaPicker}
            styles={styles}
          />
        </View>
      </View>
    </>
  );
}

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
    explainerText: { fontSize: 12, color: colors.textSecondary, lineHeight: 17 },
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
    draftCard: {
      borderColor: colors.tint,
      borderStyle: 'dashed',
    },
    draftTitle: { fontSize: 13, fontWeight: '700', color: colors.text },
    draftActionsRow: { flexDirection: 'row', gap: 8 },
    draftCancelButton: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    draftCancelText: { fontSize: 13, fontWeight: '700', color: colors.textSecondary },
    draftSaveButton: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      borderRadius: 10,
      backgroundColor: colors.tint,
    },
    draftSaveText: { fontSize: 13, fontWeight: '700', color: colors.pillActiveText },
    sourceHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
    },
    sourceHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    sourceSummary: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.text },
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
