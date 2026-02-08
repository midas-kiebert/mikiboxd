import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, RefreshControl, StyleSheet, View, TouchableOpacity } from 'react-native';
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

export default function FriendsScreen() {
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'users' | 'received' | 'sent' | 'friends'>('users');

  const userFilters = useMemo(() => ({ query: searchQuery }), [searchQuery]);

  const {
    data: usersData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching: isFetchingUsers,
  } = useFetchUsers({
    limit: 20,
    filters: userFilters,
  });

  const { data: friendsData, isFetching: isFetchingFriends } = useFetchFriends();
  const { data: receivedRequests, isFetching: isFetchingReceived } = useFetchReceivedRequests();
  const { data: sentRequests, isFetching: isFetchingSent } = useFetchSentRequests();

  const users = useMemo(() => usersData?.pages.flat() ?? [], [usersData]);
  const friends = friendsData ?? [];
  const received = receivedRequests ?? [];
  const sent = sentRequests ?? [];

  const handleRefresh = async () => {
    setRefreshing(true);
    await resetInfiniteQuery(queryClient, ['users', userFilters]);
    setRefreshing(false);
  };

  const handleLoadMore = () => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  const tabs = useMemo(
    () => [
      { id: 'users', label: 'All Users' },
      { id: 'received', label: 'Requests Received' },
      { id: 'sent', label: 'Requests Sent' },
      { id: 'friends', label: 'Friends' },
    ],
    []
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title="Friends" />
      <FilterPills
        filters={tabs}
        selectedId={activeTab}
        onSelect={(id) => setActiveTab(id as typeof activeTab)}
      />
      {activeTab === 'users' ? (
        <SearchBar value={searchQuery} onChangeText={setSearchQuery} placeholder="Search users" />
      ) : null}

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      >
        {activeTab === 'users' ? (
          <View style={styles.section}>
            {isFetchingUsers && users.length === 0 ? (
              <View style={styles.centerContainer}>
                <ActivityIndicator size="large" color={colors.tint} />
              </View>
            ) : users.length === 0 ? (
              <ThemedText style={styles.emptyText}>No users found</ThemedText>
            ) : (
              <View style={styles.list}>
                {users.map((user) => (
                  <FriendCard key={`user-${user.id}`} user={user} />
                ))}
              </View>
            )}
            {hasNextPage ? (
              <TouchableOpacity
                style={styles.loadMore}
                onPress={handleLoadMore}
                disabled={isFetchingNextPage}
              >
                <ThemedText style={styles.loadMoreText}>
                  {isFetchingNextPage ? 'Loading...' : 'Load more'}
                </ThemedText>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

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
    emptyText: {
      fontSize: 14,
      color: colors.textSecondary,
    },
    centerContainer: {
      paddingVertical: 16,
      alignItems: 'center',
    },
    loadMore: {
      alignSelf: 'flex-start',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 8,
      backgroundColor: colors.pillBackground,
    },
    loadMoreText: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.pillText,
    },
  });
