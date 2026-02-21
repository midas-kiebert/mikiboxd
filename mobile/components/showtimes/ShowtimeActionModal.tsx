import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import {
  ShowtimesService,
  type GoingStatus,
  type ShowtimeInMovieLoggedIn,
  type ShowtimeLoggedIn,
} from "shared";
import { useFetchFriends } from "shared/hooks/useFetchFriends";

import { ThemedText } from "@/components/themed-text";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { useThemeColors } from "@/hooks/use-theme-color";

type FriendPingAvailability = "eligible" | "pinged" | "going" | "interested";
type DetailPanel = "none" | "ping" | "visibility";

type ShowtimeActionModalProps = {
  visible: boolean;
  showtime: ShowtimeInMovieLoggedIn | ShowtimeLoggedIn | null;
  movieTitle?: string | null;
  isUpdatingStatus: boolean;
  onUpdateStatus: (going: GoingStatus) => void;
  onClose: () => void;
};

export default function ShowtimeActionModal({
  visible,
  showtime,
  movieTitle,
  isUpdatingStatus,
  onUpdateStatus,
  onClose,
}: ShowtimeActionModalProps) {
  const colorScheme = useColorScheme();
  const colors = useThemeColors();
  const styles = createStyles(colors);
  const queryClient = useQueryClient();
  const modalProgress = useRef(new Animated.Value(0)).current;

  const [activeDetailPanel, setActiveDetailPanel] = useState<DetailPanel>("none");
  const [pingSearchQuery, setPingSearchQuery] = useState("");
  const [visibilitySearchQuery, setVisibilitySearchQuery] = useState("");
  const [visibleFriendIdsDraft, setVisibleFriendIdsDraft] = useState<Set<string>>(new Set());

  const selectedShowtimeId = showtime?.id ?? null;
  const { data: friends } = useFetchFriends({ enabled: visible && selectedShowtimeId !== null });

  const { data: pingedFriendIds = [], isFetching: isFetchingPingedFriends } = useQuery<
    string[],
    Error
  >({
    queryKey: ["showtimes", "pingedFriends", selectedShowtimeId],
    enabled: visible && selectedShowtimeId !== null,
    queryFn: () =>
      ShowtimesService.getPingedFriendIdsForShowtime({
        showtimeId: selectedShowtimeId as number,
      }),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });

  const { data: showtimeVisibility, isFetching: isFetchingShowtimeVisibility } = useQuery({
    queryKey: ["showtimes", "visibility", selectedShowtimeId],
    enabled: visible && selectedShowtimeId !== null,
    queryFn: () =>
      ShowtimesService.getShowtimeVisibility({
        showtimeId: selectedShowtimeId as number,
      }),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });

  const { mutate: pingFriendForShowtime, isPending: isPingingFriend } = useMutation({
    mutationFn: ({ showtimeId, friendId }: { showtimeId: number; friendId: string }) =>
      ShowtimesService.pingFriendForShowtime({
        showtimeId,
        friendId,
      }),
    onSuccess: (_message, variables) => {
      queryClient.setQueryData<string[]>(
        ["showtimes", "pingedFriends", variables.showtimeId],
        (previous) =>
          previous?.includes(variables.friendId) ? previous : [...(previous ?? []), variables.friendId]
      );
    },
    onError: (error) => {
      console.error("Error pinging friend for showtime:", error);
      const detail =
        typeof error === "object" &&
        error !== null &&
        "body" in error &&
        typeof (error as { body?: { detail?: unknown } }).body?.detail === "string"
          ? (error as { body?: { detail?: string } }).body?.detail
          : undefined;
      Alert.alert("Error", detail ?? "Could not send ping.");
    },
  });

  const { mutate: updateShowtimeVisibility, isPending: isUpdatingShowtimeVisibility } = useMutation({
    mutationFn: ({ showtimeId, visibleFriendIds }: { showtimeId: number; visibleFriendIds: string[] }) =>
      ShowtimesService.updateShowtimeVisibility({
        showtimeId,
        requestBody: { visible_friend_ids: visibleFriendIds },
      }),
    onSuccess: (updatedVisibility, variables) => {
      queryClient.setQueryData(["showtimes", "visibility", variables.showtimeId], updatedVisibility);
      setVisibleFriendIdsDraft(new Set(updatedVisibility.visible_friend_ids));
      queryClient.invalidateQueries({ queryKey: ["showtimes"] });
      queryClient.invalidateQueries({ queryKey: ["movie"] });
      queryClient.invalidateQueries({ queryKey: ["movies"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error) => {
      console.error("Error updating showtime visibility:", error);
      Alert.alert("Error", "Could not update visibility.");
    },
  });

  useEffect(() => {
    if (!visible || !showtime) {
      modalProgress.setValue(0);
      setActiveDetailPanel("none");
      setPingSearchQuery("");
      setVisibilitySearchQuery("");
      setVisibleFriendIdsDraft(new Set());
      return;
    }

    setActiveDetailPanel("none");
    setPingSearchQuery("");
    setVisibilitySearchQuery("");
    modalProgress.setValue(0);
    Animated.timing(modalProgress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [modalProgress, showtime, visible]);

  useEffect(() => {
    if (!showtimeVisibility) {
      return;
    }
    setVisibleFriendIdsDraft(new Set(showtimeVisibility.visible_friend_ids));
  }, [showtimeVisibility]);

  const handleOpenTicketLink = async () => {
    const ticketLink = showtime?.ticket_link;
    if (!ticketLink) {
      return;
    }

    const canOpen = await Linking.canOpenURL(ticketLink);
    if (canOpen) {
      await Linking.openURL(ticketLink);
    }
  };

  const handleToggleDetailPanel = (panel: Exclude<DetailPanel, "none">) => {
    setActiveDetailPanel((previous) => (previous === panel ? "none" : panel));
  };

  const handlePingFriend = (friendId: string) => {
    if (!showtime || isPingingFriend) {
      return;
    }

    pingFriendForShowtime({
      showtimeId: showtime.id,
      friendId,
    });
  };

  const handleToggleVisibleFriend = (friendId: string) => {
    setVisibleFriendIdsDraft((previous) => {
      const next = new Set(previous);
      if (next.has(friendId)) {
        next.delete(friendId);
      } else {
        next.add(friendId);
      }
      return next;
    });
  };

  const handleSelectAllVisibility = () => {
    const allFriendIds = (friends ?? []).map((friend) => friend.id);
    setVisibleFriendIdsDraft(new Set(allFriendIds));
  };

  const handleDeselectAllVisibility = () => {
    setVisibleFriendIdsDraft(new Set());
  };

  const handleSaveVisibility = () => {
    if (!showtime || isUpdatingShowtimeVisibility) {
      return;
    }

    updateShowtimeVisibility({
      showtimeId: showtime.id,
      visibleFriendIds: Array.from(visibleFriendIdsDraft),
    });
  };

  const friendsGoingIds = useMemo(() => {
    if (!showtime) {
      return new Set<string>();
    }
    return new Set<string>(showtime.friends_going.map((friend) => friend.id));
  }, [showtime]);

  const friendsInterestedIds = useMemo(() => {
    if (!showtime) {
      return new Set<string>();
    }
    return new Set<string>(showtime.friends_interested.map((friend) => friend.id));
  }, [showtime]);

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
        const rankDifference = availabilityRank[left.availability] - availabilityRank[right.availability];
        if (rankDifference !== 0) {
          return rankDifference;
        }
        return left.label.localeCompare(right.label);
      });
  }, [friends, friendsGoingIds, friendsInterestedIds, pingedFriendIds]);

  const filteredFriendsForPing = useMemo(() => {
    const normalizedQuery = pingSearchQuery.trim().toLowerCase();
    if (!normalizedQuery) {
      return friendsForPing;
    }
    return friendsForPing.filter((friend) => friend.label.toLowerCase().includes(normalizedQuery));
  }, [friendsForPing, pingSearchQuery]);

  const friendsForVisibility = useMemo(() => {
    const normalizedQuery = visibilitySearchQuery.trim().toLowerCase();
    return (friends ?? [])
      .map((friend) => ({
        id: friend.id,
        label: friend.display_name?.trim() || "Friend",
      }))
      .filter((friend) => (normalizedQuery ? friend.label.toLowerCase().includes(normalizedQuery) : true))
      .sort((left, right) => left.label.localeCompare(right.label));
  }, [friends, visibilitySearchQuery]);

  const totalFriendCount = friends?.length ?? 0;
  const selectedVisibilityCount = (friends ?? []).reduce(
    (count, friend) => count + (visibleFriendIdsDraft.has(friend.id) ? 1 : 0),
    0
  );
  const allVisibilitySelected = totalFriendCount > 0 && selectedVisibilityCount === totalFriendCount;

  const resolvedMovieTitle = useMemo(() => {
    const fromProp = movieTitle?.trim();
    if (fromProp) {
      return fromProp;
    }

    if (!showtime) {
      return "";
    }

    if ("movie" in showtime && showtime.movie?.title) {
      return showtime.movie.title;
    }

    return "";
  }, [movieTitle, showtime]);

  const isGoingSelected = showtime?.going === "GOING";
  const isInterestedSelected = showtime?.going === "INTERESTED";
  const isNotGoingSelected = showtime?.going === "NOT_GOING";
  const hasTicketLink = Boolean(showtime?.ticket_link);

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

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={() => {
        if (!isUpdatingStatus) {
          onClose();
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
            if (!isUpdatingStatus) {
              onClose();
            }
          }}
        />

        <Animated.View style={[styles.statusModalCard, statusModalCardAnimatedStyle]}>
          <ThemedText style={styles.statusModalTitle}>Update your status</ThemedText>
          {resolvedMovieTitle ? (
            <ThemedText style={styles.statusModalMovieTitle}>{resolvedMovieTitle}</ThemedText>
          ) : null}
          {showtime ? (
            <ThemedText style={styles.statusModalSubtitle}>
              {DateTime.fromISO(showtime.datetime).toFormat("ccc, LLL d, HH:mm")} • {showtime.cinema.name}
            </ThemedText>
          ) : null}

          <View style={styles.statusButtons}>
            <TouchableOpacity
              style={[styles.statusButton, styles.statusButtonGoing, isGoingSelected && styles.statusButtonActive]}
              disabled={isUpdatingStatus}
              onPress={() => onUpdateStatus("GOING")}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.statusButtonText, isGoingSelected && styles.statusButtonTextActive]}>
                I&apos;m Going
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.statusButton,
                styles.statusButtonInterested,
                isInterestedSelected && styles.statusButtonActive,
              ]}
              disabled={isUpdatingStatus}
              onPress={() => onUpdateStatus("INTERESTED")}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.statusButtonText, isInterestedSelected && styles.statusButtonTextActive]}>
                I&apos;m Interested
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.statusButton,
                styles.statusButtonNotGoing,
                isNotGoingSelected && styles.statusButtonActive,
              ]}
              disabled={isUpdatingStatus}
              onPress={() => onUpdateStatus("NOT_GOING")}
              activeOpacity={0.8}
            >
              <ThemedText style={[styles.statusButtonText, isNotGoingSelected && styles.statusButtonTextActive]}>
                I&apos;m Not Going
              </ThemedText>
            </TouchableOpacity>
          </View>

          {activeDetailPanel === "ping" ? (
            <View style={styles.detailPanel}>
              <ThemedText style={styles.detailPanelTitle}>Ping friends</ThemedText>
              <View style={styles.detailSearchRow}>
                <MaterialIcons name="search" size={15} color={colors.textSecondary} />
                <TextInput
                  value={pingSearchQuery}
                  onChangeText={setPingSearchQuery}
                  placeholder="Search friends"
                  placeholderTextColor={colors.textSecondary}
                  style={styles.detailSearchInput}
                />
              </View>
              {filteredFriendsForPing.length === 0 ? (
                <ThemedText style={styles.detailEmptyText}>No friends found.</ThemedText>
              ) : (
                <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailScrollContent} nestedScrollEnabled>
                  {filteredFriendsForPing.map((friend) => {
                    const canPing =
                      friend.availability === "eligible" && !isPingingFriend && !isFetchingPingedFriends;
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
                            <ThemedText style={styles.pingFriendAvatarText}>{friend.initial || "F"}</ThemedText>
                          </View>
                          <View style={styles.pingFriendMeta}>
                            <ThemedText style={styles.pingFriendName}>{friend.label}</ThemedText>
                            <ThemedText style={styles.pingFriendStatus}>{statusLabel}</ThemedText>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={[styles.pingButton, !canPing && styles.pingButtonDisabled]}
                          disabled={!canPing}
                          onPress={() => handlePingFriend(friend.id)}
                          activeOpacity={0.8}
                        >
                          <ThemedText style={[styles.pingButtonText, !canPing && styles.pingButtonTextDisabled]}>
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

          {activeDetailPanel === "visibility" ? (
            <View style={styles.detailPanel}>
              <View style={styles.visibilityHeaderRow}>
                <ThemedText style={styles.detailPanelTitle}>Visibility</ThemedText>
                <ThemedText style={styles.visibilitySummary}>
                  {selectedVisibilityCount}/{totalFriendCount} selected
                </ThemedText>
              </View>
              <View style={styles.visibilityActionsRow}>
                <TouchableOpacity
                  style={styles.visibilityActionButton}
                  onPress={handleSelectAllVisibility}
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.visibilityActionText}>Select all</ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.visibilityActionButton}
                  onPress={handleDeselectAllVisibility}
                  activeOpacity={0.8}
                >
                  <ThemedText style={styles.visibilityActionText}>Deselect all</ThemedText>
                </TouchableOpacity>
              </View>
              <View style={styles.detailSearchRow}>
                <MaterialIcons name="search" size={15} color={colors.textSecondary} />
                <TextInput
                  value={visibilitySearchQuery}
                  onChangeText={setVisibilitySearchQuery}
                  placeholder="Search friends"
                  placeholderTextColor={colors.textSecondary}
                  style={styles.detailSearchInput}
                />
              </View>
              {isFetchingShowtimeVisibility && !showtimeVisibility ? (
                <View style={styles.visibilityLoadingRow}>
                  <ActivityIndicator size="small" color={colors.tint} />
                </View>
              ) : friendsForVisibility.length === 0 ? (
                <ThemedText style={styles.detailEmptyText}>No friends found.</ThemedText>
              ) : (
                <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailScrollContent} nestedScrollEnabled>
                  {friendsForVisibility.map((friend) => {
                    const isSelected = visibleFriendIdsDraft.has(friend.id);
                    return (
                      <TouchableOpacity
                        key={friend.id}
                        style={styles.visibilityRow}
                        onPress={() => handleToggleVisibleFriend(friend.id)}
                        activeOpacity={0.8}
                      >
                        <ThemedText style={styles.visibilityFriendName}>{friend.label}</ThemedText>
                        <MaterialIcons
                          name={isSelected ? "check-box" : "check-box-outline-blank"}
                          size={20}
                          color={isSelected ? colors.tint : colors.textSecondary}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              <TouchableOpacity
                style={[
                  styles.visibilitySaveButton,
                  !allVisibilitySelected &&
                    selectedVisibilityCount === 0 &&
                    totalFriendCount > 0 &&
                    styles.visibilitySaveButtonWarning,
                ]}
                disabled={isUpdatingShowtimeVisibility}
                onPress={handleSaveVisibility}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.visibilitySaveButtonText}>
                  {isUpdatingShowtimeVisibility ? "Saving..." : "Save visibility"}
                </ThemedText>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={[styles.actionButton, !hasTicketLink && styles.actionButtonDisabled]}
              disabled={!hasTicketLink}
              onPress={handleOpenTicketLink}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name="confirmation-number"
                size={16}
                color={!hasTicketLink ? colors.textSecondary : colors.tint}
              />
              <ThemedText style={[styles.actionButtonText, !hasTicketLink && styles.actionButtonTextDisabled]}>
                Ticket
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, activeDetailPanel === "ping" && styles.actionButtonActive]}
              onPress={() => handleToggleDetailPanel("ping")}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name="campaign"
                size={16}
                color={activeDetailPanel === "ping" ? colors.tint : colors.textSecondary}
              />
              <ThemedText
                style={[
                  styles.actionButtonText,
                  activeDetailPanel === "ping" && styles.actionButtonTextActive,
                ]}
              >
                Ping
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.actionButton,
                activeDetailPanel === "visibility" && styles.actionButtonActive,
              ]}
              onPress={() => handleToggleDetailPanel("visibility")}
              activeOpacity={0.8}
            >
              <MaterialIcons
                name="visibility"
                size={16}
                color={activeDetailPanel === "visibility" ? colors.tint : colors.textSecondary}
              />
              <ThemedText
                style={[
                  styles.actionButtonText,
                  activeDetailPanel === "visibility" && styles.actionButtonTextActive,
                ]}
              >
                Visibility
              </ThemedText>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={styles.statusCancelButton}
            disabled={isUpdatingStatus}
            onPress={onClose}
            activeOpacity={0.8}
          >
            <ThemedText style={styles.statusCancelText}>{isUpdatingStatus ? "Updating..." : "Cancel"}</ThemedText>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
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
    statusModalMovieTitle: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
    },
    statusModalSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    statusButtons: {
      gap: 8,
      marginTop: 2,
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
    actionRow: {
      flexDirection: "row",
      gap: 8,
      marginTop: 2,
    },
    actionButton: {
      flex: 1,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.pillBackground,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 7,
      gap: 2,
    },
    actionButtonActive: {
      borderColor: colors.tint,
      backgroundColor: colors.cardBackground,
    },
    actionButtonDisabled: {
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    actionButtonText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    actionButtonTextActive: {
      color: colors.tint,
    },
    actionButtonTextDisabled: {
      color: colors.textSecondary,
    },
    detailPanel: {
      borderWidth: 1,
      borderColor: colors.cardBorder,
      borderRadius: 10,
      padding: 10,
      gap: 8,
      backgroundColor: colors.pillBackground,
    },
    detailPanelTitle: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    detailSearchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 9,
      paddingVertical: 6,
    },
    detailSearchInput: {
      flex: 1,
      fontSize: 13,
      color: colors.text,
      paddingVertical: 0,
    },
    detailScroll: {
      maxHeight: 220,
    },
    detailScrollContent: {
      gap: 8,
    },
    detailEmptyText: {
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
    visibilityHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    visibilitySummary: {
      fontSize: 11,
      color: colors.textSecondary,
    },
    visibilityActionsRow: {
      flexDirection: "row",
      gap: 8,
    },
    visibilityActionButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingVertical: 6,
      paddingHorizontal: 10,
      backgroundColor: colors.cardBackground,
    },
    visibilityActionText: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    visibilityLoadingRow: {
      alignItems: "center",
      paddingVertical: 10,
    },
    visibilityRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    visibilityFriendName: {
      flex: 1,
      fontSize: 13,
      color: colors.text,
    },
    visibilitySaveButton: {
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.tint,
      backgroundColor: colors.cardBackground,
      alignItems: "center",
      paddingVertical: 8,
      paddingHorizontal: 12,
      marginTop: 2,
    },
    visibilitySaveButtonWarning: {
      borderColor: colors.red.secondary,
    },
    visibilitySaveButtonText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.tint,
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
  });
