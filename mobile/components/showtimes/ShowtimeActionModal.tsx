import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  Linking,
  Modal,
  Pressable,
  Share,
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
import { formatShowtimeTimeRange } from "@/utils/showtime-time";
import { formatSeatLabel } from "@/utils/seat-label";
import { buildShowtimePingUrl } from "@/constants/ping-link";

type FriendPingAvailability = "eligible" | "pinged" | "going" | "interested";
type DetailPanel = "none" | "ping" | "visibility";

type ShowtimeActionModalProps = {
  visible: boolean;
  showtime: ShowtimeInMovieLoggedIn | ShowtimeLoggedIn | null;
  movieTitle?: string | null;
  isUpdatingStatus: boolean;
  onUpdateStatus: (
    going: GoingStatus,
    seat?: { seatRow: string | null; seatNumber: string | null }
  ) => void;
  onClose: () => void;
};

const DETAIL_PANEL_HEIGHT = 360;
const MODAL_OPEN_DURATION_MS = 200;
const DETAIL_PANEL_OPEN_DURATION_MS = 440;
const DETAIL_PANEL_CLOSE_DURATION_MS = 240;

type SeatFieldKind = "unknown" | "digits" | "letter";

type SeatInputConfig = {
  rowKind: SeatFieldKind;
  seatKind: SeatFieldKind;
};

const SEAT_UNKNOWN_PATTERN = /^(?:\d{1,2}|[A-Za-z])$/;
const SEAT_DIGITS_PATTERN = /^\d{1,2}$/;
const SEAT_LETTER_PATTERN = /^[A-Za-z]$/;

const getSeatInputConfig = (seating: string): SeatInputConfig => {
  switch (seating) {
    case "row-number-seat-number":
      return {
        rowKind: "digits",
        seatKind: "digits",
      };
    case "row-letter-seat-number":
      return {
        rowKind: "letter",
        seatKind: "digits",
      };
    case "row-number-seat-letter":
      return {
        rowKind: "digits",
        seatKind: "letter",
      };
    case "row-letter-seat-letter":
      return {
        rowKind: "letter",
        seatKind: "letter",
      };
    default:
      return {
        rowKind: "unknown",
        seatKind: "unknown",
      };
  }
};

const getSeatFieldMaxLength = (kind: SeatFieldKind) => (kind === "letter" ? 1 : 2);

const validateSeatFieldValue = (
  value: string | null,
  kind: SeatFieldKind,
  label: "Row" | "Seat"
) => {
  if (value === null) return null;
  if (kind === "digits" && !SEAT_DIGITS_PATTERN.test(value)) {
    return `${label} must be 1-2 digits.`;
  }
  if (kind === "letter" && !SEAT_LETTER_PATTERN.test(value)) {
    return `${label} must be one letter.`;
  }
  if (kind === "unknown" && !SEAT_UNKNOWN_PATTERN.test(value)) {
    return `${label} must be one letter or 1-2 digits.`;
  }
  return null;
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
  const currentUser = queryClient.getQueryData<{
    id?: string;
    display_name?: string | null;
  }>(["currentUser"]);
  const modalProgress = useRef(new Animated.Value(0)).current;
  const detailPanelProgress = useRef(new Animated.Value(0)).current;

  const [activeDetailPanel, setActiveDetailPanel] = useState<DetailPanel>("none");
  const [renderedDetailPanel, setRenderedDetailPanel] = useState<DetailPanel>("none");
  const activeDetailPanelRef = useRef<DetailPanel>("none");
  const [pingSearchQuery, setPingSearchQuery] = useState("");
  const [visibilitySearchQuery, setVisibilitySearchQuery] = useState("");
  const [seatRowDraft, setSeatRowDraft] = useState("");
  const [seatNumberDraft, setSeatNumberDraft] = useState("");
  const [isSeatDialogVisible, setIsSeatDialogVisible] = useState(false);
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
    if (!visible || selectedShowtimeId === null) {
      modalProgress.setValue(0);
      detailPanelProgress.setValue(0);
      setActiveDetailPanel("none");
      setRenderedDetailPanel("none");
      setPingSearchQuery("");
      setVisibilitySearchQuery("");
      setSeatRowDraft("");
      setSeatNumberDraft("");
      setIsSeatDialogVisible(false);
      setVisibleFriendIdsDraft(new Set());
      return;
    }

    setActiveDetailPanel("none");
    setPingSearchQuery("");
    setVisibilitySearchQuery("");
    setIsSeatDialogVisible(false);
    modalProgress.setValue(0);
    Animated.timing(modalProgress, {
      toValue: 1,
      duration: MODAL_OPEN_DURATION_MS,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [modalProgress, selectedShowtimeId, visible]);

  useEffect(() => {
    if (!visible || !showtime) {
      setSeatRowDraft("");
      setSeatNumberDraft("");
      return;
    }
    setSeatRowDraft(showtime.seat_row ?? "");
    setSeatNumberDraft(showtime.seat_number ?? "");
  }, [showtime, visible]);

  useEffect(() => {
    if (!showtimeVisibility) {
      return;
    }
    setVisibleFriendIdsDraft(new Set(showtimeVisibility.visible_friend_ids));
  }, [showtimeVisibility]);

  useEffect(() => {
    activeDetailPanelRef.current = activeDetailPanel;
  }, [activeDetailPanel]);

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
    // Toggle off: animate closed, then unmount panel content.
    if (activeDetailPanel === panel) {
      setActiveDetailPanel("none");
      detailPanelProgress.stopAnimation();
      Animated.timing(detailPanelProgress, {
        toValue: 0,
        duration: DETAIL_PANEL_CLOSE_DURATION_MS,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start(({ finished }) => {
        // Ignore stale callbacks when the user reopened a panel quickly.
        if (finished && activeDetailPanelRef.current === "none") {
          setRenderedDetailPanel("none");
        }
      });
      return;
    }

    // First open from collapsed state.
    if (activeDetailPanel === "none") {
      setRenderedDetailPanel(panel);
      setActiveDetailPanel(panel);
      detailPanelProgress.stopAnimation();
      detailPanelProgress.setValue(0);
      Animated.timing(detailPanelProgress, {
        toValue: 1,
        duration: DETAIL_PANEL_OPEN_DURATION_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
      return;
    }

    // Switching ping <-> visibility while open: keep the panel fully expanded.
    setRenderedDetailPanel(panel);
    setActiveDetailPanel(panel);
    detailPanelProgress.stopAnimation();
    detailPanelProgress.setValue(1);
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

  const handleSharePingLink = async () => {
    if (!showtime || !currentUser?.id) {
      Alert.alert("Error", "Could not build ping link.");
      return;
    }

    const pingUrl = buildShowtimePingUrl(showtime.id, currentUser.id);
    const movieLabel =
      resolvedMovieTitle ||
      ("movie" in showtime && showtime.movie?.title ? showtime.movie.title : "this showtime");
    const startsAt = DateTime.fromISO(showtime.datetime);
    const dateTimeLabel = startsAt.isValid
      ? startsAt.toFormat("ccc, LLL d 'at' HH:mm")
      : "this showtime";
    const cinemaLabel = showtime.cinema?.name?.trim() || "the cinema";
    try {
      await Share.share({
        message: `Come see ${movieLabel} at ${dateTimeLabel} in ${cinemaLabel}`,
        url: pingUrl,
      });
    } catch (error) {
      console.error("Error sharing showtime ping link:", error);
      Alert.alert("Error", "Could not share ping link.");
    }
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

  const hasVisibilityChanges = useMemo(() => {
    if (!showtimeVisibility) {
      return false;
    }

    const savedVisibleFriendIds = new Set(showtimeVisibility.visible_friend_ids);
    if (savedVisibleFriendIds.size !== visibleFriendIdsDraft.size) {
      return true;
    }

    for (const friendId of visibleFriendIdsDraft) {
      if (!savedVisibleFriendIds.has(friendId)) {
        return true;
      }
    }

    return false;
  }, [showtimeVisibility, visibleFriendIdsDraft]);

  const normalizedSeatRowDraft = seatRowDraft.trim() || null;
  const normalizedSeatNumberDraft = seatNumberDraft.trim() || null;
  const normalizedCurrentSeatRow = showtime?.seat_row?.trim() || null;
  const normalizedCurrentSeatNumber = showtime?.seat_number?.trim() || null;
  const cinemaSeating = showtime?.cinema?.seating?.trim().toLowerCase() ?? "";
  const seatInputConfig = useMemo(() => getSeatInputConfig(cinemaSeating), [cinemaSeating]);
  const seatRowValidationError = useMemo(
    () => validateSeatFieldValue(normalizedSeatRowDraft, seatInputConfig.rowKind, "Row"),
    [normalizedSeatRowDraft, seatInputConfig.rowKind]
  );
  const seatNumberValidationError = useMemo(
    () => validateSeatFieldValue(normalizedSeatNumberDraft, seatInputConfig.seatKind, "Seat"),
    [normalizedSeatNumberDraft, seatInputConfig.seatKind]
  );
  const seatPairValidationError = useMemo(() => {
    if ((normalizedSeatRowDraft === null) !== (normalizedSeatNumberDraft === null)) {
      return "Set both row and seat.";
    }
    return null;
  }, [normalizedSeatNumberDraft, normalizedSeatRowDraft]);
  const seatValidationError =
    seatPairValidationError ?? seatRowValidationError ?? seatNumberValidationError;
  const isFreeSeating = cinemaSeating === "free";
  const seatLabel = formatSeatLabel(normalizedCurrentSeatRow, normalizedCurrentSeatNumber);
  const isSeatConfigured = Boolean(seatLabel);
  const hasSeatChanges =
    normalizedSeatRowDraft !== normalizedCurrentSeatRow ||
    normalizedSeatNumberDraft !== normalizedCurrentSeatNumber;
  const canSaveSeat = hasSeatChanges && !isUpdatingStatus && seatValidationError === null;

  const handleCloseModal = () => {
    if (isSeatDialogVisible) {
      setIsSeatDialogVisible(false);
      return;
    }

    if (!isUpdatingStatus && showtime && hasVisibilityChanges && !isUpdatingShowtimeVisibility) {
      updateShowtimeVisibility({
        showtimeId: showtime.id,
        visibleFriendIds: Array.from(visibleFriendIdsDraft),
      });
    }

    if (!isUpdatingStatus) {
      onClose();
    }
  };

  const handleOpenSeatDialog = () => {
    if (!showtime || isUpdatingStatus || showtime.going !== "GOING" || isFreeSeating) {
      return;
    }
    setSeatRowDraft(showtime.seat_row ?? "");
    setSeatNumberDraft(showtime.seat_number ?? "");
    setIsSeatDialogVisible(true);
  };

  const handleCloseSeatDialog = () => {
    if (isUpdatingStatus) return;
    setIsSeatDialogVisible(false);
  };

  const handleSaveSeat = () => {
    if (!showtime || isUpdatingStatus || showtime.going !== "GOING" || isFreeSeating) {
      return;
    }
    if (seatValidationError) {
      Alert.alert("Invalid seat", seatValidationError);
      return;
    }
    onUpdateStatus("GOING", {
      seatRow: normalizedSeatRowDraft,
      seatNumber: normalizedSeatNumberDraft,
    });
    setIsSeatDialogVisible(false);
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
  const shouldShowSeatButton = isGoingSelected && !isFreeSeating;
  const hasTicketLink = Boolean(showtime?.ticket_link);

  useEffect(() => {
    if (shouldShowSeatButton || !isSeatDialogVisible) {
      return;
    }
    setIsSeatDialogVisible(false);
  }, [isSeatDialogVisible, shouldShowSeatButton]);

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

  const detailPanelAnimatedStyle = {
    height: detailPanelProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [0, DETAIL_PANEL_HEIGHT],
    }),
    opacity: detailPanelProgress,
    transform: [
      {
        translateY: detailPanelProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [8, 0],
        }),
      },
    ],
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="none"
      onRequestClose={handleCloseModal}
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
          onPress={handleCloseModal}
        />

        <Animated.View style={[styles.statusModalCard, statusModalCardAnimatedStyle]}>
          <ThemedText style={styles.statusModalTitle}>Update your status</ThemedText>
          {resolvedMovieTitle ? (
            <ThemedText style={styles.statusModalMovieTitle}>{resolvedMovieTitle}</ThemedText>
          ) : null}
          {showtime ? (
            <ThemedText style={styles.statusModalSubtitle}>
              {DateTime.fromISO(showtime.datetime).toFormat("ccc, LLL d")},{" "}
              {formatShowtimeTimeRange(showtime.datetime, showtime.end_datetime)} •{" "}
              {showtime.cinema.name}
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

          {renderedDetailPanel === "ping" ? (
            <Animated.View style={[styles.detailPanelAnimatedContainer, detailPanelAnimatedStyle]}>
              <View style={styles.detailPanel}>
                <View style={styles.detailPanelHeaderRow}>
                  <ThemedText style={styles.detailPanelTitle}>Ping friends</ThemedText>
                  <TouchableOpacity
                    style={styles.detailHeaderAction}
                    activeOpacity={0.8}
                    onPress={() => void handleSharePingLink()}
                    disabled={!showtime || !currentUser?.id}
                  >
                    <MaterialIcons
                      name="share"
                      size={20}
                      color={!showtime || !currentUser?.id ? colors.textSecondary : colors.tint}
                    />
                  </TouchableOpacity>
                </View>
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
                <View style={styles.detailListContainer}>
                  {filteredFriendsForPing.length === 0 ? (
                    <View style={styles.detailListStateContainer}>
                      <ThemedText style={styles.detailEmptyText}>No friends found.</ThemedText>
                    </View>
                  ) : (
                    <ScrollView style={styles.detailScroll} contentContainerStyle={styles.detailScrollContent} nestedScrollEnabled>
                      {filteredFriendsForPing.map((friend) => {
                        const canPing =
                          friend.availability === "eligible" && !isPingingFriend && !isFetchingPingedFriends;
                        const pingButtonLabel =
                          friend.availability === "eligible"
                            ? "Ping"
                            : friend.availability === "pinged"
                              ? "Pinged"
                              : friend.availability === "going"
                                ? "Going"
                                : "Interested";

                        return (
                          <View key={friend.id} style={styles.pingRow}>
                            <View style={styles.pingFriendIdentity}>
                              <ThemedText style={styles.pingFriendName}>{friend.label}</ThemedText>
                            </View>
                            <TouchableOpacity
                              style={[styles.pingButton, !canPing && styles.pingButtonDisabled]}
                              disabled={!canPing}
                              onPress={() => handlePingFriend(friend.id)}
                              activeOpacity={0.8}
                            >
                              <ThemedText style={[styles.pingButtonText, !canPing && styles.pingButtonTextDisabled]}>
                                {pingButtonLabel}
                              </ThemedText>
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              </View>
            </Animated.View>
          ) : null}

          {renderedDetailPanel === "visibility" ? (
            <Animated.View style={[styles.detailPanelAnimatedContainer, detailPanelAnimatedStyle]}>
              <View style={styles.detailPanel}>
                <View style={styles.visibilityHeaderRow}>
                  <ThemedText style={styles.detailPanelTitle}>Control who can see your status</ThemedText>
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
                <View style={styles.detailListContainer}>
                  {isFetchingShowtimeVisibility && !showtimeVisibility ? (
                    <View style={styles.detailListStateContainer}>
                      <ActivityIndicator size="small" color={colors.tint} />
                    </View>
                  ) : friendsForVisibility.length === 0 ? (
                    <View style={styles.detailListStateContainer}>
                      <ThemedText style={styles.detailEmptyText}>No friends found.</ThemedText>
                    </View>
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
                </View>
              </View>
            </Animated.View>
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

            {shouldShowSeatButton ? (
              <TouchableOpacity
                style={[
                  styles.actionButton,
                  isSeatDialogVisible && styles.actionButtonActive,
                  isSeatConfigured && styles.actionButtonSeatSet,
                ]}
                onPress={handleOpenSeatDialog}
                activeOpacity={0.8}
              >
                <MaterialIcons
                  name="event-seat"
                  size={16}
                  color={
                    isSeatConfigured
                      ? colors.green.secondary
                      : isSeatDialogVisible
                        ? colors.tint
                        : colors.textSecondary
                  }
                />
                <ThemedText
                  style={[
                    styles.actionButtonText,
                    isSeatDialogVisible && styles.actionButtonTextActive,
                    isSeatConfigured && styles.actionButtonTextSeatSet,
                  ]}
                  numberOfLines={1}
                >
                  {seatLabel ? `Seat ${seatLabel}` : "Seat"}
                </ThemedText>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.actionButton, activeDetailPanel === "ping" && styles.actionButtonActive]}
              onPressIn={() => handleToggleDetailPanel("ping")}
              delayPressIn={0}
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
              onPressIn={() => handleToggleDetailPanel("visibility")}
              delayPressIn={0}
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
            onPress={handleCloseModal}
            activeOpacity={0.8}
          >
            <ThemedText style={styles.statusCancelText}>{isUpdatingStatus ? "Updating..." : "Cancel"}</ThemedText>
          </TouchableOpacity>
        </Animated.View>

        <Modal
          transparent
          visible={isSeatDialogVisible && !isFreeSeating}
          animationType="fade"
          onRequestClose={handleCloseSeatDialog}
        >
          <View style={styles.seatDialogBackdrop}>
            <TouchableOpacity
              style={styles.seatDialogBackdropPressable}
              activeOpacity={1}
              onPress={handleCloseSeatDialog}
            />
            <View style={styles.seatDialogCard}>
              <View style={styles.seatDialogHeader}>
                <ThemedText style={styles.seatDialogTitle}>Seat info</ThemedText>
              </View>
              <View style={styles.seatEditorRow}>
                <View style={styles.seatEditorField}>
                  <TextInput
                    value={seatRowDraft}
                    onChangeText={setSeatRowDraft}
                    placeholder={"Row"}
                    placeholderTextColor={colors.textSecondary}
                    style={[styles.seatInput, seatRowValidationError && styles.seatInputInvalid]}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    keyboardType={seatInputConfig.rowKind === "digits" ? "number-pad" : "default"}
                    maxLength={getSeatFieldMaxLength(seatInputConfig.rowKind)}
                  />
                </View>
                <View style={styles.seatEditorField}>
                  <TextInput
                    value={seatNumberDraft}
                    onChangeText={setSeatNumberDraft}
                    placeholder={"Seat"}
                    placeholderTextColor={colors.textSecondary}
                    style={[styles.seatInput, seatNumberValidationError && styles.seatInputInvalid]}
                    autoCapitalize="characters"
                    autoCorrect={false}
                    keyboardType={seatInputConfig.seatKind === "digits" ? "number-pad" : "default"}
                    maxLength={getSeatFieldMaxLength(seatInputConfig.seatKind)}
                  />
                </View>
              </View>
              {seatValidationError ? (
                <ThemedText style={styles.seatValidationErrorText}>{seatValidationError}</ThemedText>
              ) : null}
              <View style={styles.seatDialogActions}>
                <TouchableOpacity
                  style={[
                    styles.seatDialogButton,
                    styles.seatDialogButtonPrimary,
                    !canSaveSeat && styles.seatDialogButtonDisabled,
                  ]}
                  onPress={handleSaveSeat}
                  activeOpacity={0.8}
                  disabled={!canSaveSeat}
                >
                  <ThemedText style={[styles.seatDialogButtonText, styles.seatDialogButtonTextPrimary]}>
                    Save
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
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
    actionButtonSeatSet: {
      borderColor: colors.green.secondary,
      backgroundColor: colors.green.primary,
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
    actionButtonTextSeatSet: {
      color: colors.green.secondary,
    },
    actionButtonTextDisabled: {
      color: colors.textSecondary,
    },
    detailPanelAnimatedContainer: {
      overflow: "hidden",
    },
    detailPanel: {
      height: "100%",
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
    detailPanelHeaderRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    detailHeaderAction: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    detailHeaderActionText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.tint,
    },
    detailHeaderActionTextDisabled: {
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
    detailListContainer: {
      flex: 1,
      minHeight: 0,
    },
    detailListStateContainer: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    detailScroll: {
      flex: 1,
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
      gap: 8,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    pingFriendIdentity: {
      flex: 1,
      justifyContent: "center",
    },
    pingFriendName: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.text,
    },
    pingButton: {
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.tint,
      paddingVertical: 2,
      paddingHorizontal: 8,
      backgroundColor: colors.cardBackground,
    },
    pingButtonDisabled: {
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    pingButtonText: {
      fontSize: 11,
      lineHeight: 14,
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
    seatEditorRow: {
      flexDirection: "row",
      gap: 8,
    },
    seatEditorField: {
      flex: 1,
      gap: 4,
    },
    seatFieldLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      fontWeight: "600",
    },
    seatInput: {
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 9,
      paddingVertical: 8,
      fontSize: 14,
      color: colors.text,
    },
    seatInputInvalid: {
      borderColor: colors.red.secondary,
    },
    seatValidationErrorText: {
      fontSize: 11,
      color: colors.red.secondary,
      marginTop: -2,
    },
    seatDialogButtonDisabled: {
      borderColor: colors.divider,
      backgroundColor: colors.pillBackground,
    },
    seatDialogBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.28)",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
    },
    seatDialogBackdropPressable: {
      ...StyleSheet.absoluteFillObject,
    },
    seatDialogCard: {
      width: "100%",
      maxWidth: 360,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 14,
      paddingTop: 14,
      paddingBottom: 12,
      gap: 10,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 9,
    },
    seatDialogHeader: {
      gap: 2,
    },
    seatDialogTitle: {
      fontSize: 16,
      fontWeight: "700",
      color: colors.text,
    },
    seatDialogSubtitle: {
      fontSize: 12,
      color: colors.textSecondary,
      lineHeight: 17,
    },
    seatDialogCurrentSeat: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.text,
    },
    seatDialogActions: {
      flexDirection: "row",
      gap: 8,
    },
    seatDialogButton: {
      flex: 1,
      minHeight: 38,
      borderRadius: 10,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 12,
    },
    seatDialogButtonPrimary: {
      backgroundColor: colors.tint,
      borderColor: colors.tint,
    },
    seatDialogButtonSecondary: {
      backgroundColor: colors.cardBackground,
      borderColor: colors.divider,
    },
    seatDialogButtonText: {
      fontSize: 13,
      fontWeight: "700",
    },
    seatDialogButtonTextPrimary: {
      color: colors.pillActiveText,
    },
    seatDialogButtonTextSecondary: {
      color: colors.textSecondary,
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
