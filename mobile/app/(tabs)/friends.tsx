/**
 * Expo Router screen/module for (tabs) / friends. It controls navigation and screen-level state for this route.
 *
 * Two modes, not four tabs. The screen used to open on a row of four pills —
 * All Users / Requests Received / Requests Sent / Friends — which made the
 * thing almost every visit is for (your friends) one of four equal-looking
 * options, and hid the one thing that is actually waiting on you (someone has
 * asked to be your friend) behind a pill you had to know to press.
 *
 * Now "Friends" is a single scrollable list with incoming requests sectioned at
 * the top, anything you have sent under them, and your friends trailing at the
 * bottom — the whole state of your friendships in one scroll, with a pending
 * request impossible to miss. "Find people" is a different job (search
 * strangers, or show them your QR code), so it gets its own mode rather than a
 * pill in among the rest.
 *
 * Every row is a `FriendCard`, which already adapts to the relationship, so a
 * request row carries Accept/Decline and a friend row carries the per-friend
 * visibility control without this screen knowing the difference.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
import { ThemedRefreshControl } from '@/components/themed-refresh-control';
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MeService, type UserWithFriendStatus } from 'shared';
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
import ShareInviteLinkButton from '@/components/friends/ShareInviteLinkButton';
import { SkeletonRows } from '@/components/ui/SkeletonRows';
import LoadMoreFooter from '@/components/ui/LoadMoreFooter';
import SegmentedControl, { type SegmentedOption } from '@/components/ui/SegmentedControl';
import { buildFriendInviteUrl } from '@/constants/friend-invite';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';

/** Friend rows carry the visibility control, so their skeleton is taller than a plain user row. */
const FRIEND_ROW_SKELETON_HEIGHT = 104;
/** The QR plate is a fixed size, so its loading state has to match it exactly. */
const QR_SIZE = 210;

type FriendsMode = 'friends' | 'discover';

const MODE_OPTIONS: readonly SegmentedOption<FriendsMode>[] = [
  { value: 'friends', label: 'Friends', icon: 'people' },
  { value: 'discover', label: 'Find people', icon: 'person-search' },
];

/** Which mode a `?tab=` deep link lands in. The old pill ids still resolve. */
const MODE_BY_DEEP_LINK_TAB: Record<string, FriendsMode> = {
  users: 'discover',
  received: 'friends',
  sent: 'friends',
  friends: 'friends',
};

type FriendsSection = {
  key: 'received' | 'friends' | 'sent';
  title: string;
  count: number;
  /** Sets a section apart when it needs answering rather than just reading. */
  isCallToAction?: boolean;
  data: UserWithFriendStatus[];
};

/** Stable empty list for the loading/refreshing state, so SectionList's item
 *  type is still inferred from `FriendsSection` rather than from `never[]`. */
const EMPTY_SECTIONS: FriendsSection[] = [];

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
  const { tab } = useLocalSearchParams<{ tab?: string | string[] }>();
  const requestedMode = useMemo((): FriendsMode | null => {
    const normalizedTab = Array.isArray(tab) ? tab[0] : tab;
    return normalizedTab ? (MODE_BY_DEEP_LINK_TAB[normalizedTab] ?? null) : null;
  }, [tab]);
  // Friends first: it is what almost every visit is for, and it is where a
  // pending request now surfaces without having to be looked for.
  const [mode, setMode] = useState<FriendsMode>(requestedMode ?? 'friends');

  useEffect(() => {
    if (requestedMode === null) return;
    setMode(requestedMode);
  }, [requestedMode]);

  const isDiscovering = mode === 'discover';

  // Build the filter payload from current UI selections.
  const userFilters = useMemo(
    () => ({ query: normalizedSearchQuery }),
    [normalizedSearchQuery]
  );

  // Searching strangers is the only list here that needs pagination.
  const {
    data: usersData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching: isFetchingUsers,
  } = useFetchUsers({
    limit: 20,
    filters: userFilters,
    enabled: isDiscovering && hasUserSearch,
  });

  const { data: friendsData, isFetching: isFetchingFriends } = useFetchFriends({
    enabled: !isDiscovering,
  });
  const { data: receivedRequests, isFetching: isFetchingReceived } = useFetchReceivedRequests();
  const { data: sentRequests } = useFetchSentRequests({ enabled: !isDiscovering });
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

  // The search box narrows whatever is already on screen, so a name typed while
  // looking at your friends filters all three sections at once rather than
  // sending you off to search strangers.
  const sections = useMemo((): FriendsSection[] => {
    const displayedReceived = received.filter((user) => matchName(user.display_name));
    const displayedFriends = friends.filter((user) => matchName(user.display_name));
    const displayedSent = sent.filter((user) => matchName(user.display_name));
    const built: FriendsSection[] = [];
    if (displayedReceived.length > 0) {
      built.push({
        key: 'received',
        title: 'Wants to be friends',
        count: displayedReceived.length,
        isCallToAction: true,
        data: displayedReceived,
      });
    }
    if (displayedSent.length > 0) {
      built.push({
        key: 'sent',
        title: 'Requests you sent',
        count: displayedSent.length,
        data: displayedSent,
      });
    }
    // Always present, even at zero: it is the section the user came for, and
    // its footer is where the "no friends yet" prompt lives.
    built.push({
      key: 'friends',
      title: 'Your friends',
      count: displayedFriends.length,
      data: displayedFriends,
    });
    return built;
  }, [friends, matchName, received, sent]);

  const isLoadingFriendsView =
    (isFetchingFriends || isFetchingReceived) && friends.length === 0 && received.length === 0;

  const searchPlaceholder = isDiscovering ? 'Search everyone' : 'Search your friends';
  const inviteUrl = useMemo(
    () => (currentUser?.id ? buildFriendInviteUrl(currentUser.id) : null),
    [currentUser?.id]
  );
  const inviteUsername = useMemo(
    () => currentUser?.display_name?.trim() || null,
    [currentUser?.display_name]
  );

  // Refresh the current dataset and reset any stale pagination state.
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      if (isDiscovering) {
        if (hasUserSearch) {
          await resetInfiniteQuery(queryClient, ['users', userFilters]);
        }
        return;
      }
      // One mode, one scroll, so all three of its lists refresh together —
      // refreshing only the section in view would leave the ones above and
      // below it stale on the same screen.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['users', 'receivedRequests'] }),
        queryClient.invalidateQueries({ queryKey: ['users', 'friends'] }),
        queryClient.invalidateQueries({ queryKey: ['users', 'sentRequests'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  // Request the next page when the list nears the end.
  const handleLoadMore = () => {
    if (hasUserSearch && hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  };

  const handleChangeMode = useCallback((next: FriendsMode) => {
    // The query means something different on each side (a stranger's name vs.
    // one of your own friends'), so carrying it across would silently apply a
    // filter to a list the user has not looked at yet.
    setSearchQuery('');
    setMode(next);
  }, []);

  const inviteCard = (
    <View style={styles.inviteCard}>
      <ThemedText style={styles.inviteTitle}>Scan To Add Me</ThemedText>
      {inviteUsername ? (
        <ThemedText style={styles.inviteUsername}>{inviteUsername}</ThemedText>
      ) : null}
      {inviteUrl ? (
        <View style={styles.qrWrapper}>
          <QRCode value={inviteUrl} size={QR_SIZE} backgroundColor="#ffffff" color="#111111" />
        </View>
      ) : (
        <View style={styles.qrLoadingWrapper}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      )}
      <ThemedText style={styles.inviteText}>
        Ask a friend to scan this code, or share your invite link.
      </ThemedText>
      <ShareInviteLinkButton inviteUrl={inviteUrl} />
    </View>
  );

  // Render/output using the state and derived values prepared above.
  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar title="Friends" />
      <View style={styles.modeRow}>
        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={handleChangeMode}
          accessibilityLabelPrefix="Show"
          stretch
          size="large"
        />
      </View>
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder={searchPlaceholder}
        clearOnAndroidBack
      />

      {isDiscovering ? (
        <FlatList
          data={hasUserSearch && refreshing ? [] : displayedUsers}
          keyExtractor={(item) => `user-${item.id}`}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          renderItem={({ item }) => <FriendCard user={item} showStatusBadge />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListEmptyComponent={
            !hasUserSearch ? (
              inviteCard
            ) : isFetchingUsers || refreshing ? (
              <SkeletonRows height={64} />
            ) : (
              <View style={styles.emptyCard}>
                <ThemedText style={styles.emptyTitle}>No one found</ThemedText>
                <ThemedText style={styles.emptyText}>
                  Try a different name, or show them your QR code instead.
                </ThemedText>
              </View>
            )
          }
          ListFooterComponent={<LoadMoreFooter loading={isFetchingNextPage} size="small" />}
        />
      ) : (
        <SectionList
          sections={refreshing || isLoadingFriendsView ? EMPTY_SECTIONS : sections}
          keyExtractor={(item) => `friend-row-${item.id}`}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
          refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <FriendCard user={item} />
            </View>
          )}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <ThemedText
                style={[
                  styles.sectionTitle,
                  section.isCallToAction && styles.sectionTitleCallToAction,
                ]}
              >
                {section.title}
              </ThemedText>
              <View
                style={[
                  styles.sectionCount,
                  section.isCallToAction && styles.sectionCountCallToAction,
                ]}
              >
                <ThemedText
                  style={[
                    styles.sectionCountText,
                    section.isCallToAction && styles.sectionCountTextCallToAction,
                  ]}
                >
                  {section.count}
                </ThemedText>
              </View>
            </View>
          )}
          renderSectionFooter={({ section }) =>
            section.data.length === 0 ? (
              <View style={styles.emptyCard}>
                <ThemedText style={styles.emptyTitle}>
                  {hasUserSearch ? 'No matches' : 'No friends yet'}
                </ThemedText>
                <ThemedText style={styles.emptyText}>
                  {hasUserSearch
                    ? 'Nobody in your friends matches that name.'
                    : 'Find people by name, or let them scan your QR code.'}
                </ThemedText>
              </View>
            ) : null
          }
          ListEmptyComponent={<SkeletonRows height={FRIEND_ROW_SKELETON_HEIGHT} />}
          ListFooterComponent={
            // The invite card sits at the bottom of your own list rather than
            // behind a separate tab: adding people is the natural next thing
            // after looking at who you already have.
            refreshing || isLoadingFriendsView ? null : (
              <View style={styles.inviteFooter}>{inviteCard}</View>
            )
          }
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
    modeRow: {
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    content: {
      padding: 16,
      paddingTop: 4,
      paddingBottom: 24,
    },
    row: {
      paddingBottom: 12,
    },
    separator: {
      height: 12,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingTop: 10,
      paddingBottom: 8,
    },
    sectionTitle: {
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.3,
      textTransform: 'uppercase',
      color: colors.textSecondary,
    },
    // A pending request is the one thing on this screen waiting on the user, so
    // its heading carries the app's "needs you" colour.
    sectionTitleCallToAction: {
      color: colors.orange.secondary,
    },
    sectionCount: {
      minWidth: 22,
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceMuted,
    },
    sectionCountCallToAction: {
      backgroundColor: colors.orange.primary,
    },
    sectionCountText: {
      fontSize: 11,
      fontWeight: '700',
      color: colors.textSecondary,
    },
    sectionCountTextCallToAction: {
      color: colors.orange.secondary,
    },
    emptyCard: {
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingVertical: 20,
      paddingHorizontal: 16,
    },
    inviteFooter: {
      paddingTop: 24,
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
    inviteUsername: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
      textAlign: 'center',
    },
    // A QR code needs its white quiet zone to scan, in either colour scheme.
    qrWrapper: {
      borderRadius: 12,
      padding: 12,
      backgroundColor: '#ffffff',
      borderWidth: 1,
      borderColor: colors.divider,
    },
    qrLoadingWrapper: {
      width: QR_SIZE,
      height: QR_SIZE,
      borderRadius: 12,
      backgroundColor: colors.surfaceMuted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    inviteText: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
    },
    emptyTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    emptyText: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.textSecondary,
      textAlign: 'center',
    },
  });
