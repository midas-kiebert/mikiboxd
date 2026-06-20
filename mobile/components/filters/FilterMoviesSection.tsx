/**
 * "Filter movies" section of the Filters modal.
 *
 * Every movie-set filter lives here as a card you can set to Include or Exclude:
 * the Letterboxd watchlist / watched, plus Letterboxd *lists* (curated ones such
 * as the Top 500, and custom lists pasted in by the user). Includes combine as a
 * union and excludes are subtracted, so you can e.g. include Watchlist + Top 500
 * while excluding Watched. Each card shows when its data was last synced.
 *
 * Syncing: watchlist/watched refresh automatically on app open; curated lists
 * refresh weekly server-side; custom lists refresh on app open when stale. A
 * manual refresh is only offered when something is more than a day old.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { DateTime } from "luxon";
import { useQueryClient } from "@tanstack/react-query";
import { MeService, type LetterboxdListPublic } from "shared";
import useAuth from "shared/hooks/useAuth";
import {
  useFetchLetterboxdLists,
  useLetterboxdListMutations,
} from "shared/hooks/useLetterboxdLists";

import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { triggerSelectionHaptic } from "@/utils/long-press";

type Colors = ReturnType<typeof useThemeColors>;
type ItemMode = "off" | "include" | "exclude";

type Props = {
  colors: Colors;
  canUseWatchlistFilter: boolean;
  watchlistOnly: boolean;
  setWatchlistOnly: (v: boolean) => void;
  watchlistExclude: boolean;
  setWatchlistExclude: (v: boolean) => void;
  hideWatched: boolean;
  setHideWatched: (v: boolean) => void;
  watchedOnly: boolean;
  setWatchedOnly: (v: boolean) => void;
  selectedListIds: string[];
  setSelectedListIds: (v: string[]) => void;
  excludeListIds: string[];
  setExcludeListIds: (v: string[]) => void;
};

function daysSince(iso: string | null | undefined): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  return DateTime.now().diff(DateTime.fromISO(iso), "days").days;
}

function formatSynced(iso: string | null | undefined): string {
  if (!iso) return "Not synced yet";
  const relative = DateTime.fromISO(iso).toRelative({ style: "short" });
  return relative ? `Synced ${relative}` : "Synced just now";
}

export default function FilterMoviesSection({
  colors,
  canUseWatchlistFilter,
  watchlistOnly,
  setWatchlistOnly,
  watchlistExclude,
  setWatchlistExclude,
  hideWatched,
  setHideWatched,
  watchedOnly,
  setWatchedOnly,
  selectedListIds,
  setSelectedListIds,
  excludeListIds,
  setExcludeListIds,
}: Props) {
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const { data: lists = [], isLoading: listsLoading } = useFetchLetterboxdLists();
  const { addList, syncList, removeList } = useLetterboxdListMutations();

  const [newUrl, setNewUrl] = useState("");
  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [watchlistSyncing, setWatchlistSyncing] = useState(false);
  const [watchedSyncing, setWatchedSyncing] = useState(false);

  // Re-render periodically so the "Synced … ago" labels stay current.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const curatedLists = lists.filter((l) => l.is_curated);
  const customLists = lists.filter((l) => !l.is_curated);

  // ─── Mode helpers ───────────────────────────────────────────────────────────
  const watchlistMode: ItemMode = watchlistOnly
    ? "include"
    : watchlistExclude
      ? "exclude"
      : "off";
  const setWatchlistMode = (mode: ItemMode) => {
    triggerSelectionHaptic();
    setWatchlistOnly(mode === "include");
    setWatchlistExclude(mode === "exclude");
  };

  const watchedMode: ItemMode = watchedOnly ? "include" : hideWatched ? "exclude" : "off";
  const setWatchedMode = (mode: ItemMode) => {
    triggerSelectionHaptic();
    setWatchedOnly(mode === "include");
    setHideWatched(mode === "exclude");
  };

  const listMode = (id: string): ItemMode =>
    selectedListIds.includes(id)
      ? "include"
      : excludeListIds.includes(id)
        ? "exclude"
        : "off";
  const setListMode = (id: string, mode: ItemMode) => {
    triggerSelectionHaptic();
    setSelectedListIds(
      selectedListIds.filter((x) => x !== id).concat(mode === "include" ? [id] : [])
    );
    setExcludeListIds(
      excludeListIds.filter((x) => x !== id).concat(mode === "exclude" ? [id] : [])
    );
  };

  // ─── Actions ────────────────────────────────────────────────────────────────
  const handleAdd = () => {
    const url = newUrl.trim();
    if (!url || addList.isPending) return;
    addList.mutate(url, { onSuccess: () => setNewUrl("") });
  };

  const handleSyncList = (id: string) => {
    if (syncingId) return;
    setSyncingId(id);
    syncList.mutate(id, { onSettled: () => setSyncingId(null) });
  };

  const handleRemoveList = (list: LetterboxdListPublic) => {
    Alert.alert(
      "Remove list?",
      `Remove "${list.title ?? list.list_slug}" from your lists?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            triggerSelectionHaptic();
            setSelectedListIds(selectedListIds.filter((x) => x !== list.id));
            setExcludeListIds(excludeListIds.filter((x) => x !== list.id));
            removeList.mutate(list.id);
          },
        },
      ],
      { cancelable: true }
    );
  };

  const refreshWatch = (
    fn: () => Promise<unknown>,
    setBusy: (b: boolean) => void
  ) => {
    setBusy(true);
    fn()
      .catch(() => {})
      .finally(() => {
        setBusy(false);
        queryClient.invalidateQueries({ queryKey: ["currentUser"] });
        queryClient.invalidateQueries({ queryKey: ["showtimes"] });
        queryClient.invalidateQueries({ queryKey: ["movies"] });
      });
  };

  return (
    <>
      <SubLabel label="Filter movies" colors={colors} />

      {canUseWatchlistFilter && (
        <>
          <FilterItemCard
            title="Watchlist"
            subtitle={formatSynced(user?.watchlist_last_synced)}
            mode={watchlistMode}
            onChangeMode={setWatchlistMode}
            stale={daysSince(user?.watchlist_last_synced) >= 1}
            syncing={watchlistSyncing}
            onSync={() => refreshWatch(() => MeService.syncWatchlist(), setWatchlistSyncing)}
            colors={colors}
          />
          <FilterItemCard
            title="Watched"
            subtitle={formatSynced(user?.watched_last_synced)}
            mode={watchedMode}
            onChangeMode={setWatchedMode}
            stale={daysSince(user?.watched_last_synced) >= 1}
            syncing={watchedSyncing}
            onSync={() => refreshWatch(() => MeService.syncWatched(), setWatchedSyncing)}
            colors={colors}
          />
        </>
      )}

      {/* Curated lists */}
      <MiniLabel label="Curated lists" colors={colors} />
      {listsLoading && curatedLists.length === 0 ? (
        <ActivityIndicator color={colors.tint} style={{ marginVertical: 8 }} />
      ) : (
        curatedLists.map((list) => (
          <ListItemCard
            key={list.id}
            list={list}
            mode={listMode(list.id)}
            onChangeMode={(m) => setListMode(list.id, m)}
            syncing={syncingId === list.id}
            onSync={() => handleSyncList(list.id)}
            colors={colors}
          />
        ))
      )}

      {/* Custom lists */}
      <MiniLabel label="Your lists" colors={colors} />
      {customLists.map((list) => (
        <ListItemCard
          key={list.id}
          list={list}
          mode={listMode(list.id)}
          onChangeMode={(m) => setListMode(list.id, m)}
          syncing={syncingId === list.id}
          onSync={() => handleSyncList(list.id)}
          onRemove={() => handleRemoveList(list)}
          colors={colors}
        />
      ))}
      {customLists.length === 0 && !listsLoading && (
        <ThemedText style={styles.emptyHint}>
          Add any Letterboxd list to filter by it.
        </ThemedText>
      )}

      {/* Add a list */}
      <View style={styles.addRow}>
        <TextInput
          style={styles.addInput}
          value={newUrl}
          onChangeText={setNewUrl}
          placeholder="Paste a Letterboxd list URL"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={handleAdd}
        />
        <TouchableOpacity
          style={[styles.addButton, (!newUrl.trim() || addList.isPending) && styles.addButtonDisabled]}
          onPress={handleAdd}
          disabled={!newUrl.trim() || addList.isPending}
          activeOpacity={0.8}
        >
          {addList.isPending ? (
            <ActivityIndicator size="small" color={colors.pillActiveText} />
          ) : (
            <MaterialIcons name="add" size={18} color={colors.pillActiveText} />
          )}
        </TouchableOpacity>
      </View>
      {addList.isError && (
        <ThemedText style={styles.errorText}>
          Couldn&apos;t add that list. Check the URL and try again.
        </ThemedText>
      )}
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ListItemCard({
  list,
  mode,
  onChangeMode,
  onSync,
  syncing,
  onRemove,
  colors,
}: {
  list: LetterboxdListPublic;
  mode: ItemMode;
  onChangeMode: (mode: ItemMode) => void;
  onSync: () => void;
  syncing: boolean;
  onRemove?: () => void;
  colors: Colors;
}) {
  const subtitle = `${list.film_count} film${list.film_count === 1 ? "" : "s"} · ${formatSynced(list.last_synced)}`;
  return (
    <FilterItemCard
      title={list.title ?? list.list_slug}
      subtitle={subtitle}
      mode={mode}
      onChangeMode={onChangeMode}
      stale={daysSince(list.last_synced) >= 1}
      syncing={syncing}
      onSync={onSync}
      onRemove={onRemove}
      colors={colors}
    />
  );
}

function FilterItemCard({
  title,
  subtitle,
  mode,
  onChangeMode,
  stale,
  syncing,
  onSync,
  onRemove,
  colors,
}: {
  title: string;
  subtitle: string;
  mode: ItemMode;
  onChangeMode: (mode: ItemMode) => void;
  stale?: boolean;
  syncing?: boolean;
  onSync?: () => void;
  onRemove?: () => void;
  colors: Colors;
}) {
  const styles = createStyles(colors);
  const { mode: displayMode, change } = useOptimisticMode(mode, onChangeMode);
  const borderColor =
    displayMode === "include"
      ? colors.green.secondary
      : displayMode === "exclude"
        ? colors.red.secondary
        : colors.divider;
  return (
    <View style={[styles.card, { borderColor }]}>
      <View style={styles.cardTop}>
        <View style={styles.cardTextBlock}>
          <ThemedText style={styles.cardTitle} numberOfLines={1}>
            {title}
          </ThemedText>
          <View style={styles.cardSubtitleRow}>
            <ThemedText style={styles.cardSubtitle} numberOfLines={1}>
              {subtitle}
            </ThemedText>
            {onSync && (stale || syncing) && (
              <TouchableOpacity onPress={onSync} disabled={syncing} hitSlop={8} activeOpacity={0.7}>
                {syncing ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : (
                  <MaterialIcons name="sync" size={14} color={colors.tint} />
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
        {onRemove && (
          <TouchableOpacity onPress={onRemove} hitSlop={8} activeOpacity={0.7} style={styles.removeButton}>
            <MaterialIcons name="close" size={18} color={colors.red.secondary} />
          </TouchableOpacity>
        )}
      </View>
      <IncludeExcludeToggle mode={displayMode} onChange={change} colors={colors} />
    </View>
  );
}

/**
 * Optimistic mode for a filter card. The green/red fill repaints on the same
 * frame as the tap; the real `onChange` — which re-filters the entire movie
 * list — is deferred by one frame so the colour never waits on that work. Once
 * the incoming prop catches up to our optimistic value, we drop the override.
 */
function useOptimisticMode(mode: ItemMode, onChange: (mode: ItemMode) => void) {
  const [optimistic, setOptimistic] = useState<ItemMode | null>(null);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    if (optimistic !== null && mode === optimistic) setOptimistic(null);
  }, [mode, optimistic]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    []
  );

  const change = useCallback(
    (next: ItemMode) => {
      setOptimistic(next);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = null;
        onChange(next);
      });
    },
    [onChange]
  );

  return { mode: optimistic ?? mode, change };
}

function IncludeExcludeToggle({
  mode,
  onChange,
  colors,
}: {
  mode: ItemMode;
  onChange: (mode: ItemMode) => void;
  colors: Colors;
}) {
  const styles = createStyles(colors);
  return (
    <View style={styles.toggleRow}>
      <Segment
        label="Show"
        icon="visibility"
        active={mode === "include"}
        activeBg={colors.green.primary}
        activeFg={colors.green.secondary}
        onPress={() => onChange(mode === "include" ? "off" : "include")}
        colors={colors}
      />
      <Segment
        label="Hide"
        icon="visibility-off"
        active={mode === "exclude"}
        activeBg={colors.red.primary}
        activeFg={colors.red.secondary}
        onPress={() => onChange(mode === "exclude" ? "off" : "exclude")}
        colors={colors}
      />
    </View>
  );
}

function Segment({
  label,
  icon,
  active,
  activeBg,
  activeFg,
  onPress,
  colors,
}: {
  label: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  active: boolean;
  activeBg: string;
  activeFg: string;
  onPress: () => void;
  colors: Colors;
}) {
  const styles = createStyles(colors);
  const fg = active ? activeFg : colors.pillText;
  return (
    <Pressable
      // `pressed` updates synchronously on touch-down, so the segment dims
      // instantly even while the movie list re-filters in the background.
      style={({ pressed }) => [
        styles.segment,
        { backgroundColor: active ? activeBg : colors.pillBackground },
        pressed && styles.segmentPressed,
      ]}
      android_ripple={{ color: fg }}
      onPress={onPress}
    >
      <MaterialIcons name={icon} size={15} color={fg} />
      <ThemedText style={[styles.segmentLabel, { color: fg }]}>{label}</ThemedText>
    </Pressable>
  );
}

function SubLabel({ label, colors }: { label: string; colors: Colors }) {
  return (
    <ThemedText
      style={{
        color: colors.textSecondary,
        fontSize: 11,
        fontWeight: "600",
        textTransform: "uppercase",
        letterSpacing: 0.6,
        marginBottom: 7,
      }}
    >
      {label}
    </ThemedText>
  );
}

function MiniLabel({ label, colors }: { label: string; colors: Colors }) {
  return (
    <ThemedText style={{ color: colors.text, fontSize: 13, fontWeight: "600", marginTop: 14, marginBottom: 8 }}>
      {label}
    </ThemedText>
  );
}

const createStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 8,
      gap: 8,
    },
    cardTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    cardTextBlock: { flex: 1 },
    cardTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
    cardSubtitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 1 },
    cardSubtitle: { fontSize: 12, color: colors.textSecondary, flexShrink: 1 },
    removeButton: { padding: 2 },
    toggleRow: { flexDirection: "row", gap: 6 },
    segment: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      paddingVertical: 8,
      borderRadius: 10,
      overflow: "hidden",
    },
    segmentPressed: { opacity: 0.55 },
    segmentLabel: { fontSize: 12.5, fontWeight: "700" },
    emptyHint: { fontSize: 12, color: colors.textSecondary, marginBottom: 8 },
    addRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
    addInput: {
      flex: 1,
      paddingHorizontal: 12,
      paddingVertical: 9,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      color: colors.text,
      fontSize: 13,
    },
    addButton: {
      width: 40,
      height: 40,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.tint,
    },
    addButtonDisabled: { opacity: 0.4 },
    errorText: { fontSize: 12, color: colors.red.secondary, marginTop: 6 },
  });
