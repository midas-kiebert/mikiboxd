/**
 * Expo Router screen/module for (tabs) / friends. It controls navigation and screen-level state for this route.
 */
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, ScrollView, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { useFetchUsers } from 'shared/hooks/useFetchUsers';
import { useFetchFriends } from 'shared/hooks/useFetchFriends';
import { useFetchReceivedRequests } from 'shared/hooks/useFetchReceivedRequests';
import { useFetchSentRequests } from 'shared/hooks/useFetchSentRequests';

import { ThemedText } from '@/components/themed-text';
import { useThemeColors } from '@/hooks/use-theme-color';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import FriendCard from '@/components/friends/FriendCard';
import FilterPills from '@/components/filters/FilterPills';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';

type FriendsTabId = 'users' | 'received' | 'sent' | 'friends';
type FriendsTabMeta = {
  title: string;
  subtitle: string;
  emptyText: string;
};

const TAB_META: Record<FriendsTabId, FriendsTabMeta> = {
  users: {
    title: 'All Users',
    subtitle: 'Discover people and send friend requests.',
    emptyText: 'No users found',
  },
  received: {
    title: 'Requests Received',
    subtitle: 'Respond to incoming friend requests.',
    emptyText: 'No requests received',
  },
  sent: {
    title: 'Requests Sent',
    subtitle: 'Requests waiting for a response.',
    emptyText: 'No requests sent',
  },
  friends: {
    title: 'Friends',
    subtitle: 'People you already connected with.',
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
  const hasUserSearch = normalizedSearchQuery.length > 0;
  // Controls pull-to-refresh spinner visibility.
  const [refreshing, setRefreshing] = useState(false);
  // Keeps track of the currently selected tab on this screen.
  const [activeTab, setActiveTab] = useState<FriendsTabId>('users');

  // Build the filter payload from current UI selections.
  const userFilters = useMemo(
    () => ({ query: normalizedSearchQuery || undefined }),
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

  // Flatten/derive list data for rendering efficiency.
  const users = useMemo(() => usersData?.pages.flat() ?? [], [usersData]);
  const displayedUsers = hasUserSearch ? users : [];
  const friends = friendsData ?? [];
  const received = receivedRequests ?? [];
  const sent = sentRequests ?? [];
  const activeTabMeta = TAB_META[activeTab];
  const activeSectionSubtitle =
    activeTab === 'users' && !hasUserSearch ? 'Start typing to search for users.' : activeTabMeta.subtitle;

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
      {activeTab === 'users' ? (
        <View style={styles.searchBarContainer}>
          <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder="Search users" />
        </View>
      ) : null}

      {activeTab === 'users' ? (
        <FlatList
          data={displayedUsers}
          keyExtractor={(item) => `user-${item.id}`}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          ListHeaderComponent={
            <View style={styles.sectionIntro}>
              <View style={styles.sectionIntroText}>
                <ThemedText style={styles.sectionTitle}>{activeTabMeta.title}</ThemedText>
                <ThemedText style={styles.sectionSubtitle}>{activeSectionSubtitle}</ThemedText>
              </View>
            </View>
          }
          renderItem={({ item }) => <FriendCard user={item} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            !hasUserSearch ? (
              <View style={styles.emptyCard}>
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
          <View style={styles.sectionIntro}>
            <View style={styles.sectionIntroText}>
              <ThemedText style={styles.sectionTitle}>{activeTabMeta.title}</ThemedText>
              <ThemedText style={styles.sectionSubtitle}>{activeSectionSubtitle}</ThemedText>
            </View>
          </View>

          {activeTab === 'received' ? (
            <View style={styles.section}>
              {isFetchingReceived && received.length === 0 ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </View>
              ) : received.length === 0 ? (
                <View style={styles.emptyCard}>
                  <ThemedText style={styles.emptyText}>{TAB_META.received.emptyText}</ThemedText>
                </View>
              ) : (
                <View style={styles.list}>
                  {received.map((user) => (
                    <FriendCard key={`received-${user.id}`} user={user} />
                  ))}
                </View>
              )}
            </View>
          ) : null}

          {activeTab === 'sent' ? (
            <View style={styles.section}>
              {isFetchingSent && sent.length === 0 ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </View>
              ) : sent.length === 0 ? (
                <View style={styles.emptyCard}>
                  <ThemedText style={styles.emptyText}>{TAB_META.sent.emptyText}</ThemedText>
                </View>
              ) : (
                <View style={styles.list}>
                  {sent.map((user) => (
                    <FriendCard key={`sent-${user.id}`} user={user} />
                  ))}
                </View>
              )}
            </View>
          ) : null}

          {activeTab === 'friends' ? (
            <View style={styles.section}>
              {isFetchingFriends && friends.length === 0 ? (
                <View style={styles.centerContainer}>
                  <ActivityIndicator size="large" color={colors.tint} />
                </View>
              ) : friends.length === 0 ? (
                <View style={styles.emptyCard}>
                  <ThemedText style={styles.emptyText}>{TAB_META.friends.emptyText}</ThemedText>
                </View>
              ) : (
                <View style={styles.list}>
                  {friends.map((user) => (
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
    sectionIntro: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    sectionIntroText: {
      gap: 2,
    },
    sectionTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    sectionSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
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
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    centerContainer: {
      paddingVertical: 16,
      alignItems: 'center',
    },
  });
