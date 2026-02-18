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

export default function FriendsScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();

  // Current text typed into the search input.
  const [searchQuery, setSearchQuery] = useState('');
  // Controls pull-to-refresh spinner visibility.
  const [refreshing, setRefreshing] = useState(false);
  // Keeps track of the currently selected tab on this screen.
  const [activeTab, setActiveTab] = useState<FriendsTabId>('users');

  // Build the filter payload from current UI selections.
  const userFilters = useMemo(() => ({ query: searchQuery }), [searchQuery]);

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
    enabled: activeTab === 'users',
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
  const friends = friendsData ?? [];
  const received = receivedRequests ?? [];
  const sent = sentRequests ?? [];

  // Refresh the current dataset and reset any stale pagination state.
  const handleRefresh = async () => {
    setRefreshing(true);
    // Refresh only the currently visible tab to keep network usage predictable.
    if (activeTab === 'users') {
      await resetInfiniteQuery(queryClient, ['users', userFilters]);
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
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  // FilterPills acts as the tab bar for this screen.
  const tabs = useMemo<ReadonlyArray<{ id: FriendsTabId; label: string; badgeCount?: number }>>(
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
        <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder="Search users" />
      ) : null}

      {activeTab === 'users' ? (
        <FlatList
          data={users}
          keyExtractor={(item) => `user-${item.id}`}
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          renderItem={({ item }) => <FriendCard user={item} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            isFetchingUsers ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.tint} />
              </View>
            ) : (
              <ThemedText style={styles.emptyText}>No users found</ThemedText>
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
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
        >
          {activeTab === 'received' ? (
          <View style={styles.section}>
            {isFetchingReceived && received.length === 0 ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.tint} />
              </View>
            ) : received.length === 0 ? (
              <ThemedText style={styles.emptyText}>No requests received</ThemedText>
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
                <ThemedText style={styles.emptyText}>No requests sent</ThemedText>
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
                <ThemedText style={styles.emptyText}>No friends yet</ThemedText>
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
    content: {
      padding: 16,
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
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    centerContainer: {
      paddingVertical: 16,
      alignItems: 'center',
    },
  });
