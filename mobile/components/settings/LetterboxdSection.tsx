/**
 * The "Letterboxd" card in Settings: the linked username, watchlist/watched
 * counts, and a manual refresh button for each list.
 *
 * Watchlist and watched are synced independently on the backend (separate
 * cooldowns, separate failure states), so each gets its own button, its own
 * "last synced" caption, and its own subtle failure notice — one list being
 * throttled or erroring should never block the other from refreshing.
 *
 * The refresh buttons gray out during the backend's cooldown window (see
 * `SYNC_COOLDOWN` in `letterboxd_sync.py`), using the cooldown-end timestamp
 * the backend computes rather than re-deriving it here, so the two never
 * drift out of sync.
 */
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { DateTime } from 'luxon';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MeService } from 'shared';
import useAuth from 'shared/hooks/useAuth';

import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/hooks/use-theme-color';

type Colors = ReturnType<typeof useThemeColors>;

function formatSynced(iso: string | null | undefined): string {
  if (!iso) return 'Not synced recently';
  const relative = DateTime.fromISO(iso).toRelative({ style: 'short' });
  return relative ? `Last synced ${relative}` : 'Last synced just now';
}

function cooldownRemainingLabel(endsAtIso: string | null | undefined, now: DateTime): string | null {
  if (!endsAtIso) return null;
  const endsAt = DateTime.fromISO(endsAtIso);
  const minutesLeft = Math.ceil(endsAt.diff(now, 'minutes').minutes);
  if (minutesLeft <= 0) return null;
  return `Available again in ${minutesLeft} min`;
}

export default function LetterboxdSection() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [username, setUsername] = useState('');
  // Seeded with `undefined` rather than the live value — if the currentUser
  // query has already resolved by mount (common on a release build), starting
  // from `user?.letterboxd_username` would make it equal on the very first
  // render and the sync below would never fire, leaving the field blank.
  const [lastSyncedUsername, setLastSyncedUsername] = useState<
    string | null | undefined
  >(undefined);
  if (user?.letterboxd_username !== lastSyncedUsername) {
    setLastSyncedUsername(user?.letterboxd_username);
    setUsername(user?.letterboxd_username ?? '');
  }

  // Local rather than the shared `useSaveLetterboxdUsername` hook: that hook
  // only accepts a non-empty username, but Settings is also where an existing
  // link is unlinked (an emptied field saves `null`).
  const saveUsername = useMutation({
    mutationFn: (value: string) =>
      MeService.updateUserMe({ requestBody: { letterboxd_username: value || null } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    },
    onError: (error) => {
      console.error('Error saving Letterboxd username:', error);
      Alert.alert('Could not save', 'Your Letterboxd username was not saved. Please try again.');
    },
  });

  // Ticks so "last synced X ago" and the cooldown countdown stay live without
  // requiring a refetch.
  const [now, setNow] = useState(() => DateTime.now());
  useEffect(() => {
    const id = setInterval(() => setNow(DateTime.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const invalidateAfterSync = () => {
    queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    queryClient.invalidateQueries({ queryKey: ['showtimes'] });
    queryClient.invalidateQueries({ queryKey: ['movies'] });
  };

  const syncWatchlist = useMutation({
    mutationFn: () => MeService.syncWatchlist(),
    onSettled: invalidateAfterSync,
  });
  const syncWatched = useMutation({
    mutationFn: () => MeService.syncWatched(),
    onSettled: invalidateAfterSync,
  });

  const trimmedUsername = username.trim();
  const usernameChanged = trimmedUsername !== (user?.letterboxd_username ?? '');
  const canSaveUsername = usernameChanged && !saveUsername.isPending;

  const hasUsername = Boolean(user?.letterboxd_username);

  return (
    <View style={styles.card}>
      <ThemedText style={styles.label}>Letterboxd username</ThemedText>
      <View style={styles.inputRow}>
        <ThemedText style={styles.prefix}>letterboxd.com/</ThemedText>
        <TextInput
          style={styles.input}
          value={username}
          onChangeText={setUsername}
          placeholder="username"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => canSaveUsername && saveUsername.mutate(trimmedUsername)}
          editable={!saveUsername.isPending}
        />
      </View>
      <TouchableOpacity
        style={[styles.saveButton, !canSaveUsername && styles.buttonDisabled]}
        onPress={() => saveUsername.mutate(trimmedUsername)}
        disabled={!canSaveUsername}
        activeOpacity={0.85}
      >
        {saveUsername.isPending ? (
          <ActivityIndicator size="small" color={colors.pillActiveText} />
        ) : (
          <ThemedText style={styles.saveButtonText}>Save username</ThemedText>
        )}
      </TouchableOpacity>

      {hasUsername ? (
        <>
          <View style={styles.divider} />

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <ThemedText style={styles.statValue}>{user?.watchlist_count ?? 0}</ThemedText>
              <ThemedText style={styles.statLabel}>Watchlisted</ThemedText>
            </View>
            <View style={styles.statItem}>
              <ThemedText style={styles.statValue}>{user?.watched_count ?? 0}</ThemedText>
              <ThemedText style={styles.statLabel}>Watched</ThemedText>
            </View>
          </View>

          <SyncRow
            title="Watchlist"
            lastSynced={user?.watchlist_last_synced}
            failed={user?.watchlist_sync_failed ?? false}
            cooldownEndsAt={user?.watchlist_sync_cooldown_ends_at}
            syncing={syncWatchlist.isPending}
            onSync={() => syncWatchlist.mutate()}
            now={now}
            colors={colors}
          />
          <SyncRow
            title="Watched"
            lastSynced={user?.watched_last_synced}
            failed={user?.watched_sync_failed ?? false}
            cooldownEndsAt={user?.watched_sync_cooldown_ends_at}
            syncing={syncWatched.isPending}
            onSync={() => syncWatched.mutate()}
            now={now}
            colors={colors}
          />
        </>
      ) : null}
    </View>
  );
}

function SyncRow({
  title,
  lastSynced,
  failed,
  cooldownEndsAt,
  syncing,
  onSync,
  now,
  colors,
}: {
  title: string;
  lastSynced: string | null | undefined;
  failed: boolean;
  cooldownEndsAt: string | null | undefined;
  syncing: boolean;
  onSync: () => void;
  now: DateTime;
  colors: Colors;
}) {
  const styles = createStyles(colors);
  const cooldownLabel = cooldownRemainingLabel(cooldownEndsAt, now);
  const disabled = syncing || cooldownLabel !== null;

  return (
    <View style={styles.syncRow}>
      <View style={styles.syncTextBlock}>
        <View style={styles.syncTitleRow}>
          <ThemedText style={styles.syncTitle}>{title}</ThemedText>
          {syncing ? (
            <View style={styles.syncingBadge}>
              <ActivityIndicator size="small" color={colors.textSecondary} />
              <ThemedText style={styles.syncingBadgeText}>Syncing…</ThemedText>
            </View>
          ) : null}
        </View>
        <ThemedText style={styles.syncSubtitle}>
          {cooldownLabel ?? formatSynced(lastSynced)}
        </ThemedText>
        {failed && !syncing ? (
          <ThemedText style={styles.syncFailedText}>
            Last sync failed. It will try again automatically, or you can retry now.
          </ThemedText>
        ) : null}
      </View>
      <TouchableOpacity
        style={[styles.syncButton, disabled && styles.buttonDisabled]}
        onPress={onSync}
        disabled={disabled}
        activeOpacity={0.8}
        accessibilityRole="button"
        accessibilityLabel={`Refresh ${title.toLowerCase()}`}
      >
        <MaterialIcons name="sync" size={18} color={colors.tint} />
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 12,
      gap: 10,
    },
    label: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    inputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingLeft: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 8,
      backgroundColor: colors.background,
    },
    prefix: { fontSize: 14, color: colors.textSecondary },
    input: {
      flex: 1,
      paddingLeft: 0,
      paddingRight: 12,
      paddingVertical: 10,
      fontSize: 14,
      color: colors.text,
    },
    saveButton: {
      marginTop: 4,
      backgroundColor: colors.tint,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: 'center',
    },
    saveButtonText: {
      color: colors.pillActiveText,
      fontWeight: '700',
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginVertical: 2,
    },
    statsRow: {
      flexDirection: 'row',
      gap: 10,
    },
    statItem: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 8,
      borderRadius: 10,
      backgroundColor: colors.surfaceMuted,
    },
    statValue: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.text,
    },
    statLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      marginTop: 2,
    },
    syncRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    syncTextBlock: {
      flex: 1,
      gap: 2,
    },
    syncTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    syncTitle: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.text,
    },
    syncingBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    syncingBadgeText: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    syncSubtitle: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    syncFailedText: {
      fontSize: 11,
      color: colors.red.secondary,
    },
    syncButton: {
      width: 40,
      height: 40,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.pillBackground,
    },
  });
