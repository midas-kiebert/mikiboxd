/**
 * Expo Router screen/module for (tabs) / friends. It controls navigation and screen-level state for this route.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MeService } from 'shared';
import { useFetchUsers } from 'shared/hooks/useFetchUsers';
import { useFetchFriends } from 'shared/hooks/useFetchFriends';
import { useFetchReceivedRequests } from 'shared/hooks/useFetchReceivedRequests';
import { useFetchSentRequests } from 'shared/hooks/useFetchSentRequests';
import QRCode from 'react-native-qrcode-svg';

import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/hooks/use-theme-color';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import FriendCard from '@/components/friends/FriendCard';
import FilterPills from '@/components/filters/FilterPills';
import { buildFriendInviteUrl } from '@/constants/friend-invite';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';

type FriendsTabId = 'users' | 'received' | 'sent' | 'friends';
type FriendsTabMeta = {
  emptyText: string;
};

const TAB_META: Record<FriendsTabId, FriendsTabMeta> = {
  users: {
    emptyText: 'No users found',
  },
  received: {
    emptyText: 'No requests received',
  },
  sent: {
    emptyText: 'No requests sent',
  },
  friends: {
    emptyText: 'No friends yet',
  },
};

export default function FriendsScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  // Current text typed into the search input.
  const [searchQuery, setSearchQuery] = useState('');
  const normalizedSearchQuery = searchQuery.trim();
  const normalizedSearchQueryLower = normalizedSearchQuery.toLowerCase();
  const hasUserSearch = normalizedSearchQuery.length > 0;
  // Controls pull-to-refresh spinner visibility.
  const [refreshing, setRefreshing] = useState(false);
  // Keeps track of the currently selected tab on this screen.
  const [activeTab, setActiveTab] = useState<FriendsTabId>('users');

  // Build the filter payload from current UI selections.
  const userFilters = useMemo(
    () => ({ query: normalizedSearchQuery }),
    [normalizedSearchQuery]
  );

  // "All users" is the only tab that needs infinite pagination.
  const {
    data: usersData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching: isFetchingUsers,
  } = useFetchUsers({
    limit: 20,
    filters: userFilters,
    enabled: activeTab === 'users' && hasUserSearch,
  });

  const { data: friendsData, isFetching: isFetchingFriends } = useFetchFriends({
    enabled: activeTab === 'friends',
  });
  const { data: receivedRequests, isFetching: isFetchingReceived } = useFetchReceivedRequests();
  const { data: sentRequests, isFetching: isFetchingSent } = useFetchSentRequests({
    enabled: activeTab === 'sent',
  });
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => MeService.getCurrentUser(),
  });

  // Flatten/derive list data for rendering efficiency.
  const users = useMemo(() => usersData?.pages.flat() ?? [], [usersData]);
  const displayedUsers = hasUserSearch ? users : [];
  const friends = useMemo(() => friendsData ?? [], [friendsData]);
  const received = useMemo(() => receivedRequests ?? [], [receivedRequests]);
  const sent = useMemo(() => sentRequests ?? [], [sentRequests]);
  const matchName = useCallback(
    (value: string | null | undefined) =>
      normalizedSearchQueryLower.length === 0 ||
      (value ?? '').toLowerCase().includes(normalizedSearchQueryLower),
    [normalizedSearchQueryLower]
  );
  const displayedReceived = useMemo(
    () => received.filter((user) => matchName(user.display_name)),
    [received, matchName]
  );
  const displayedSent = useMemo(
    () => sent.filter((user) => matchName(user.display_name)),
    [sent, matchName]
  );
  const displayedFriends = useMemo(
    () => friends.filter((user) => matchName(user.display_name)),
    [friends, matchName]
  );
  const searchPlaceholder = activeTab === 'users' ? 'Search users' : 'Search friends';
  const inviteUrl = useMemo(
    () => (currentUser?.id ? buildFriendInviteUrl(currentUser.id) : null),
    [currentUser?.id]
  );

  const handleShareInviteLink = async () => {
    if (!inviteUrl) return;
    try {
      await Share.share({
        message: `Add me on MiKiNO: ${inviteUrl}`,
        url: inviteUrl,
      });
    } catch (error) {
      console.error('Error sharing friend invite link:', error);
    }
  };

  // Refresh the current dataset and reset any stale pagination state.
  const handleRefresh = async () => {
    setRefreshing(true);
    // Refresh only the currently visible tab to keep network usage predictable.
    if (activeTab === 'users') {
      if (hasUserSearch) {
        await resetInfiniteQuery(queryClient, ['users', userFilters]);
      }
    } else if (activeTab === 'received') {
      await queryClient.invalidateQueries({ queryKey: ['users', 'receivedRequests'] });
    } else if (activeTab === 'sent') {
      await queryClient.invalidateQueries({ queryKey: ['users', 'sentRequests'] });
    } else if (activeTab === 'friends') {
      await queryClient.invalidateQueries({ queryKey: ['users', 'friends'] });
    }
    setRefreshing(false);
  };

  // Request the next page when the list nears the end.
  const handleLoadMore = () => {
    if (hasUserSearch && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  // FilterPills acts as the tab bar for this screen.
  const tabs = useMemo<readonly { id: FriendsTabId; label: string; badgeCount?: number }[]>(
    () => [
      { id: 'users', label: 'All Users' },
      { id: 'received', label: 'Requests Received', badgeCount: received.length },
      { id: 'sent', label: 'Requests Sent' },
      { id: 'friends', label: 'Friends' },
    ],
    [received.length]
  );

  // Render/output using the state and derived values prepared above.
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title="Friends" />
      <FilterPills
        filters={tabs}
        selectedId={activeTab}
        onSelect={setActiveTab}
      />
      <View style={styles.searchBarContainer}>
        <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder={searchPlaceholder} />
      </View>

      {activeTab === 'users' ? (
        <FlatList
          data={displayedUsers}
          keyExtractor={(item) => `user-${item.id}`}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          renderItem={({ item }) => <FriendCard user={item} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            !hasUserSearch ? (
              <View style={styles.inviteCard}>
                <ThemedText style={styles.inviteTitle}>Scan To Add Me</ThemedText>
                {inviteUrl ? (
                  <View style={styles.qrWrapper}>
                    <QRCode value={inviteUrl} size={210} backgroundColor="#ffffff" color="#111111" />
                  </View>
                ) : (
                  <View style={styles.qrLoadingWrapper}>
                    <ActivityIndicator size="large" color={colors.tint} />
                  </View>
                )}
                <ThemedText style={styles.inviteText}>
                  Ask a friend to scan this code, or share your invite link.
                </ThemedText>
                {inviteUrl ? (
                  <TouchableOpacity
                    style={styles.inviteShareButton}
                    onPress={handleShareInviteLink}
                    activeOpacity={0.8}
                  >
                    <ThemedText style={styles.inviteShareButtonText}>Share Invite Link</ThemedText>
                  </TouchableOpacity>
                ) : null}
                <ThemedText style={styles.emptyText}>Type a name to search users</ThemedText>
              </View>
            ) : isFetchingUsers ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.tint} />
              </View>
            ) : (
              <View style={styles.emptyCard}>
                <ThemedText style={styles.emptyText}>{TAB_META.users.emptyText}</ThemedText>
              </View>
            )
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="small" color={colors.tint} />
              </View>
            ) : null
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          {activeTab === 'received' ? (
            <View style={styles.section}>
              {isFetchingReceived && displayedReceived.length === 0 ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </View>
              ) : displayedReceived.length === 0 ? (
                <View style={styles.emptyCard}>
                  <ThemedText style={styles.emptyText}>
                    {normalizedSearchQueryLower.length > 0
                      ? 'No matching requests'
                      : TAB_META.received.emptyText}
                  </ThemedText>
                </View>
              ) : (
                <View style={styles.list}>
                  {displayedReceived.map((user) => (
                    <FriendCard key={`received-${user.id}`} user={user} />
                  ))}
                </View>
              )}
            </View>
          ) : null}

          {activeTab === 'sent' ? (
            <View style={styles.section}>
              {isFetchingSent && displayedSent.length === 0 ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </View>
              ) : displayedSent.length === 0 ? (
                <View style={styles.emptyCard}>
                  <ThemedText style={styles.emptyText}>
                    {normalizedSearchQueryLower.length > 0
                      ? 'No matching requests'
                      : TAB_META.sent.emptyText}
                  </ThemedText>
                </View>
              ) : (
                <View style={styles.list}>
                  {displayedSent.map((user) => (
                    <FriendCard key={`sent-${user.id}`} user={user} />
                  ))}
                </View>
              )}
            </View>
          ) : null}

          {activeTab === 'friends' ? (
            <View style={styles.section}>
              {isFetchingFriends && displayedFriends.length === 0 ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </View>
              ) : displayedFriends.length === 0 ? (
                <View style={styles.emptyCard}>
                  <ThemedText style={styles.emptyText}>
                    {normalizedSearchQueryLower.length > 0
                      ? 'No matching friends'
                      : TAB_META.friends.emptyText}
                  </ThemedText>
                </View>
              ) : (
                <View style={styles.list}>
                  {displayedFriends.map((user) => (
                    <FriendCard key={`friend-${user.id}`} user={user} />
                  ))}
                </View>
              )}
            </View>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    searchBarContainer: {
      paddingHorizontal: 0,
      paddingBottom: 2,
    },
    content: {
      padding: 16,
      paddingTop: 10,
      paddingBottom: 24,
      gap: 12,
    },
    section: {
      gap: 12,
    },
    list: {
      gap: 12,
    },
    separator: {
      height: 12,
    },
    emptyCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      paddingHorizontal: 12,
    },
    inviteCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 16,
      paddingHorizontal: 12,
      gap: 10,
    },
    inviteTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    qrWrapper: {
      borderRadius: 12,
      padding: 12,
      backgroundColor: '#ffffff',
      borderWidth: 1,
      borderColor: colors.divider,
    },
    qrLoadingWrapper: {
      width: 210,
      height: 210,
      borderRadius: 12,
      backgroundColor: colors.pillBackground,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inviteText: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    inviteShareButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.tint,
      backgroundColor: colors.tint,
      paddingHorizontal: 14,
      paddingVertical: 9,
    },
    inviteShareButtonText: {
      color: colors.pillActiveText,
      fontSize: 13,
      fontWeight: '700',
    },
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    centerContainer: {
      paddingVertical: 16,
      alignItems: 'center',
    },
  });
