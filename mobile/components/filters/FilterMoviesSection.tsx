/**
 * "Filter movies" section of the Filters modal.
 *
 * Groups every movie-set filter in one place: the Letterboxd watchlist /
 * watched toggles and the Letterboxd *lists* (curated ones such as the
 * Letterboxd Top 500, plus custom lists the user pastes in). Each option shows
 * when its underlying Letterboxd data was last synced.
 */
import { useState } from "react";
import { ActivityIndicator, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
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

type Props = {
  colors: Colors;
  canUseWatchlistFilter: boolean;
  watchlistOnly: boolean;
  setWatchlistOnly: (v: boolean) => void;
  hideWatched: boolean;
  setHideWatched: (v: boolean) => void;
  selectedListIds: string[];
  setSelectedListIds: (v: string[]) => void;
};

function formatSynced(iso: string | null | undefined): string {
  if (!iso) return "Not synced yet";
  const relative = DateTime.fromISO(iso).toRelative({ style: "short" });
  return relative ? `Synced ${relative}` : "Synced";
}

export default function FilterMoviesSection({
  colors,
  canUseWatchlistFilter,
  watchlistOnly,
  setWatchlistOnly,
  hideWatched,
  setHideWatched,
  selectedListIds,
  setSelectedListIds,
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

  const curatedLists = lists.filter((l) => l.is_curated);
  const customLists = lists.filter((l) => !l.is_curated);

  const toggleList = (id: string) => {
    triggerSelectionHaptic();
    if (selectedListIds.includes(id)) {
      setSelectedListIds(selectedListIds.filter((x) => x !== id));
    } else {
      setSelectedListIds([...selectedListIds, id]);
    }
  };

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

  const handleRemoveList = (id: string) => {
    triggerSelectionHaptic();
    if (selectedListIds.includes(id)) {
      setSelectedListIds(selectedListIds.filter((x) => x !== id));
    }
    removeList.mutate(id);
  };

  const syncWatchlist = () => {
    if (watchlistSyncing) return;
    setWatchlistSyncing(true);
    MeService.syncWatchlist()
      .catch(() => {})
      .finally(() => {
        setWatchlistSyncing(false);
        queryClient.invalidateQueries({ queryKey: ["currentUser"] });
        queryClient.invalidateQueries({ queryKey: ["showtimes"] });
        queryClient.invalidateQueries({ queryKey: ["movies"] });
      });
  };

  const syncWatched = () => {
    if (watchedSyncing) return;
    setWatchedSyncing(true);
    MeService.syncWatched()
      .catch(() => {})
      .finally(() => {
        setWatchedSyncing(false);
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
          <View style={styles.pillRow}>
            <Pill label="All movies" active={!watchlistOnly} onPress={() => setWatchlistOnly(false)} colors={colors} />
            <Pill label="Watchlisted only" active={watchlistOnly} onPress={() => setWatchlistOnly(true)} colors={colors} />
            <Pill label="Hide watched" active={hideWatched} onPress={() => setHideWatched(!hideWatched)} colors={colors} />
          </View>
          <SyncStatusRow
            label="Watchlist"
            iso={user?.watchlist_last_synced}
            syncing={watchlistSyncing}
            onSync={syncWatchlist}
            colors={colors}
          />
          <SyncStatusRow
            label="Watched"
            iso={user?.watched_last_synced}
            syncing={watchedSyncing}
            onSync={syncWatched}
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
          <ListCard
            key={list.id}
            list={list}
            selected={selectedListIds.includes(list.id)}
            onToggle={() => toggleList(list.id)}
            colors={colors}
          />
        ))
      )}

      {/* Custom lists */}
      <MiniLabel label="Your lists" colors={colors} />
      {customLists.map((list) => (
        <ListCard
          key={list.id}
          list={list}
          selected={selectedListIds.includes(list.id)}
          onToggle={() => toggleList(list.id)}
          onSync={() => handleSyncList(list.id)}
          syncing={syncingId === list.id}
          onRemove={() => handleRemoveList(list.id)}
          colors={colors}
        />
      ))}
      {customLists.length === 0 && !listsLoading && (
        <ThemedText style={styles.emptyHint}>
          Add any Letterboxd list to filter by it.
        </ThemedText>
      )}

      {/* Add list */}
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

function ListCard({
  list,
  selected,
  onToggle,
  onSync,
  syncing,
  onRemove,
  colors,
}: {
  list: LetterboxdListPublic;
  selected: boolean;
  onToggle: () => void;
  onSync?: () => void;
  syncing?: boolean;
  onRemove?: () => void;
  colors: Colors;
}) {
  const styles = createStyles(colors);
  return (
    <View style={[styles.listCard, selected && styles.listCardActive]}>
      <TouchableOpacity style={styles.listCardMain} onPress={onToggle} activeOpacity={0.8}>
        <MaterialIcons
          name={selected ? "check-circle" : "radio-button-unchecked"}
          size={20}
          color={selected ? colors.tint : colors.textSecondary}
        />
        <View style={styles.listCardTextBlock}>
          <ThemedText style={styles.listCardTitle} numberOfLines={1}>
            {list.title ?? list.list_slug}
          </ThemedText>
          <ThemedText style={styles.listCardSubtitle} numberOfLines={1}>
            {list.film_count} film{list.film_count === 1 ? "" : "s"} · {formatSynced(list.last_synced)}
          </ThemedText>
        </View>
      </TouchableOpacity>
      {onSync && (
        <TouchableOpacity style={styles.listCardAction} onPress={onSync} disabled={syncing} activeOpacity={0.7}>
          {syncing ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <MaterialIcons name="sync" size={18} color={colors.textSecondary} />
          )}
        </TouchableOpacity>
      )}
      {onRemove && (
        <TouchableOpacity style={styles.listCardAction} onPress={onRemove} activeOpacity={0.7}>
          <MaterialIcons name="close" size={18} color={colors.red.secondary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

function SyncStatusRow({
  label,
  iso,
  syncing,
  onSync,
  colors,
}: {
  label: string;
  iso: string | null | undefined;
  syncing: boolean;
  onSync: () => void;
  colors: Colors;
}) {
  const styles = createStyles(colors);
  return (
    <TouchableOpacity style={styles.syncStatusRow} onPress={onSync} disabled={syncing} activeOpacity={0.7}>
      <ThemedText style={styles.syncStatusText}>
        {label} · {formatSynced(iso)}
      </ThemedText>
      {syncing ? (
        <ActivityIndicator size="small" color={colors.textSecondary} />
      ) : (
        <MaterialIcons name="sync" size={14} color={colors.textSecondary} />
      )}
    </TouchableOpacity>
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

function Pill({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: Colors;
}) {
  return (
    <TouchableOpacity
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 16,
        backgroundColor: active ? colors.pillActiveBackground : colors.pillBackground,
        marginRight: 7,
        marginBottom: 7,
      }}
      onPress={onPress}
      activeOpacity={0.8}
    >
      <ThemedText style={{ fontSize: 13, fontWeight: "500", color: active ? colors.pillActiveText : colors.pillText }}>
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
}

const createStyles = (colors: Colors) =>
  StyleSheet.create({
    pillRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center" },
    syncStatusRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 4,
    },
    syncStatusText: { fontSize: 12, color: colors.textSecondary },
    listCard: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      marginBottom: 8,
      paddingRight: 4,
    },
    listCardActive: { borderColor: colors.tint },
    listCardMain: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    listCardTextBlock: { flex: 1 },
    listCardTitle: { fontSize: 14, fontWeight: "600", color: colors.text },
    listCardSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
    listCardAction: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
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
