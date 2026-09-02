/**
 * Body of the "Movie Filters" section of the Filters modal (the collapsible
 * `FilterSection` wrapper supplies the heading).
 *
 * Without a Letterboxd username the watchlist/watched cards have nothing to
 * work with, so their place is taken by a prompt for that username.
 *
 * Every movie-set filter lives here as a one-line card: the Letterboxd
 * watchlist / watched, plus Letterboxd *lists* (curated ones such as the Top
 * 500, and custom lists pasted in by the user). Ticking a card's checkbox
 * includes it; the smaller "Hide" button next to it excludes it. Includes
 * combine as a union and excludes are subtracted, so you can e.g. include
 * Watchlist + Top 500 while excluding Watched. The checkbox carries the common
 * case and Hide is deliberately the quieter control — a card can only be in one
 * of the two states, so ticking clears a hide and vice versa. Each card shows
 * when its data was last synced.
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
      <FilterSubLabel label="Watchlist & watched" isFirst />
      {/* The two modes are not symmetric and neither is self-evident, so the
          section says once what ticking and hiding do. It sits above the first
          block that actually renders cards — above a sign-in prompt it would be
          explaining controls that aren't there. */}
      {canUseWatchlistFilter && <ModeHint colors={colors} />}
      {canUseWatchlistFilter ? (
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
      ) : isSignedIn ? (
        <LetterboxdUsernamePrompt />
      ) : (
        // Connecting Letterboxd writes a username onto an account, so there is
        // nothing to offer a guest here but the account itself.
        <SignedOutPanel variant="card" feature="letterboxd" />
      )}

      {/* Curated lists */}
      <FilterSubLabel label="Curated lists" />
      {!canUseWatchlistFilter && <ModeHint colors={colors} />}
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
  const { value: displayMode, change } = useOptimisticValue(mode, onChangeMode);
  const included = displayMode === "include";
  const excluded = displayMode === "exclude";
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
        onPress={() => change(included ? "off" : "include")}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: included }}
        accessibilityLabel={`Show only films from ${title}`}
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
      <HideButton
        active={excluded}
        onPress={() => change(excluded ? "off" : "exclude")}
        colors={colors}
      />
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
