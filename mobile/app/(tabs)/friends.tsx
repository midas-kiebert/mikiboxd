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
 * The two modes are pages of a pager as well as segments of a control: the
 * finger drags between them, and the thumb travels to meet whichever page it
 * was let go on. Both are mounted at once, so the page being dragged into view
 * already holds its rows rather than being built on release.
 *
 * Every row is a `FriendCard`, which already adapts to the relationship, so a
 * request row carries Accept/Decline and a friend row carries the per-friend
 * visibility control without this screen knowing the difference.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  FlatList,
  SectionList,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';
import {
  pullToRefreshContentStyle,
  pullToRefreshScrollProps,
  ThemedRefreshControl,
} from '@/components/themed-refresh-control';
import TopSafeAreaView from '@/components/layout/TopSafeAreaView';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MeService, type UserWithFriendStatus } from 'shared';
import { useFetchUsers } from 'shared/hooks/useFetchUsers';
import { useFetchFriends } from 'shared/hooks/useFetchFriends';
import { useFetchReceivedRequests } from 'shared/hooks/useFetchReceivedRequests';
import { useFetchSentRequests } from 'shared/hooks/useFetchSentRequests';
import QRCode from 'react-native-qrcode-svg';

import { ThemedText } from '@/components/themed-text';
import { tabletCappedContentStyle } from '@/constants/tablet-layout';
import { useThemeColors } from '@/hooks/use-theme-color';
import TopBar from '@/components/layout/TopBar';
import SearchBar from '@/components/inputs/SearchBar';
import FriendCard from '@/components/friends/FriendCard';
import SignedOutPanel from '@/components/auth/SignedOutPanel';
import ShareInviteLinkButton from '@/components/friends/ShareInviteLinkButton';
import ListLoadingLogo from '@/components/layout/ListLoadingLogo';
import { useDelayedTrue } from '@/hooks/useDelayedTrue';
import { LOADING_LOGO_DELAY_MS, LOADING_LOGO_COOLDOWN_MS } from '@/constants/loading-logo';
import LoadMoreFooter from '@/components/ui/LoadMoreFooter';
import { FeedItemEntrance } from '@/components/ui/FeedItemEntrance';
import SegmentedControl, { type SegmentedOption } from '@/components/ui/SegmentedControl';
import { buildFriendInviteUrl } from '@/constants/friend-invite';
import { useIsSignedIn } from '@/utils/auth-session';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useSwipePager } from '@/hooks/useSwipePager';
import { resetInfiniteQuery } from '@/utils/reset-infinite-query';
import { triggerSelectionHaptic } from '@/utils/long-press';
import TabScreenSkeleton from '@/components/layout/TabScreenSkeleton';
import { tabContentHoldMs } from '@/components/tab-bar';
import { useDeferredMount } from '@/utils/use-deferred-mount';

/** What signing in would put on this tab, in the order it would appear. */
const FRIENDS_HIGHLIGHTS = [
  "See which screenings your friends are going to",
  "Invite them along, or accept an invite",
  "Find people by username, or share your own link",
] as const;

/** The QR plate is a fixed size, so its loading state has to match it exactly. */
const QR_SIZE = 210;

/** Matches `UserSearchResults` and the other search screens' debounce. */
const SEARCH_DEBOUNCE_MS = 280;

type FriendsMode = 'friends' | 'discover';

/** Left to right: the order of the segments *and* of the pages behind them. */
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

function FriendsScreen() {
  // Read flow: local state and data hooks first, then handlers, then the JSX screen.
  const colors = useThemeColors();
  const styles = createStyles(colors);
  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();
  // Every list on this tab is a relationship between two accounts. A guest has
  // neither end of one, so the tab shows what it would be for instead — and no
  // query below it runs.
  const isSignedIn = useIsSignedIn();

  // Current text typed into the search input.
  const [searchQuery, setSearchQuery] = useState('');
  const normalizedSearchQuery = searchQuery.trim();
  const normalizedSearchQueryLower = normalizedSearchQuery.toLowerCase();
  // The friends list below is filtered locally on every keystroke — cheap,
  // and instant is exactly what that box should feel like. Strangers are
  // filtered on the server, so that half waits for typing to settle: firing
  // a request per keystroke raced each one's response against the next,
  // occasionally landing an older, shorter page's row on top of the latest
  // one's.
  const debouncedSearchQuery = useDebouncedValue(normalizedSearchQuery, SEARCH_DEBOUNCE_MS);
  const hasUserSearch = normalizedSearchQuery.length > 0;
  const hasDebouncedUserSearch = debouncedSearchQuery.length > 0;
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
  const [prevRequestedMode, setPrevRequestedMode] = useState(requestedMode);
  if (requestedMode !== prevRequestedMode) {
    setPrevRequestedMode(requestedMode);
    if (requestedMode !== null) {
      setMode(requestedMode);
    }
  }

  const isDiscovering = mode === 'discover';
  const modeIndex = Math.max(
    0,
    MODE_OPTIONS.findIndex((option) => option.value === mode)
  );
  const { width: pageWidth } = useWindowDimensions();

  // Build the filter payload from current UI selections.
  const userFilters = useMemo(
    () => ({ query: debouncedSearchQuery }),
    [debouncedSearchQuery]
  );

  // Searching strangers is the only list here that needs pagination. It stays
  // gated on the mode, unlike the lists below: it is the one query here that
  // costs a request per keystroke, and the box is cleared on every switch, so
  // that page never has anything worth preloading anyway.
  const {
    data: usersData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetching: isFetchingUsers,
  } = useFetchUsers({
    limit: 20,
    filters: userFilters,
    enabled: isSignedIn && isDiscovering && hasDebouncedUserSearch,
  });

  // Not gated on the mode any more: the two modes are pages of one pager, and
  // the Friends page has to already hold its rows when the finger drags it into
  // view rather than filling in behind the swipe.
  // `isLoading`, never `isFetching`: react-query only re-renders for the result
  // fields a component actually reads, and `isFetching` moves on every fetch of
  // these shared queries — including the ones other screens start. Reading it
  // here re-rendered this whole screen twice on each showtime-sheet open, from
  // behind the sheet. `isLoading` only moves while there is no data yet.
  const { data: friendsData, isLoading: isLoadingFriends } = useFetchFriends({
    enabled: isSignedIn,
  });
  const { data: receivedRequests, isLoading: isLoadingReceived } = useFetchReceivedRequests({
    enabled: isSignedIn,
  });
  const { data: sentRequests } = useFetchSentRequests({
    enabled: isSignedIn,
  });
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => MeService.getCurrentUser(),
    enabled: isSignedIn,
  });

  // Flatten/derive list data for rendering efficiency.
  const users = useMemo(() => usersData?.pages.flat() ?? [], [usersData]);
  const displayedUsers = hasDebouncedUserSearch ? users : [];
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

  // A name typed here only ever searches people you already know, and plenty
  // of people expect the opposite — so when it comes back with nothing, the
  // empty state offers the search they probably meant.
  const hasNoSearchMatches =
    hasUserSearch && sections.every((section) => section.data.length === 0);

  const isLoadingFriendsView =
    (isLoadingFriends || isLoadingReceived) && friends.length === 0 && received.length === 0;

  // Whichever list is on screen, waiting on its first rows. `refreshing` is
  // deliberately not in here: ThemedRefreshControl's own spinner already says
  // a reload is running, and the rows stay up until the fresh ones land.
  const isListLoading =
    !refreshing &&
    (isDiscovering
      ? hasDebouncedUserSearch && isFetchingUsers && displayedUsers.length === 0
      : isLoadingFriendsView);
  const showLoadingLogo = useDelayedTrue(
    isListLoading,
    LOADING_LOGO_DELAY_MS,
    LOADING_LOGO_COOLDOWN_MS
  );

  const searchPlaceholder = isDiscovering ? 'Search everyone' : 'Search your friends';
  const currentUserId = currentUser?.id;
  const inviteUrl = useMemo(
    () => (currentUserId ? buildFriendInviteUrl(currentUserId) : null),
    [currentUserId]
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

  // `useRef` rather than a value: `handleChangeMode` is handed to the pager as
  // `onIndexChange`, so it cannot close over the pager it is being built with.
  const goToPageRef = useRef<((index: number) => void) | null>(null);

  const handleChangeMode = useCallback((next: FriendsMode) => {
    // Start the pages moving here rather than from the render this causes:
    // until that commit lands, nothing driven by React state has moved. A
    // swipe arrives with the movement already under way; this is a tap doing
    // the same.
    goToPageRef.current?.(MODE_OPTIONS.findIndex((option) => option.value === next));
    // The query means something different on each side (a stranger's name vs.
    // one of your own friends'), so carrying it across would silently apply a
    // filter to a list the user has not looked at yet.
    setSearchQuery('');
    setMode(next);
  }, []);

  const handleChangeIndex = useCallback(
    // No haptic: a swipe is a continuous gesture the user is already watching
    // answer them, unlike a tap, where the segment fires one of its own.
    (index: number) => handleChangeMode(MODE_OPTIONS[index].value),
    [handleChangeMode]
  );

  const { progress, panGesture, goTo } = useSwipePager({
    pageCount: MODE_OPTIONS.length,
    index: modeIndex,
    onIndexChange: handleChangeIndex,
    pageWidth,
  });
  useEffect(() => {
    goToPageRef.current = goTo;
  });

  const pagerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -progress.value * pageWidth }],
  }));

  // Unlike switching modes by hand, this carries the query across: the whole
  // point is to run the name they already typed against everyone.
  const handleSearchEveryone = useCallback(() => {
    triggerSelectionHaptic();
    setMode('discover');
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

  // The two pages, in the order `MODE_OPTIONS` lists them. Both are built every
  // render now rather than one being chosen — see the pager below.
  const friendsPage = (
    <SectionList
      // Not cleared for a refresh: ThemedRefreshControl's own spinner
      // already says a reload is running, and the rows it replaces stay
      // up until the fresh ones land.
      sections={isLoadingFriendsView ? EMPTY_SECTIONS : sections}
      keyExtractor={(item) => `friend-row-${item.id}`}
      contentContainerStyle={[styles.content, pullToRefreshContentStyle]}
      {...pullToRefreshScrollProps}
      showsVerticalScrollIndicator={false}
      stickySectionHeadersEnabled={false}
      refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      // Per-section index, so each section cascades from its own header rather
      // than the ones below the first all arriving together.
      renderItem={({ item, index }) => (
        <FeedItemEntrance index={index}>
          <View style={styles.row}>
            <FriendCard user={item} />
          </View>
        </FeedItemEntrance>
      )}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <ThemedText
            style={[styles.sectionTitle, section.isCallToAction && styles.sectionTitleCallToAction]}
          >
            {section.title}
          </ThemedText>
          <View
            style={[styles.sectionCount, section.isCallToAction && styles.sectionCountCallToAction]}
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
              {!hasUserSearch
                ? 'Find people by name, or let them scan your QR code.'
                : hasNoSearchMatches
                  ? 'This box only searches people you are already friends with.'
                  : 'Nobody in your friends matches that name.'}
            </ThemedText>
            {hasNoSearchMatches ? (
              <TouchableOpacity
                style={styles.emptyAction}
                onPress={handleSearchEveryone}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Search everyone for ${normalizedSearchQuery}`}
              >
                <MaterialIcons name="person-search" size={17} color={colors.pillActiveText} />
                <ThemedText style={styles.emptyActionText}>Find people instead</ThemedText>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null
      }
      // Only ever empty of *sections* while loading (see `sections`
      // above), and the loading panel is a fixed overlay below rather
      // than list content — a section with no rows says so in its own
      // footer instead.
      ListEmptyComponent={null}
      ListFooterComponent={
        // The invite card sits at the bottom of your own list rather than
        // behind a separate tab: adding people is the natural next thing
        // after looking at who you already have.
        isLoadingFriendsView ? null : <View style={styles.inviteFooter}>{inviteCard}</View>
      }
    />
  );

  const discoverPage = (
    <FlatList
      data={displayedUsers}
      keyExtractor={(item) => `user-${item.id}`}
      contentContainerStyle={[styles.content, pullToRefreshContentStyle]}
      {...pullToRefreshScrollProps}
      showsVerticalScrollIndicator={false}
      refreshControl={<ThemedRefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      renderItem={({ item, index }) => (
        <FeedItemEntrance index={index}>
          <FriendCard user={item} showStatusBadge />
        </FeedItemEntrance>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
      onEndReached={handleLoadMore}
      onEndReachedThreshold={0.4}
      ListEmptyComponent={
        // The loading panel is a fixed overlay (below), not part of the
        // list's own content, so there's nothing to render here while a
        // search is still coming back. No card for "no search yet" any
        // more either: the invite card below covers that case on its own.
        hasDebouncedUserSearch && !isListLoading && !refreshing ? (
          <View style={styles.emptyCard}>
            <ThemedText style={styles.emptyTitle}>No one found</ThemedText>
            <ThemedText style={styles.emptyText}>
              Try a different name, or show them your QR code instead.
            </ThemedText>
          </View>
        ) : null
      }
      ListFooterComponent={
        // Always under the results, not swapped in only when there are
        // none: someone who found who they wanted can still add a second
        // person by having them scan, without clearing the search first.
        // The load-more spinner only reserves its row while there are rows
        // to paginate — otherwise (no query yet, or "No one found") it's
        // just dead space between the message above and the QR code.
        <View style={styles.inviteFooterNoResults}>
          {displayedUsers.length > 0 ? (
            <LoadMoreFooter loading={isFetchingNextPage} size="small" />
          ) : null}
          {inviteCard}
        </View>
      }
    />
  );

  // Render/output using the state and derived values prepared above.
  if (!isSignedIn) {
    return (
      <TopSafeAreaView style={styles.container}>
        <TopBar title="Friends" icon="person.2.fill" />
        <SignedOutPanel feature="friends" bullets={FRIENDS_HIGHLIGHTS} />
      </TopSafeAreaView>
    );
  }

  return (
    <TopSafeAreaView style={styles.container}>
      <TopBar title="Friends" icon="person.2.fill" />
      <View style={styles.modeRow}>
        <SegmentedControl
          options={MODE_OPTIONS}
          value={mode}
          onChange={handleChangeMode}
          accessibilityLabelPrefix="Show"
          stretch
          size="large"
          progress={progress}
        />
      </View>
      <SearchBar
        value={searchQuery}
        onChangeText={setSearchQuery}
        placeholder={searchPlaceholder}
        clearOnAndroidBack
      />

      <View style={styles.listWrapper}>
        <GestureDetector gesture={panGesture}>
          <Animated.View
            style={[styles.pager, { width: pageWidth * MODE_OPTIONS.length }, pagerStyle]}
            renderToHardwareTextureAndroid
          >
            <View style={{ width: pageWidth }}>{friendsPage}</View>
            <View style={{ width: pageWidth }}>{discoverPage}</View>
          </Animated.View>
        </GestureDetector>
        {/* An overlay, not either list's ListEmptyComponent: that content
            scrolls and shifts with RefreshControl's pull, which reads as the
            logo drifting down the screen. Sitting outside the list keeps it
            fixed and (via pointerEvents="none") never intercepts the
            pull-to-refresh gesture underneath it. */}
        {showLoadingLogo ? (
          <View style={styles.loadingOverlay} pointerEvents="none">
            <ListLoadingLogo />
          </View>
        ) : null}
      </View>
    </TopSafeAreaView>
  );
}

const createStyles = (colors: typeof import('@/constants/theme').Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    // The row of pages is wider than the screen, so the window it moves behind
    // has to clip it — on Android nothing else does.
    listWrapper: { flex: 1, overflow: 'hidden' },
    pager: { flex: 1, flexDirection: 'row' },
    loadingOverlay: { ...StyleSheet.absoluteFill },
    modeRow: {
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    content: {
      ...tabletCappedContentStyle,
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
    emptyAction: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginTop: 10,
      borderRadius: 14,
      backgroundColor: colors.tint,
      paddingHorizontal: 18,
      paddingVertical: 10,
    },
    emptyActionText: {
      color: colors.pillActiveText,
      fontSize: 14,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
    inviteFooter: {
      paddingTop: 24,
    },
    // Used on the discover page, where the invite card follows either the
    // reserved load-more row or nothing at all — neither needs its own
    // clearance on top of that.
    inviteFooterNoResults: {
      paddingTop: 0,
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

/**
 * The shell in front of the screen above.
 *
 * A tab is built the first time it is opened, and until it is, the tab you
 * pressed away from stays on screen — which reads as the press being ignored.
 * The gate is a component of its own so that every hook the screen owns lives
 * *behind* it: an early return inside one component would only defer the
 * render, not the queries and subscriptions that set it up.
 *
 * The wait is whatever {@link tabContentHoldMs} still owes the tab bar's press
 * flash, so the mount takes the UI thread only once that movement is over
 * rather than stalling it half-way. Once a tab has been built it is never
 * gated again.
 */
export default function FriendsScreenTab() {
  const ready = useDeferredMount('tab:friends', tabContentHoldMs);
  if (!ready) return <TabScreenSkeleton title="Friends" icon="person.2.fill" />;
  return <FriendsScreen />;
}
