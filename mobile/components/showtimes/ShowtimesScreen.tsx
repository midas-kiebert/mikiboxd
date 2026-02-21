/**
 * Mobile showtimes feature component: Showtimes Screen.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  FlatList,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { SafeAreaView } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { ShowtimesService, type GoingStatus, type ShowtimeLoggedIn } from "shared";
import { useFetchFriends } from "shared/hooks/useFetchFriends";

import { ThemedText } from "@/components/themed-text";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useThemeColors } from "@/hooks/use-theme-color";
import TopBar from "@/components/layout/TopBar";
import SearchBar from "@/components/inputs/SearchBar";
import FilterPills from "@/components/filters/FilterPills";
import ShowtimeCard from "@/components/showtimes/ShowtimeCard";

type FriendPingAvailability = "eligible" | "pinged" | "going" | "interested";

type FilterOption<TId extends string = string> = {
  id: TId;
  label: string;
  badgeCount?: number;
  activeBackgroundColor?: string;
  activeTextColor?: string;
  activeBorderColor?: string;
};

type ShowtimesScreenProps<TFilterId extends string = string> = {
  topBarTitle?: string;
  topBarTitleSuffix?: string;
  topBarShowBackButton?: boolean;
  showtimes: ShowtimeLoggedIn[];
  isLoading: boolean;
  isFetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage?: boolean;
  onLoadMore: () => void;
  refreshing: boolean;
  onRefresh: () => void;
  searchQuery: string;
  onSearchChange: (value: string) => void;
  filters: ReadonlyArray<FilterOption<TFilterId>>;
  activeFilterIds: ReadonlyArray<TFilterId>;
  onToggleFilter: (id: TFilterId) => void;
  emptyText?: string;
};

export default function ShowtimesScreen<TFilterId extends string = string>({
  topBarTitle = "MIKINO",
  topBarTitleSuffix,
  topBarShowBackButton = false,
  showtimes,
  isLoading,
  isFetching,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  refreshing,
  onRefresh,
  searchQuery,
  onSearchChange,
  filters,
  activeFilterIds,
  onToggleFilter,
  emptyText = "No showtimes found",
}: ShowtimesScreenProps<TFilterId>) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const colorScheme = useColorScheme();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const [selectedShowtime, setSelectedShowtime] = useState<ShowtimeLoggedIn | null>(null);
  const [pingListOpen, setPingListOpen] = useState(false);
  const [pingedFriendIds, setPingedFriendIds] = useState<string[]>([]);
  const modalProgress = useRef(new Animated.Value(0)).current;
  // React Query client used for cache updates and invalidation.
  const queryClient = useQueryClient();
  const { data: friends } = useFetchFriends({ enabled: !!selectedShowtime });

  useEffect(() => {
    if (!selectedShowtime) {
      modalProgress.setValue(0);
      setPingListOpen(false);
      setPingedFriendIds([]);
      return;
    }
    setPingListOpen(false);
    setPingedFriendIds([]);
    modalProgress.setValue(0);
    Animated.timing(modalProgress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [modalProgress, selectedShowtime]);

  const { mutate: updateShowtimeSelection, isPending: isUpdatingShowtimeSelection } = useMutation({
    mutationFn: ({ showtimeId, going }: { showtimeId: number; going: GoingStatus }) =>
      ShowtimesService.updateShowtimeSelection({
        showtimeId,
        requestBody: {
          going_status: going,
        },
      }),
    onSuccess: () => {
      setSelectedShowtime(null);
    },
    onError: (error) => {
      console.error("Error updating showtime selection:", error);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["showtimes"] });
      queryClient.invalidateQueries({ queryKey: ["movie"] });
      queryClient.invalidateQueries({ queryKey: ["movies"] });
    },
  });

  const { mutate: pingFriendForShowtime, isPending: isPingingFriend } = useMutation({
    mutationFn: ({ showtimeId, friendId }: { showtimeId: number; friendId: string }) =>
      ShowtimesService.pingFriendForShowtime({
        showtimeId,
        friendId,
      }),
    onSuccess: (_message, variables) => {
      setPingedFriendIds((previous) =>
        previous.includes(variables.friendId) ? previous : [...previous, variables.friendId]
      );
    },
    onError: (error) => {
      console.error("Error pinging friend for showtime:", error);
      Alert.alert("Error", "Could not send ping.");
    },
  });

  // Submit the selected going/interested/not-going status.
  const handleShowtimeStatusUpdate = (going: GoingStatus) => {
    if (!selectedShowtime || isUpdatingShowtimeSelection) return;
    updateShowtimeSelection({ showtimeId: selectedShowtime.id, going });
  };

  // Open the selected showtime ticket URL in the system browser.
  const handleOpenTicketLink = async () => {
    const ticketLink = selectedShowtime?.ticket_link;
    if (!ticketLink) return;
    const canOpen = await Linking.canOpenURL(ticketLink);
    if (canOpen) {
      await Linking.openURL(ticketLink);
    }
  };

  const handlePingFriend = (friendId: string) => {
    if (!selectedShowtime || isPingingFriend) return;
    pingFriendForShowtime({
      showtimeId: selectedShowtime.id,
      friendId,
    });
  };

  const friendsGoingIds = useMemo(() => {
    if (!selectedShowtime) {
      return new Set<string>();
    }
    return new Set<string>(selectedShowtime.friends_going.map((friend) => friend.id));
  }, [selectedShowtime]);

  const friendsInterestedIds = useMemo(() => {
    if (!selectedShowtime) {
      return new Set<string>();
    }
    return new Set<string>(
      selectedShowtime.friends_interested.map((friend) => friend.id)
    );
  }, [selectedShowtime]);

  const friendsForPing = useMemo(() => {
    const availabilityRank: Record<FriendPingAvailability, number> = {
      eligible: 0,
      pinged: 1,
      interested: 2,
      going: 3,
    };
    return (friends ?? [])
      .map((friend) => {
        const isGoing = friendsGoingIds.has(friend.id);
        const isInterested = friendsInterestedIds.has(friend.id);
        const alreadyPinged = pingedFriendIds.includes(friend.id);
        const availability: FriendPingAvailability = isGoing
          ? "going"
          : isInterested
            ? "interested"
            : alreadyPinged
              ? "pinged"
              : "eligible";
        const label = friend.display_name?.trim() || "Friend";
        return {
          id: friend.id,
          label,
          initial: label.charAt(0).toUpperCase(),
          availability,
        };
      })
      .sort((left, right) => {
        const rankDifference =
          availabilityRank[left.availability] - availabilityRank[right.availability];
        if (rankDifference !== 0) {
          return rankDifference;
        }
        return left.label.localeCompare(right.label);
      });
  }, [friends, friendsGoingIds, friendsInterestedIds, pingedFriendIds]);

  const isGoingSelected = selectedShowtime?.going === "GOING";
  const isInterestedSelected = selectedShowtime?.going === "INTERESTED";
  const isNotGoingSelected = selectedShowtime?.going === "NOT_GOING";
  const statusModalBackdropAnimatedStyle = {
    opacity: modalProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, 1],
    }),
  };
  const statusModalCardAnimatedStyle = {
    opacity: modalProgress,
    transform: [
      {
        translateY: modalProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [18, 0],
        }),
      },
    ],
  };

  // Render infinite-scroll loading feedback at the bottom of the list.
  const renderFooter = () => {
    if (!isFetchingNextPage) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="large" color={colors.tint} />
      </View>
    );
  };

  // Render the empty/loading state when list data is unavailable.
  const renderEmpty = () => {
    if (isLoading || isFetching) {
      return (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color={colors.tint} />
        </View>
      );
    }
    return (
      <View style={styles.centerContainer}>
        <ThemedText style={styles.emptyText}>{emptyText}</ThemedText>
      </View>
    );
  };

  // Render/output using the state and derived values prepared above.
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <TopBar
        title={topBarTitle}
        titleSuffix={topBarTitleSuffix}
        showBackButton={topBarShowBackButton}
      />
      <Modal
        transparent
        visible={!!selectedShowtime}
        animationType="none"
        onRequestClose={() => {
          if (!isUpdatingShowtimeSelection) {
            setSelectedShowtime(null);
          }
        }}
      >
        <Animated.View style={[styles.statusModalBackdrop, statusModalBackdropAnimatedStyle]}>
          <BlurView
            style={styles.statusModalBlur}
            intensity={4}
            tint={colorScheme === "dark" ? "dark" : "light"}
            experimentalBlurMethod="dimezisBlurView"
          />
          <View style={styles.statusModalTint} />
          <Pressable
            style={styles.statusModalDismissArea}
            onPress={() => {
              if (!isUpdatingShowtimeSelection) {
                setSelectedShowtime(null);
              }
            }}
          />
          <Animated.View style={[styles.statusModalCard, statusModalCardAnimatedStyle]}>
            <ThemedText style={styles.statusModalTitle}>Update your status</ThemedText>
            {selectedShowtime ? (
              <ThemedText style={styles.statusModalSubtitle}>
                {DateTime.fromISO(selectedShowtime.datetime).toFormat("ccc, LLL d, HH:mm")} •{" "}
                {selectedShowtime.cinema.name}
              </ThemedText>
            ) : null}
            <TouchableOpacity
              style={[
                styles.ticketButton,
                !selectedShowtime?.ticket_link && styles.ticketButtonDisabled,
              ]}
              disabled={!selectedShowtime?.ticket_link}
              onPress={handleOpenTicketLink}
              activeOpacity={0.8}
            >
              <ThemedText
                style={[
                  styles.ticketButtonText,
                  !selectedShowtime?.ticket_link && styles.ticketButtonTextDisabled,
                ]}
              >
                {selectedShowtime?.ticket_link ? "Open Ticket Link" : "No ticket link available"}
              </ThemedText>
            </TouchableOpacity>
            <View style={styles.statusButtons}>
              <TouchableOpacity
                style={[
                  styles.statusButton,
                  styles.statusButtonGoing,
                  isGoingSelected && styles.statusButtonActive,
                ]}
                disabled={isUpdatingShowtimeSelection}
                onPress={() => handleShowtimeStatusUpdate("GOING")}
                activeOpacity={0.8}
              >
                <ThemedText
                  style={[styles.statusButtonText, isGoingSelected && styles.statusButtonTextActive]}
                >
                  I'm Going
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.statusButton,
                  styles.statusButtonInterested,
                  isInterestedSelected && styles.statusButtonActive,
                ]}
                disabled={isUpdatingShowtimeSelection}
                onPress={() => handleShowtimeStatusUpdate("INTERESTED")}
                activeOpacity={0.8}
              >
                <ThemedText
                  style={[
                    styles.statusButtonText,
                    isInterestedSelected && styles.statusButtonTextActive,
                  ]}
                >
                  I'm Interested
                </ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.statusButton,
                  styles.statusButtonNotGoing,
                  isNotGoingSelected && styles.statusButtonActive,
                ]}
                disabled={isUpdatingShowtimeSelection}
                onPress={() => handleShowtimeStatusUpdate("NOT_GOING")}
                activeOpacity={0.8}
              >
                <ThemedText
                  style={[
                    styles.statusButtonText,
                    isNotGoingSelected && styles.statusButtonTextActive,
                  ]}
                >
                  I'm Not Going
                </ThemedText>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={styles.pingToggleButton}
              disabled={isPingingFriend}
              onPress={() => setPingListOpen((previous) => !previous)}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.pingToggleText}>
                {pingListOpen ? "Hide friends" : "Ping friends"}
              </ThemedText>
            </TouchableOpacity>
            {pingListOpen ? (
              <View style={styles.pingList}>
                <View style={styles.pingListHeader}>
                  <ThemedText style={styles.pingListTitle}>
                    Friends ({friendsForPing.length})
                  </ThemedText>
                </View>
                {friendsForPing.length === 0 ? (
                  <ThemedText style={styles.pingListEmpty}>
                    No friends yet.
                  </ThemedText>
                ) : (
                  <ScrollView
                    style={styles.pingListScroll}
                    contentContainerStyle={styles.pingListContent}
                    showsVerticalScrollIndicator
                    nestedScrollEnabled
                  >
                    {friendsForPing.map((friend) => {
                      const canPing = friend.availability === "eligible" && !isPingingFriend;
                      const statusLabel =
                        friend.availability === "going"
                          ? "Going"
                          : friend.availability === "interested"
                            ? "Interested"
                            : friend.availability === "pinged"
                              ? "Pinged"
                              : "Ready";
                      return (
                        <View key={friend.id} style={styles.pingRow}>
                          <View style={styles.pingFriendIdentity}>
                            <View style={styles.pingFriendAvatar}>
                              <ThemedText style={styles.pingFriendAvatarText}>
                                {friend.initial || "F"}
                              </ThemedText>
                            </View>
                            <View style={styles.pingFriendMeta}>
                              <ThemedText style={styles.pingFriendName}>{friend.label}</ThemedText>
                              <ThemedText style={styles.pingFriendStatus}>{statusLabel}</ThemedText>
                            </View>
                          </View>
                          <TouchableOpacity
                            style={[
                              styles.pingButton,
                              !canPing && styles.pingButtonDisabled,
                            ]}
                            disabled={!canPing}
                            onPress={() => handlePingFriend(friend.id)}
                            activeOpacity={0.8}
                          >
                            <ThemedText
                              style={[
                                styles.pingButtonText,
                                !canPing && styles.pingButtonTextDisabled,
                              ]}
                            >
                              {friend.availability === "eligible" ? "Ping" : statusLabel}
                            </ThemedText>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            ) : null}
            <TouchableOpacity
              style={styles.statusCancelButton}
              disabled={isUpdatingShowtimeSelection}
              onPress={() => setSelectedShowtime(null)}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.statusCancelText}>
                {isUpdatingShowtimeSelection ? "Updating..." : "Cancel"}
              </ThemedText>
            </TouchableOpacity>
          </Animated.View>
        </Animated.View>
      </Modal>
      <SearchBar
        value={searchQuery}
        onChangeText={onSearchChange}
        placeholder="Search showtimes"
      />
      <FilterPills
        filters={filters}
        selectedId=""
        onSelect={onToggleFilter}
        activeIds={activeFilterIds}
      />
      <FlatList
        data={showtimes}
        renderItem={({ item }) => (
          <ShowtimeCard showtime={item} onLongPress={(showtime) => setSelectedShowtime(showtime)} />
        )}
        keyExtractor={(item) => item.id.toString()}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={renderEmpty}
        ListFooterComponent={renderFooter}
        onEndReached={onLoadMore}
        onEndReachedThreshold={2}
        refreshing={isLoading}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
          />
        }
      />
    </SafeAreaView>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    listContent: {
      padding: 16,
    },
    footerLoader: {
      paddingVertical: 20,
      alignItems: "center",
    },
    statusModalBackdrop: {
      flex: 1,
      justifyContent: "center",
      padding: 20,
    },
    statusModalBlur: {
      ...StyleSheet.absoluteFillObject,
    },
    statusModalTint: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.06)",
    },
    statusModalDismissArea: {
      ...StyleSheet.absoluteFillObject,
    },
    statusModalCard: {
      backgroundColor: colors.cardBackground,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      padding: 14,
      gap: 10,
    },
    statusModalTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.text,
    },
    statusModalSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    ticketButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.tint,
      backgroundColor: colors.cardBackground,
      alignItems: "center",
      paddingVertical: 9,
      paddingHorizontal: 12,
    },
    ticketButtonDisabled: {
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    ticketButtonText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.tint,
    },
    ticketButtonTextDisabled: {
      color: colors.textSecondary,
    },
    statusButtons: {
      gap: 8,
      marginTop: 4,
    },
    statusButton: {
      borderRadius: 10,
      borderWidth: 1,
      paddingVertical: 10,
      paddingHorizontal: 12,
      alignItems: "center",
    },
    statusButtonGoing: {
      backgroundColor: colors.green.primary,
      borderColor: colors.green.secondary,
    },
    statusButtonInterested: {
      backgroundColor: colors.orange.primary,
      borderColor: colors.orange.secondary,
    },
    statusButtonNotGoing: {
      backgroundColor: colors.red.primary,
      borderColor: colors.red.secondary,
    },
    statusButtonActive: {
      borderWidth: 3,
      shadowColor: colors.text,
      shadowOpacity: 0.28,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 7,
      transform: [{ scale: 1.02 }],
    },
    statusButtonText: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
    },
    statusButtonTextActive: {
      fontWeight: "800",
    },
    statusCancelButton: {
      alignItems: "center",
      paddingTop: 2,
    },
    statusCancelText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    pingToggleButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.tint,
      backgroundColor: colors.cardBackground,
      alignItems: "center",
      paddingVertical: 9,
      paddingHorizontal: 12,
    },
    pingToggleText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.tint,
    },
    pingList: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 10,
      padding: 10,
      gap: 8,
      backgroundColor: colors.pillBackground,
    },
    pingListHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    pingListTitle: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    pingListScroll: {
      maxHeight: 240,
    },
    pingListContent: {
      gap: 8,
    },
    pingListEmpty: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    pingRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 8,
      paddingVertical: 7,
    },
    pingFriendIdentity: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    pingFriendAvatar: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.pillBackground,
      alignItems: "center",
      justifyContent: "center",
    },
    pingFriendAvatarText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.text,
    },
    pingFriendMeta: {
      flex: 1,
      gap: 2,
    },
    pingFriendName: {
      flex: 1,
      fontSize: 13,
      color: colors.text,
    },
    pingFriendStatus: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    pingButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.tint,
      paddingVertical: 5,
      paddingHorizontal: 11,
      backgroundColor: colors.cardBackground,
    },
    pingButtonDisabled: {
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    pingButtonText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.tint,
    },
    pingButtonTextDisabled: {
      color: colors.textSecondary,
    },
    centerContainer: {
      paddingVertical: 40,
      alignItems: "center",
    },
    emptyText: {
      fontSize: 16,
      color: colors.textSecondary,
    },
  });
