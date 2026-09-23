/**
 * The film filters of the Filters modal, in two parts: `LetterboxdWatchFilters`
 * is the body of the "Letterboxd" section, and `LetterboxdListFilters` (the
 * default export) the lists block inside "More filters".
 *
 * Without a Letterboxd username the watchlist/watched cards have nothing to
 * work with, so their place is taken by a prompt for that username.
 *
 * Every movie-set filter lives here as a one-line card. The watchlist and
 * watched cards do one thing each — only films on the watchlist, hide films
 * already seen. A Letterboxd *list* card (curated ones such as the Top 500, and
 * custom lists pasted in by the user) does two: ticking its checkbox includes
 * the list, the smaller "Hide" button next to it excludes it. Includes combine
 * as a union and excludes are subtracted. The checkbox carries the common case
 * and Hide is deliberately the quieter control — a card can only be in one of
 * the two states, so ticking clears a hide and vice versa. Each card shows when
 * its data was last synced.
 *
 * Syncing: watchlist/watched refresh automatically on app open; curated lists
 * refresh weekly server-side; custom lists refresh on app open when stale. A
 * manual refresh is only offered when something is more than a day old.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, StyleSheet, TextInput, TouchableOpacity, View } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { DateTime } from "luxon";
import { useQueryClient } from "@tanstack/react-query";
import { MeService, type LetterboxdListPublic } from "shared";
import useAuth from "shared/hooks/useAuth";
import {
  useFetchCuratedLetterboxdLists,
  useFetchLetterboxdLists,
  useLetterboxdListMutations,
} from "shared/hooks/useLetterboxdLists";

import { FilterSubLabel } from "@/components/filters/FilterSection";
import LetterboxdUsernamePrompt from "@/components/filters/LetterboxdUsernamePrompt";
import SignedOutPanel from "@/components/auth/SignedOutPanel";
import { useIsSignedIn } from "@/utils/auth-session";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useOptimisticValue } from "@/hooks/useOptimisticValue";
import { triggerSelectionHaptic } from "@/utils/long-press";

type Colors = ReturnType<typeof useThemeColors>;
type ItemMode = "off" | "include" | "exclude";

type WatchProps = {
  colors: Colors;
  canUseWatchlistFilter: boolean;
  watchlistOnly: boolean;
  setWatchlistOnly: (v: boolean) => void;
  setWatchlistExclude: (v: boolean) => void;
  hideWatched: boolean;
  setHideWatched: (v: boolean) => void;
  setWatchedOnly: (v: boolean) => void;
};

type ListProps = {
  colors: Colors;
  /** The first block of its section, so no gap above its heading. */
  isFirst?: boolean;
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

/** Re-render periodically so the "Synced … ago" labels stay current. */
function useSyncedLabelTick() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);
}

function invalidateWatchData(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["currentUser"] });
  queryClient.invalidateQueries({ queryKey: ["showtimes"] });
  queryClient.invalidateQueries({ queryKey: ["movies"] });
}

/**
 * The Letterboxd section: watchlist and watched. Without a username linked, a
 * prompt for one takes their place; a guest gets the sign-in card instead.
 */
export function LetterboxdWatchFilters({
  colors,
  canUseWatchlistFilter,
  watchlistOnly,
  setWatchlistOnly,
  setWatchlistExclude,
  hideWatched,
  setHideWatched,
  setWatchedOnly,
}: WatchProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSignedIn = useIsSignedIn();
  const [watchlistSyncing, setWatchlistSyncing] = useState(false);
  const [watchedSyncing, setWatchedSyncing] = useState(false);
  useSyncedLabelTick();

  // One direction each: only your watchlist, or hide what you've seen. The
  // other two (hide the watchlist, only what you've seen) were too niche for
  // the confusion they added. Setting one also clears its retired opposite,
  // which an older quick filter may still carry.
  const setWatchlistMode = (mode: ItemMode) => {
    triggerSelectionHaptic();
    setWatchlistOnly(mode === "include");
    setWatchlistExclude(false);
  };
  const setWatchedMode = (mode: ItemMode) => {
    triggerSelectionHaptic();
    setHideWatched(mode === "exclude");
    setWatchedOnly(false);
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
        invalidateWatchData(queryClient);
      });
  };

  if (!isSignedIn) {
    // Connecting Letterboxd writes a username onto an account, so there is
    // nothing to offer a guest here but the account itself.
    return <SignedOutPanel variant="card" feature="letterboxd" />;
  }
  if (!canUseWatchlistFilter) return <LetterboxdUsernamePrompt />;

  return (
    <>
      <FilterItemCard
        title="Only films on my watchlist"
        subtitle={formatSynced(user?.watchlist_last_synced)}
        singleMode="include"
        mode={watchlistOnly ? "include" : "off"}
        onChangeMode={setWatchlistMode}
        stale={daysSince(user?.watchlist_last_synced) >= 1}
        syncing={watchlistSyncing}
        onSync={() => refreshWatch(() => MeService.syncWatchlist(), setWatchlistSyncing)}
        colors={colors}
      />
      <FilterItemCard
        title="Hide films I've already seen"
        subtitle={formatSynced(user?.watched_last_synced)}
        singleMode="exclude"
        mode={hideWatched ? "exclude" : "off"}
        onChangeMode={setWatchedMode}
        stale={daysSince(user?.watched_last_synced) >= 1}
        syncing={watchedSyncing}
        onSync={() => refreshWatch(() => MeService.syncWatched(), setWatchedSyncing)}
        colors={colors}
      />
    </>
  );
}

/** Letterboxd lists — curated ones, and the user's own — for "More filters". */
export default function LetterboxdListFilters({
  colors,
  isFirst = false,
  selectedListIds,
  setSelectedListIds,
  excludeListIds,
  setExcludeListIds,
}: ListProps) {
  const styles = createStyles(colors);
  const { user } = useAuth();

  // Two sources, one shape. The account endpoint answers with the user's own
  // lists *and* the curated ones; without an account only the curated half
  // exists, and it is public — filtering by the Top 250 is browsing, not an
  // account feature. `user` is undefined for a signed-out visitor.
  const isSignedIn = useIsSignedIn();
  const accountLists = useFetchLetterboxdLists(Boolean(user));
  const curatedOnly = useFetchCuratedLetterboxdLists(!isSignedIn);
  const lists = (isSignedIn ? accountLists.data : curatedOnly.data) ?? [];
  const listsLoading = isSignedIn ? accountLists.isLoading : curatedOnly.isLoading;
  const { addList, syncList, removeList } = useLetterboxdListMutations();

  const [newUrl, setNewUrl] = useState("");
  const [syncingId, setSyncingId] = useState<string | null>(null);
  useSyncedLabelTick();

  const curatedLists = lists.filter((l) => l.is_curated);
  const customLists = lists.filter((l) => !l.is_curated);

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

  return (
    <>
      <FilterSubLabel label="Curated lists" isFirst={isFirst} />
      <ModeHint colors={colors} />
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

      {/* Custom lists — adding one attaches it to an account, so this whole
          half of the section belongs to signed-in users. A guest gets the
          curated lists above and no mention of the rest. */}
      {isSignedIn ? (
        <>
        <FilterSubLabel label="Your lists" />
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
      ) : null}
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ModeHint({ colors }: { colors: Colors }) {
  const styles = createStyles(colors);
  return (
    <ThemedText style={styles.modeHint}>
      Tick a list to show only its films · Hide to leave them out
    </ThemedText>
  );
}

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
  singleMode,
  colors,
}: {
  title: string;
  subtitle: string;
  mode: ItemMode;
  /**
   * A card with one thing to do rather than two: the row toggles this mode, and
   * there is no separate Hide button. The title says what it does.
   */
  singleMode?: "include" | "exclude";
  onChangeMode: (mode: ItemMode) => void;
  stale?: boolean;
  syncing?: boolean;
  onSync?: () => void;
  onRemove?: () => void;
  colors: Colors;
}) {
  const styles = createStyles(colors);
  const { value: displayMode, change } = useOptimisticValue(mode, onChangeMode);
  const isOn = singleMode ? displayMode === singleMode : displayMode === "include";
  const included = singleMode ? isOn : displayMode === "include";
  const excluded = singleMode ? false : displayMode === "exclude";
  const rowMode: ItemMode = singleMode ?? "include";
  const borderColor = included
    ? colors.green.border
    : excluded
      ? colors.red.border
      : colors.divider;
  return (
    <View style={[styles.card, { borderColor }]}>
      {/* The checkbox and the text next to it are one target: ticking a list is
          the common case, so it gets the widest half of the row. */}
      <Pressable
        // `pressed` updates synchronously on touch-down, so the row dims
        // instantly even while the movie list re-filters in the background.
        style={({ pressed }) => [styles.selectRow, pressed && styles.pressed]}
        onPress={() => change(included ? "off" : rowMode)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: included }}
        accessibilityLabel={singleMode ? title : `Show only films from ${title}`}
      >
        <View style={[styles.checkbox, included && styles.checkboxChecked]}>
          {included && (
            <MaterialIcons name="check" size={14} color={colors.pillActiveText} />
          )}
        </View>
        <View style={[styles.cardTextBlock, excluded && styles.cardTextBlockExcluded]}>
          <ThemedText style={styles.cardTitle} numberOfLines={1}>
            {title}
          </ThemedText>
          <ThemedText style={styles.cardSubtitle} numberOfLines={1}>
            {subtitle}
          </ThemedText>
        </View>
      </Pressable>
      {onSync && (stale || syncing) && (
        <TouchableOpacity onPress={onSync} disabled={syncing} hitSlop={8} activeOpacity={0.7}>
          {syncing ? (
            <ActivityIndicator size="small" color={colors.textSecondary} />
          ) : (
            <MaterialIcons name="sync" size={16} color={colors.tint} />
          )}
        </TouchableOpacity>
      )}
      {!singleMode && (
        <HideButton
          active={excluded}
          onPress={() => change(excluded ? "off" : "exclude")}
          colors={colors}
        />
      )}
      {onRemove && (
        <TouchableOpacity onPress={onRemove} hitSlop={8} activeOpacity={0.7}>
          <MaterialIcons name="close" size={16} color={colors.textSecondary} />
        </TouchableOpacity>
      )}
    </View>
  );
}

/**
 * The secondary half of a card's control: excluding a list is the rarer wish,
 * so it stays a labelled ghost button rather than a second checkbox — an
 * unlabelled eye icon would read as "preview", not "leave these out".
 */
function HideButton({
  active,
  onPress,
  colors,
}: {
  active: boolean;
  onPress: () => void;
  colors: Colors;
}) {
  const styles = createStyles(colors);
  const fg = active ? colors.red.secondary : colors.pillText;
  return (
    <Pressable
      style={({ pressed }) => [
        styles.hideButton,
        active ? styles.hideButtonActive : styles.hideButtonIdle,
        pressed && styles.pressed,
      ]}
      android_ripple={{ color: fg }}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={active ? "Stop hiding these films" : "Hide these films"}
    >
      <MaterialIcons name="visibility-off" size={13} color={fg} />
      <ThemedText style={[styles.hideLabel, { color: fg }]}>Hide</ThemedText>
    </Pressable>
  );
}

const createStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: colors.divider,
      backgroundColor: colors.cardBackground,
      paddingLeft: 10,
      paddingRight: 10,
      paddingVertical: 7,
      marginBottom: 6,
      gap: 8,
    },
    selectRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 9 },
    pressed: { opacity: 0.55 },
    checkbox: {
      width: 20,
      height: 20,
      borderRadius: 6,
      borderWidth: 1.5,
      // Shared with the cinema picker's box: `pillBorder`/`surfaceMuted` are
      // the same gray as the surfaces a checkbox sits on in dark mode.
      borderColor: colors.checkboxBorder,
      backgroundColor: colors.checkboxBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    checkboxChecked: {
      backgroundColor: colors.green.secondary,
      borderColor: colors.green.secondary,
    },
    cardTextBlock: { flex: 1 },
    // Hiding a list is the same filter as not ticking it plus a subtraction, so
    // the row recedes rather than shouting — the red border carries the state.
    cardTextBlockExcluded: { opacity: 0.55 },
    // Explicit line heights: ThemedText's default type ships lineHeight 24,
    // which survives a fontSize override and would undo the compact rows.
    cardTitle: { fontSize: 14, lineHeight: 18, fontWeight: "600", color: colors.text },
    cardSubtitle: { fontSize: 11.5, lineHeight: 15, color: colors.textSecondary },
    hideButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: 9,
      borderWidth: 1,
      overflow: "hidden",
    },
    hideButtonIdle: { backgroundColor: colors.cardBackground, borderColor: colors.pillBorder },
    hideButtonActive: { backgroundColor: colors.red.primary, borderColor: colors.red.border },
    hideLabel: { fontSize: 12, lineHeight: 15, fontWeight: "700" },
    modeHint: { fontSize: 11.5, lineHeight: 15, color: colors.textSecondary, marginTop: -4, marginBottom: 8 },
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
