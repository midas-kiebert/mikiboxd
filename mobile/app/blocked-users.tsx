/**
 * "Blocked accounts" — the one place a blocked account is still visible: search,
 * friends and invites all leave it out, so this list is also the only way back
 * to unblocking one. Reached from Settings → Privacy.
 */
import { ActivityIndicator, FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import type { BlockedUserPublic } from 'shared';
import { useFetchBlockedUsers } from 'shared/hooks/useFetchBlockedUsers';

import TopBar from '@/components/layout/TopBar';
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';
import { ThemedText } from '@/components/themed-text';
import { useUserModeration } from '@/hooks/useUserModeration';
import { useThemeColors } from '@/hooks/use-theme-color';
import { getAvatarColors, getAvatarInitial } from '@/utils/avatar-color';
import { triggerSelectionHaptic } from '@/utils/long-press';

export default function BlockedUsersScreen() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const { data: blockedUsers, isLoading } = useFetchBlockedUsers();
  const { unblockUser, isBusy } = useUserModeration();

  const handleUnblock = (userId: string) => {
    triggerSelectionHaptic();
    unblockUser(userId);
  };

  const renderRow = ({ item }: { item: BlockedUserPublic }) => {
    const name = item.display_name?.trim() || 'Unknown user';
    const avatarColors = getAvatarColors(item.id, colors);
    return (
      <View style={styles.row}>
        <View style={[styles.avatar, { backgroundColor: avatarColors.primary }]}>
          <ThemedText style={[styles.avatarText, { color: avatarColors.secondary }]}>
            {getAvatarInitial(name)}
          </ThemedText>
        </View>
        <ThemedText style={styles.name} numberOfLines={1}>
          {name}
        </ThemedText>
        <TouchableOpacity
          style={styles.unblockButton}
          onPress={() => handleUnblock(item.id)}
          disabled={isBusy}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`Unblock ${name}`}
        >
          <ThemedText style={styles.unblockButtonText}>Unblock</ThemedText>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar title="Blocked accounts" showBackButton showNotificationBell={false} />
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.tint} />
        </View>
      ) : !blockedUsers || blockedUsers.length === 0 ? (
        <View style={styles.centered}>
          <MaterialIcons name="block" size={28} color={colors.textSecondary} />
          <ThemedText style={styles.emptyText}>You haven&apos;t blocked anyone.</ThemedText>
        </View>
      ) : (
        <FlatList
          data={blockedUsers}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          contentContainerStyle={styles.listContent}
        />
      )}
    </TopSafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingHorizontal: 32,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    listContent: {
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 24,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    avatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      fontSize: 15,
      fontWeight: '700',
    },
    name: {
      flex: 1,
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    unblockButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.pillBackground,
    },
    unblockButtonText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.text,
    },
  });
