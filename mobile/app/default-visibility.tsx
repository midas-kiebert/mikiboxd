/**
 * "Default status visibility" — which of the 3 visibility modes a new
 * showtime starts with, until you pick a different one for it in the
 * showtime sheet. Reached from that sheet's visibility dropdown, below the
 * 3 options.
 */
import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { MeService, type ApiError, type VisibilityMode } from 'shared';
import useAuth from 'shared/hooks/useAuth';
import { SHOWTIME_VISIBILITY_QUERY_KEY_PREFIX } from 'shared/hooks/useShowtimeVisibility';

import {
  getVisibilityModeMeta,
  VISIBILITY_MODE_ORDER,
} from '@/components/showtimes/visibility-mode';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import TopBar from '@/components/layout/TopBar';
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';
import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/hooks/use-theme-color';
import { triggerSelectionHaptic } from '@/utils/long-press';

export default function DefaultVisibilityScreen() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Optimistic paint on tap, reverted if the save fails — same pattern as
  // the other single-preference toggles on the Settings screen.
  const [optimisticMode, setOptimisticMode] = useState<VisibilityMode | null>(null);
  const selectedMode = optimisticMode ?? user?.default_visibility_mode ?? 'FRIENDS_OF_FRIENDS';
  // The mode the user has tapped but not yet answered the "…and your existing
  // showtimes?" question for. Nothing is saved, and nothing paints as selected,
  // until they do — dismissing the dialog leaves the default exactly as it was.
  const [pendingMode, setPendingMode] = useState<VisibilityMode | null>(null);

  const mutation = useMutation({
    mutationFn: ({ mode, applyToExisting }: { mode: VisibilityMode; applyToExisting: boolean }) =>
      MeService.updateUserMe({
        requestBody: {
          default_visibility_mode: mode,
          apply_default_visibility_to_existing: applyToExisting,
        },
      }),
    // Written straight into the cache instead of `invalidateQueries`: an
    // invalidation refetches in the background, and clearing the optimistic
    // value before that refetch lands re-reads the *old* `user.default_visibility_mode`
    // for a beat — the selection visibly jumps back to the old option and then
    // forward again once the refetch resolves. Setting the response directly
    // means the cache already holds the new value the instant the optimistic
    // override is cleared, so there's nothing to jump back to.
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(['currentUser'], updatedUser);
      // Every showtime without its own override was reading this default, and
      // any cached/prefetched `showtimeVisibility` entry for one of them now
      // states the *old* default as fact. Purged rather than invalidated: an
      // invalidation still serves that stale mode to the next observer before
      // its background refetch resolves — exactly the flash this is trying to
      // prevent — and `usePrefetchShowtimeVisibility` skips re-fetching an id
      // it still finds cached, so a merely-stale entry would never self-heal.
      queryClient.removeQueries({ queryKey: SHOWTIME_VISIBILITY_QUERY_KEY_PREFIX });
      setOptimisticMode(null);
    },
    onError: () => {
      setOptimisticMode(null);
    },
  });

  const save = (mode: VisibilityMode, applyToExisting: boolean) => {
    setOptimisticMode(mode);
    mutation.mutate({ mode, applyToExisting });
  };

  const handleSelect = (mode: VisibilityMode) => {
    if (mode === selectedMode) return;
    triggerSelectionHaptic();
    // Nothing to apply the new default to, so there is nothing to ask about:
    // the account is going to / interested in no showtime at all.
    if (!user?.has_selected_showtimes) {
      save(mode, true);
      return;
    }
    setPendingMode(mode);
  };

  const handleAnswer = (applyToExisting: boolean) => {
    if (!pendingMode) return;
    setPendingMode(null);
    save(pendingMode, applyToExisting);
  };

  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar title="Default status visibility" showBackButton showNotificationBell={false} />
      <View style={styles.content}>
        <ThemedText style={styles.intro}>
          Who can see your status on a new showtime, until you change it for that showtime.
        </ThemedText>
        {VISIBILITY_MODE_ORDER.map((mode) => {
          const optionMeta = getVisibilityModeMeta(mode, colors);
          const isSelected = mode === selectedMode;
          return (
            <TouchableOpacity
              key={mode}
              style={[
                styles.option,
                isSelected && { borderColor: optionMeta.color, backgroundColor: colors.surfaceMuted },
              ]}
              onPress={() => handleSelect(mode)}
              disabled={mutation.isPending}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel={optionMeta.label}
            >
              <View style={[styles.optionIcon, { backgroundColor: optionMeta.color }]}>
                <MaterialIcons name={optionMeta.icon} size={16} color={colors.pillActiveText} />
              </View>
              <View style={styles.optionText}>
                <ThemedText style={styles.optionLabel}>{optionMeta.label}</ThemedText>
                <ThemedText style={styles.optionDescription}>{optionMeta.description}</ThemedText>
              </View>
              <MaterialIcons
                name={isSelected ? 'radio-button-checked' : 'radio-button-unchecked'}
                size={20}
                color={isSelected ? optionMeta.color : colors.textSecondary}
              />
            </TouchableOpacity>
          );
        })}
      </View>
      <ConfirmDialog
        visible={pendingMode !== null}
        icon="visibility"
        tone="primary"
        title="Apply to your showtimes too?"
        message={
          "Showtimes you're going to or interested in follow this default. Keep them as they are, " +
          'or apply the new setting to them too? Showtimes you set individually keep their own ' +
          'setting either way.'
        }
        confirmLabel="New showtimes only"
        secondaryLabel="Apply to all"
        cancelLabel="Cancel"
        onConfirm={() => handleAnswer(false)}
        onSecondary={() => handleAnswer(true)}
        onCancel={() => setPendingMode(null)}
      />
    </TopSafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: 16,
      paddingTop: 12,
      gap: 10,
    },
    intro: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
      marginBottom: 4,
    },
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      padding: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
    },
    optionIcon: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
    },
    optionText: {
      flex: 1,
      gap: 2,
    },
    optionLabel: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.text,
    },
    optionDescription: {
      fontSize: 12,
      color: colors.textSecondary,
    },
  });
