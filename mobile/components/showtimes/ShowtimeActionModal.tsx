/**
 * Showtime status bottom sheet ("Update your status").
 *
 * Rises from the bottom (gorhom BottomSheetModal, mirroring FiltersModal) and is
 * self-contained: poster + title + full date + time·runtime + cinema badge, a box
 * of who is going/interested, an optional "X invited you" banner, the status
 * buttons (Not going / Interested / Going), the Get Ticket + Seat actions, a list
 * of who you've invited, and the invite-friends panel. A subtle colored tint bleeds
 * from the top to reflect the current status (green going / orange interested /
 * blue when you have an open invite).
 *
 * It is mounted once by ShowtimeModalProvider and driven by the controlled
 * `visible` prop; screens open it through the useShowtimeModal() hook.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Image,
  Keyboard,
  LayoutAnimation,
  Linking,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  UIManager,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { LinearGradient } from "expo-linear-gradient";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ShowtimesService,
  type GoingStatus,
  type MeGetCurrentUserResponse,
  type SentShowtimePingPublic,
  type ShowtimeLoggedIn,
  type UserPublic,
  type VisibilityMode,
} from "shared";
import { useFetchFriends } from "shared/hooks/useFetchFriends";

import CinemaPill from "@/components/badges/CinemaPill";
import VisibilityModePicker from "@/components/showtimes/VisibilityModePicker";
import { getVisibilityModeMeta } from "@/components/showtimes/visibility-mode";
import SubtitlesBadges from "@/components/badges/SubtitlesBadges";
import FriendBadges from "@/components/badges/FriendBadges";
import FriendInviteRow, { type FriendWatchStatus } from "@/components/friends/FriendInviteRow";
import { ThemedText } from "@/components/themed-text";
import { useThemeColors } from "@/hooks/use-theme-color";
import { formatShowtimeTimeRange } from "@/utils/showtime-time";
import { formatSeatLabel } from "@/utils/seat-label";
import { buildShowtimePingUrl } from "@/constants/ping-link";
import { triggerImpactHaptic, triggerSelectionHaptic } from "@/utils/long-press";
import { formatLanguageCode } from "@/utils/language";
import * as Clipboard from "expo-clipboard";
import { buildCinevilleCardNumber, loadCinevilleCardDigits } from "@/utils/cineville-card";

// LayoutAnimation needs an explicit opt-in on Android (on by default on iOS).
if (Platform.OS === "android" && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Smooth height tween for the invite-friends expand/collapse "swipe open".
const EXPAND_LAYOUT_ANIMATION = {
  duration: 220,
  create: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
  update: { type: LayoutAnimation.Types.easeInEaseOut },
  delete: { type: LayoutAnimation.Types.easeInEaseOut, property: LayoutAnimation.Properties.opacity },
};

export type ShowtimeInvite = {
  senders: UserPublic[];
  pingIds: number[];
};

type FriendPingAvailability = "eligible" | "pinged" | "going" | "interested";

type ShowtimeActionModalProps = {
  visible: boolean;
  showtime: ShowtimeLoggedIn | null;
  /** True while a showtime opened by id is still being fetched. */
  isLoadingShowtime?: boolean;
  /** Present when the sheet was opened from an invite (ping). */
  invite?: ShowtimeInvite | null;
  isUpdatingStatus: boolean;
  isDismissingInvite?: boolean;
  onUpdateStatus: (
    going: GoingStatus,
    seat?: { seatRow: string | null; seatNumber: string | null }
  ) => void;
  onDismissInvite?: () => void;
  onClose: () => void;
  /** Hides the poster tap and "All showtimes" button when already on the movie page. */
  disableMovieNavigation?: boolean;
  /** Disables the cinema pill navigation when already on that cinema's page. */
  disabledCinemaId?: number;
  /** Disables friend badge navigation for this user when already on their page. */
  disabledUserId?: string;
};

// ─── Seat input helpers ───────────────────────────────────────────────────────

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
      return { rowKind: "digits", seatKind: "digits" };
    case "row-letter-seat-number":
      return { rowKind: "letter", seatKind: "digits" };
    case "row-number-seat-letter":
      return { rowKind: "digits", seatKind: "letter" };
    case "row-letter-seat-letter":
      return { rowKind: "letter", seatKind: "letter" };
    default:
      return { rowKind: "unknown", seatKind: "unknown" };
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

const getUniqueSenderNames = (senders: UserPublic[]): string[] =>
  senders
    .map((sender) => sender.display_name?.trim() || "A friend")
    .filter((value, index, all) => all.indexOf(value) === index);

const formatInvitedYou = (senders: UserPublic[]): string => {
  const names = getUniqueSenderNames(senders);
  if (names.length <= 1) {
    return `${names[0] ?? "A friend"} has invited you to this showtime.`;
  }
  if (names.length === 2) {
    return `${names[0]} and ${names[1]} have invited you to this showtime.`;
  }
  return `${names[0]} and ${names.length - 1} others have invited you to this showtime.`;
};

export default function ShowtimeActionModal({
  visible,
  showtime,
  isLoadingShowtime = false,
  invite,
  isUpdatingStatus,
  isDismissingInvite = false,
  onUpdateStatus,
  onDismissInvite,
  onClose,
  disableMovieNavigation = false,
  disabledCinemaId,
  disabledUserId,
}: ShowtimeActionModalProps) {
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  // Generous trailing space so the invite section can always be scrolled to the
  // top, even after typing shrinks the friend list (so the view doesn't jump).
  const inviteScrollPadding = Math.round(windowHeight * 0.6);
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const currentUser = queryClient.getQueryData<MeGetCurrentUserResponse>(["currentUser"]);

  const bottomSheetModalRef = useRef<BottomSheetModal>(null);
  const scrollViewRef = useRef<any>(null);
  const searchInputRef = useRef<any>(null);
  // Y-offset of the "Invited" section header; used so that section is visible
  // at the top of the sheet when the invite panel opens / search focuses.
  const invitedSectionYRef = useRef(0);
  // 80% by default; a full-height detent so scrolling up first lifts the sheet
  // to the top of the screen before the content itself scrolls.
  const snapPoints = useMemo(() => ["80%", "100%"], []);

  // Drive the gorhom sheet imperatively from the controlled `visible` prop
  // (same approach as FiltersModal): present() on open, close() on programmatic
  // close, and never close() when gorhom already closed the sheet.
  const hasEverPresentedRef = useRef(false);
  const closedByGorhomRef = useRef(false);

  const [showInviteFriends, setShowInviteFriends] = useState(false);
  const [inviteListReady, setInviteListReady] = useState(false);
  const [pingSearchQuery, setPingSearchQuery] = useState("");
  const [seatRowDraft, setSeatRowDraft] = useState("");
  const [seatNumberDraft, setSeatNumberDraft] = useState("");
  const [isSeatDialogVisible, setIsSeatDialogVisible] = useState(false);
  const [isVisibilityPickerOpen, setIsVisibilityPickerOpen] = useState(false);
  // Which "watchlisted/watched by friends" popup is open, if any.
  const [watchModalKind, setWatchModalKind] = useState<"watchlisted" | "watched" | null>(null);

  // Caret rotation for the invite-friends toggle (native thread, like FiltersModal).
  const caretRotation = useRef(new Animated.Value(0)).current;
  const caretSpin = useMemo(
    () => caretRotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }),
    [caretRotation]
  );

  const selectedShowtimeId = showtime?.id ?? null;
  const sheetDataEnabled = visible && selectedShowtimeId !== null;

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) {
        closedByGorhomRef.current = true;
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (visible) {
      hasEverPresentedRef.current = true;
      closedByGorhomRef.current = false;
      bottomSheetModalRef.current?.present();
    } else if (hasEverPresentedRef.current && !closedByGorhomRef.current) {
      bottomSheetModalRef.current?.close();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // Reset transient UI when the sheet closes or switches showtime.
  useEffect(() => {
    if (!visible) {
      setShowInviteFriends(false);
      setInviteListReady(false);
      setPingSearchQuery("");
      setIsSeatDialogVisible(false);
      setWatchModalKind(null);
      caretRotation.setValue(0);
    }
  }, [visible, caretRotation]);


  useEffect(() => {
    setSeatRowDraft(showtime?.seat_row ?? "");
    setSeatNumberDraft(showtime?.seat_number ?? "");
  }, [showtime?.id, showtime?.seat_row, showtime?.seat_number]);

  // ─── Friends + invite data ─────────────────────────────────────────────────
  // Friends + already-pinged ids load whenever the sheet is open so the "Invited"
  // summary and the invite list can render.
  const { data: friends, isLoading: isLoadingFriends } = useFetchFriends({
    enabled: sheetDataEnabled,
  });

  const sentPingsQueryKey = useMemo(
    () => ["showtimes", "sentPings", selectedShowtimeId] as const,
    [selectedShowtimeId]
  );
  const { data: sentPings = [] } = useQuery<SentShowtimePingPublic[], Error>({
    queryKey: sentPingsQueryKey,
    enabled: sheetDataEnabled,
    queryFn: () =>
      ShowtimesService.getSentPingsForShowtime({ showtimeId: selectedShowtimeId as number }),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });

  const { mutate: pingFriendForShowtime, isPending: isPingingFriend } = useMutation({
    mutationFn: ({ showtimeId, friendId }: { showtimeId: number; friendId: string }) =>
      ShowtimesService.pingFriendForShowtime({ showtimeId, friendId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sentPingsQueryKey });
    },
    onError: (error) => {
      const detail =
        typeof error === "object" &&
        error !== null &&
        "body" in error &&
        typeof (error as { body?: { detail?: unknown } }).body?.detail === "string"
          ? (error as { body?: { detail?: string } }).body?.detail
          : undefined;
      Alert.alert("Error", detail ?? "Could not send invite.");
    },
  });

  const { mutate: uninviteFriend, isPending: isUninviting } = useMutation({
    mutationFn: ({ showtimeId, friendId }: { showtimeId: number; friendId: string }) =>
      ShowtimesService.uninviteFriendFromShowtime({ showtimeId, friendId }),
    onSuccess: (_msg, variables) => {
      queryClient.setQueryData<SentShowtimePingPublic[]>(sentPingsQueryKey, (prev) =>
        prev?.filter((p) => p.receiver_id !== variables.friendId) ?? []
      );
    },
    onError: () => {
      Alert.alert("Error", "Could not cancel invite.");
    },
  });

  // ─── Visibility mode ───────────────────────────────────────────────────────
  const hasStatus = showtime?.going === "GOING" || showtime?.going === "INTERESTED";
  const visibilityQueryKey = useMemo(
    () => ["showtimes", "visibility", selectedShowtimeId] as const,
    [selectedShowtimeId]
  );
  const { data: visibility } = useQuery({
    queryKey: visibilityQueryKey,
    enabled: sheetDataEnabled && hasStatus,
    queryFn: () =>
      ShowtimesService.getShowtimeVisibility({ showtimeId: selectedShowtimeId as number }),
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });

  const { mutate: updateVisibilityMode } = useMutation({
    mutationFn: ({ showtimeId, mode }: { showtimeId: number; mode: VisibilityMode }) =>
      ShowtimesService.updateShowtimeVisibility({ showtimeId, requestBody: { mode } }),
    onSuccess: (updated) => {
      queryClient.setQueryData(visibilityQueryKey, updated);
      queryClient.invalidateQueries({ queryKey: ["showtimes"] });
      queryClient.invalidateQueries({ queryKey: ["movie"] });
      queryClient.invalidateQueries({ queryKey: ["movies"] });
    },
    onError: () => {
      Alert.alert("Error", "Could not update who can see your status.");
    },
  });

  const handleVisibilityModeSelect = useCallback(
    (mode: VisibilityMode) => {
      setIsVisibilityPickerOpen(false);
      if (!showtime || mode === visibility?.mode) return;
      triggerSelectionHaptic();
      // Optimistically reflect the new mode in the chip before the request lands.
      queryClient.setQueryData(visibilityQueryKey, (prev: typeof visibility) =>
        prev ? { ...prev, mode } : prev
      );
      updateVisibilityMode({ showtimeId: showtime.id, mode });
    },
    [showtime, visibility?.mode, queryClient, visibilityQueryKey, updateVisibilityMode]
  );

  const visibilityMeta = visibility ? getVisibilityModeMeta(visibility.mode, colors) : null;

  // ─── Seat handling ─────────────────────────────────────────────────────────
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

  const hasInvite = Boolean(invite && invite.senders.length > 0);
  const notGoingActsAsDismiss = Boolean(invite && onDismissInvite);
  const isGoingSelected = showtime?.going === "GOING";
  const isInterestedSelected = showtime?.going === "INTERESTED";
  // When invited, the Not-going button is a dismiss affordance, not a status —
  // so don't render it as "selected" even if the stored status is NOT_GOING.
  const isNotGoingSelected = showtime?.going === "NOT_GOING" && !hasInvite;
  const shouldShowSeatButton = isGoingSelected && !isFreeSeating;
  const hasTicketLink = Boolean(showtime?.ticket_link);

  // Top tint: green going / orange interested / blue while an invite is open.
  const tintPalette = isGoingSelected
    ? colors.green
    : isInterestedSelected
      ? colors.orange
      : hasInvite
        ? colors.blue
        : null;
  const colorScheme = useColorScheme();
  const tintOpacity = colorScheme === "dark" ? 0.45 : 0.8;

  useEffect(() => {
    if (shouldShowSeatButton || !isSeatDialogVisible) return;
    setIsSeatDialogVisible(false);
  }, [isSeatDialogVisible, shouldShowSeatButton]);

  const handleStatusPress = (going: GoingStatus) => {
    if (!showtime || isUpdatingStatus) return;
    triggerSelectionHaptic();
    onUpdateStatus(going);
  };

  const handleNotGoingPress = () => {
    if (notGoingActsAsDismiss) {
      triggerSelectionHaptic();
      onDismissInvite?.();
      return;
    }
    handleStatusPress("NOT_GOING");
  };

  const handleOpenTicketLink = async () => {
    const ticketLink = showtime?.ticket_link;
    if (!ticketLink) return;
    if (showtime?.cinema?.cineville) {
      const digits = await loadCinevilleCardDigits();
      if (digits) {
        await Clipboard.setStringAsync(buildCinevilleCardNumber(digits));
      }
    }
    if (await Linking.canOpenURL(ticketLink)) {
      await Linking.openURL(ticketLink);
    }
  };

  const handleGoToMoviePage = () => {
    if (!showtime) return;
    bottomSheetModalRef.current?.close();
    router.push(`/movie/${showtime.movie.id}`);
  };


  const handleOpenSeatDialog = () => {
    if (!showtime || isUpdatingStatus || showtime.going !== "GOING" || isFreeSeating) return;
    setSeatRowDraft(showtime.seat_row ?? "");
    setSeatNumberDraft(showtime.seat_number ?? "");
    setIsSeatDialogVisible(true);
  };

  const handleSaveSeat = () => {
    if (!showtime || isUpdatingStatus || showtime.going !== "GOING" || isFreeSeating) return;
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

  const handlePingFriend = (friendId: string) => {
    if (!showtime || isPingingFriend) return;
    triggerImpactHaptic();
    pingFriendForShowtime({ showtimeId: showtime.id, friendId });
    // Use the native clear() instead of resetting the controlled value — this
    // avoids React's reconciliation pass forcing value="" onto the input, which
    // would swallow any keystroke the user typed before that render landed.
    setPingSearchQuery("");
    searchInputRef.current?.clear();
  };

  const toggleInviteFriends = useCallback(() => {
    const next = !showInviteFriends;
    // Rotate the caret on the native thread so it starts instantly.
    Animated.timing(caretRotation, {
      toValue: next ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
    if (next) {
      // Opening: no LayoutAnimation — content appears instantly so the scroll-to
      // position isn't a moving target. The caret rotation provides all the visual
      // feedback needed. Defer the list render one tick so the caret animation
      // starts painting before the (potentially heavy) list mounts.
      setInviteListReady(false);
      setTimeout(() => {
        setInviteListReady(true);
      }, 0);
    } else {
      // Closing: animate the height collapse so it doesn't just blink out.
      LayoutAnimation.configureNext(EXPAND_LAYOUT_ANIMATION);
    }
    setShowInviteFriends(next);
  }, [showInviteFriends, caretRotation]);

  const handleSharePingLink = async () => {
    if (!showtime || !currentUser?.id) {
      Alert.alert("Error", "Could not build invite link.");
      return;
    }
    const pingUrl = buildShowtimePingUrl(showtime.id, currentUser.id);
    const startsAt = DateTime.fromISO(showtime.datetime);
    const dateTimeLabel = startsAt.isValid
      ? startsAt.toFormat("ccc, LLL d 'at' HH:mm")
      : "this showtime";
    const cinemaLabel = showtime.cinema?.name?.trim() || "the cinema";
    try {
      await Share.share({
        message: `Come see ${showtime.movie.title} at ${dateTimeLabel} in ${cinemaLabel}\n${pingUrl}`,
        url: pingUrl,
      });
    } catch {
      Alert.alert("Error", "Could not share invite link.");
    }
  };

  // ─── Derivations ────────────────────────────────────────────────────────────
  const friendsGoingIds = useMemo(
    () => new Set((showtime?.friends_going ?? []).map((friend) => friend.id)),
    [showtime?.friends_going]
  );
  const friendsInterestedIds = useMemo(
    () => new Set((showtime?.friends_interested ?? []).map((friend) => friend.id)),
    [showtime?.friends_interested]
  );

  const pingedReceiverIds = useMemo(
    () => new Set(sentPings.map((p) => p.receiver_id)),
    [sentPings]
  );

  const friendsWatchlisted = useMemo(
    () => showtime?.friends_watchlisted ?? [],
    [showtime?.friends_watchlisted]
  );
  const friendsWatched = useMemo(
    () => showtime?.friends_watched ?? [],
    [showtime?.friends_watched]
  );
  const watchlistedIds = useMemo(
    () => new Set(friendsWatchlisted.map((friend) => friend.id)),
    [friendsWatchlisted]
  );
  const watchedIds = useMemo(
    () => new Set(friendsWatched.map((friend) => friend.id)),
    [friendsWatched]
  );
  // Watched takes precedence over watchlisted for the single per-friend icon.
  const getWatchStatus = useCallback(
    (friendId: string): FriendWatchStatus =>
      watchedIds.has(friendId) ? "watched" : watchlistedIds.has(friendId) ? "watchlisted" : null,
    [watchedIds, watchlistedIds]
  );

  const friendsForPing = useMemo(() => {
    const availabilityRank: Record<FriendPingAvailability, number> = {
      eligible: 0,
      pinged: 1,
      interested: 2,
      going: 3,
    };
    return (friends ?? [])
      .map((friend) => {
        const availability: FriendPingAvailability = friendsGoingIds.has(friend.id)
          ? "going"
          : friendsInterestedIds.has(friend.id)
            ? "interested"
            : pingedReceiverIds.has(friend.id)
              ? "pinged"
              : "eligible";
        return {
          id: friend.id,
          label: friend.display_name?.trim() || "Friend",
          availability,
          watchStatus: getWatchStatus(friend.id),
          isWatchlisted: watchlistedIds.has(friend.id),
        };
      })
      .sort((left, right) => {
        // Friends who have the film watchlisted float to the top.
        if (left.isWatchlisted !== right.isWatchlisted) {
          return left.isWatchlisted ? -1 : 1;
        }
        const rankDiff = availabilityRank[left.availability] - availabilityRank[right.availability];
        return rankDiff !== 0 ? rankDiff : left.label.localeCompare(right.label);
      });
  }, [
    friends,
    friendsGoingIds,
    friendsInterestedIds,
    pingedReceiverIds,
    getWatchStatus,
    watchlistedIds,
  ]);

  // The list shows friends you can still invite + those who already set a
  // going/interested status (muted); already-pinged friends live in the summary.
  const filteredFriendsForPing = useMemo(() => {
    const invitable = friendsForPing.filter((friend) => friend.availability !== "pinged");
    const query = pingSearchQuery.trim().toLowerCase();
    if (!query) return invitable;
    return invitable.filter((friend) => friend.label.toLowerCase().includes(query));
  }, [friendsForPing, pingSearchQuery]);

  // The top eligible result is what Enter selects (and what we visually highlight).
  const firstEligibleFriendId = useMemo(
    () => filteredFriendsForPing.find((friend) => friend.availability === "eligible")?.id ?? null,
    [filteredFriendsForPing]
  );

  const handleSubmitInviteSearch = () => {
    // Empty query → just dismiss the keyboard, don't invite anyone.
    if (!pingSearchQuery.trim()) {
      searchInputRef.current?.blur();
      return;
    }
    if (!firstEligibleFriendId) return;
    handlePingFriend(firstEligibleFriendId);
  };

  const handleInviteSearchFocus = () => {
    // Scroll after the keyboard has fully opened — any earlier and the sheet
    // extension resets the scroll position.
    const sub = Keyboard.addListener("keyboardDidShow", () => {
      sub.remove();
      scrollViewRef.current?.scrollTo({
        y: Math.max(invitedSectionYRef.current - 8, 0),
        animated: true,
      });
    });
  };

  const originalTitle =
    showtime?.movie.original_title &&
    showtime.movie.original_title.trim() !== showtime.movie.title.trim()
      ? showtime.movie.original_title.trim()
      : null;
  const spokenLanguage = formatLanguageCode(showtime?.movie.original_language);

  const invitedYouLabel = hasInvite ? formatInvitedYou(invite!.senders) : null;
  const showtimeStartsAt = showtime ? DateTime.fromISO(showtime.datetime) : null;
  const dateLabel = showtimeStartsAt?.isValid ? showtimeStartsAt.toFormat("cccc d LLLL") : null;
  const durationMinutes = showtime?.movie.duration ?? null;
  const timeRangeLabel = showtime
    ? formatShowtimeTimeRange(showtime.datetime, showtime.end_datetime)
    : null;
  const timeLabel = timeRangeLabel
    ? [timeRangeLabel, durationMinutes ? `${durationMinutes} min` : null, spokenLanguage]
        .filter(Boolean)
        .join(" • ")
    : null;

  const hasAudience =
    (showtime?.friends_going.length ?? 0) > 0 ||
    (showtime?.friends_interested.length ?? 0) > 0;

  const statusOptions = [
    {
      key: "NOT_GOING" as const,
      label: "Not going",
      icon: "cancel" as const,
      palette: colors.gray,
      selected: isNotGoingSelected,
      disabled: notGoingActsAsDismiss ? isDismissingInvite : isUpdatingStatus,
      onPress: handleNotGoingPress,
    },
    {
      key: "INTERESTED" as const,
      label: "Interested",
      icon: "bookmark-border" as const,
      palette: colors.orange,
      selected: isInterestedSelected,
      disabled: isUpdatingStatus,
      onPress: () => handleStatusPress("INTERESTED"),
    },
    {
      key: "GOING" as const,
      label: "Going",
      icon: "check-circle" as const,
      palette: colors.green,
      selected: isGoingSelected,
      disabled: isUpdatingStatus,
      onPress: () => handleStatusPress("GOING"),
    },
  ];

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={-1}
        appearsOnIndex={0}
        opacity={0.45}
        pressBehavior="close"
      />
    ),
    []
  );

  return (
    <BottomSheetModal
      ref={bottomSheetModalRef}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableDismissOnClose={false}
      enableDynamicSizing={false}
      animationConfigs={{ duration: 220 }}
      backdropComponent={renderBackdrop}
      handleComponent={null}
      backgroundStyle={styles.sheetBackground}
      topInset={topInset}
      keyboardBehavior="extend"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      onChange={handleSheetChange}
    >
      <BottomSheetScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 32 + bottomInset }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Status tint, pinned to the top of the content so it scrolls away. */}
        {tintPalette ? (
          <LinearGradient
            pointerEvents="none"
            colors={[tintPalette.primary, tintPalette.primary, colors.background + "00"]}
            locations={[0, 0.25, 1]}
            style={[styles.topTint, { opacity: tintOpacity }]}
          />
        ) : null}

        {/* Grab handle lives in the content so the tint runs through it with no
            seam; it scrolls away with the rest of the header. */}
        <View style={styles.handleContainer}>
          <View
            style={[
              styles.handleBar,
              tintPalette && { backgroundColor: tintPalette.secondary, opacity: 0.45 },
            ]}
          />
        </View>
        {!showtime ? (
          <View style={styles.loadingState}>
            {isLoadingShowtime ? (
              <ActivityIndicator size="large" color={colors.tint} />
            ) : (
              <ThemedText style={styles.loadingErrorText}>Showtime unavailable.</ThemedText>
            )}
          </View>
        ) : (
          <>
            {/* Header: poster + title + date + time·runtime + cinema badge */}
            <View style={styles.summaryRow}>
              {disableMovieNavigation ? (
                <Image
                  source={{ uri: showtime.movie.poster_link ?? undefined }}
                  style={styles.poster}
                />
              ) : (
                <TouchableOpacity onPress={handleGoToMoviePage} activeOpacity={0.85}>
                  <Image
                    source={{ uri: showtime.movie.poster_link ?? undefined }}
                    style={styles.poster}
                  />
                </TouchableOpacity>
              )}
              <View style={styles.summaryInfo}>
                <ThemedText style={styles.movieTitle} numberOfLines={3}>
                  {showtime.movie.title}
                </ThemedText>
                {originalTitle ? (
                  <ThemedText style={styles.originalTitle} numberOfLines={2}>
                    {originalTitle}
                  </ThemedText>
                ) : null}
                {showtime.movie.directors && showtime.movie.directors.length > 0 ? (
                  <ThemedText style={styles.directorText} numberOfLines={1}>
                    <ThemedText style={styles.directorLabel}>DIRECTED BY </ThemedText>
                    {showtime.movie.directors.join(", ")}
                    {showtime.movie.release_year ? ` (${showtime.movie.release_year})` : null}
                  </ThemedText>
                ) : null}
                {dateLabel ? (
                  <ThemedText style={styles.dateText}>{dateLabel}</ThemedText>
                ) : null}
                {timeLabel ? (
                  <ThemedText style={styles.timeText}>{timeLabel}</ThemedText>
                ) : null}
                <View style={styles.cinemaBadgeRow}>
                  <CinemaPill cinema={showtime.cinema} disabledIfSameId={disabledCinemaId} />
                  <SubtitlesBadges subtitles={showtime.subtitles} />
                </View>
              </View>
              <TouchableOpacity
                style={styles.closeButton}
                onPress={() => bottomSheetModalRef.current?.close()}
                hitSlop={8}
                activeOpacity={0.7}
              >
                <MaterialIcons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Friends going / interested */}
            <View style={[styles.audienceBox, !hasAudience && styles.audienceBoxEmpty]}>
              {hasAudience ? (
                <FriendBadges
                  friendsGoing={showtime.friends_going}
                  friendsInterested={showtime.friends_interested}
                  variant="default"
                  maxVisible={30}
                  disabledUserId={disabledUserId}
                  onNavigate={() => bottomSheetModalRef.current?.close()}
                />
              ) : (
                <ThemedText style={styles.audienceEmptyText}>
                  No friends are interested in this showtime yet.
                </ThemedText>
              )}
            </View>

            {/* Friends' Letterboxd relationship to this film */}
            <View style={styles.watchButtonsRow}>
              {(
                [
                  {
                    kind: "watchlisted" as const,
                    icon: "schedule" as const,
                    accent: colors.orange.secondary,
                    count: friendsWatchlisted.length,
                    label:
                      friendsWatchlisted.length > 0
                        ? `Watchlisted by ${friendsWatchlisted.length}`
                        : "No friends watchlisted",
                  },
                  {
                    kind: "watched" as const,
                    icon: "visibility" as const,
                    accent: colors.green.secondary,
                    count: friendsWatched.length,
                    label:
                      friendsWatched.length > 0
                        ? `Watched by ${friendsWatched.length}`
                        : "No friends watched",
                  },
                ]
              ).map((item) => (
                <TouchableOpacity
                  key={item.kind}
                  style={[styles.watchButton, item.count === 0 && styles.watchButtonEmpty]}
                  onPress={() => {
                    triggerSelectionHaptic();
                    setWatchModalKind(item.kind);
                  }}
                  disabled={item.count === 0}
                  activeOpacity={0.8}
                >
                  <MaterialIcons
                    name={item.icon}
                    size={16}
                    color={item.count > 0 ? item.accent : colors.textSecondary}
                  />
                  <ThemedText style={styles.watchButtonText} numberOfLines={1}>
                    {item.label}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>

            {/* Optional "X invited you" banner */}
            {invitedYouLabel ? (
              <View style={styles.invitedYouBanner}>
                <MaterialIcons name="mail-outline" size={16} color={colors.blue.secondary} />
                <ThemedText style={styles.invitedYouText}>{invitedYouLabel}</ThemedText>
              </View>
            ) : null}

            {/* Status buttons: Not going | Interested | Going */}
            <View style={styles.statusRow}>
              {statusOptions.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  style={[
                    styles.statusButton,
                    option.selected && {
                      backgroundColor: option.palette.primary,
                      borderColor: option.palette.secondary,
                      shadowColor: option.palette.secondary,
                    },
                    option.selected && styles.statusButtonSelected,
                  ]}
                  disabled={option.disabled}
                  onPress={option.onPress}
                  activeOpacity={0.8}
                >
                  <MaterialIcons
                    name={option.icon}
                    size={22}
                    color={option.selected ? option.palette.secondary : colors.textSecondary}
                  />
                  <ThemedText
                    style={[
                      styles.statusButtonText,
                      option.selected && { color: option.palette.secondary },
                    ]}
                  >
                    {option.label}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>

            {/* Who can see your status for this showtime */}
            {hasStatus && visibility ? (
              <TouchableOpacity
                style={[styles.visibilityChip, { borderColor: visibilityMeta!.color }]}
                onPress={() => setIsVisibilityPickerOpen(true)}
                activeOpacity={0.8}
              >
                <MaterialIcons name="visibility" size={16} color={colors.textSecondary} />
                <ThemedText style={styles.visibilityChipLabel}>Visible to</ThemedText>
                <View style={[styles.visibilityChipValue, { backgroundColor: visibilityMeta!.color }]}>
                  <MaterialIcons name={visibilityMeta!.icon} size={13} color={colors.pillActiveText} />
                  <ThemedText style={styles.visibilityChipValueText}>{visibilityMeta!.label}</ThemedText>
                </View>
                <MaterialIcons name="expand-more" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}

            {/* Actions: Share + Get Ticket (+ Seat) */}
            <View style={styles.ctaRow}>
              <TouchableOpacity
                style={styles.ctaIconButton}
                onPress={() => void handleSharePingLink()}
                disabled={!currentUser?.id}
                activeOpacity={0.85}
              >
                <MaterialIcons name="share" size={20} color={colors.textSecondary} />
                <ThemedText style={styles.ctaIconButtonText}>Share</ThemedText>
              </TouchableOpacity>
              {!disableMovieNavigation ? (
                <TouchableOpacity
                  style={[styles.ctaIconButton, !hasTicketLink && styles.ticketButton]}
                  onPress={handleGoToMoviePage}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="format-list-bulleted" size={20} color={colors.textSecondary} />
                  <ThemedText style={styles.ctaIconButtonText}>All showtimes</ThemedText>
                </TouchableOpacity>
              ) : null}
              {hasTicketLink ? (
                <TouchableOpacity
                  style={[styles.ctaIconButton, styles.ticketButton]}
                  onPress={handleOpenTicketLink}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="local-activity" size={20} color={colors.textSecondary} />
                  <ThemedText style={styles.ctaIconButtonText}>Get ticket</ThemedText>
                </TouchableOpacity>
              ) : null}
              {shouldShowSeatButton ? (
                <TouchableOpacity
                  style={[styles.ctaIconButton, isSeatConfigured && styles.seatButtonSet]}
                  onPress={handleOpenSeatDialog}
                  activeOpacity={0.85}
                >
                  <MaterialIcons
                    name="event-seat"
                    size={20}
                    color={isSeatConfigured ? colors.green.secondary : colors.textSecondary}
                  />
                  <ThemedText
                    style={[styles.ctaIconButtonText, isSeatConfigured && styles.seatButtonTextSet]}
                    numberOfLines={1}
                  >
                    {seatLabel ? `Seat ${seatLabel}` : "Seat"}
                  </ThemedText>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* Who you've invited */}
            <View
              style={styles.invitedSection}
              onLayout={(event) => {
                invitedSectionYRef.current = event.nativeEvent.layout.y;
              }}
            >
              <ThemedText style={styles.sectionLabel}>Invited</ThemedText>
              {sentPings.length === 0 ? (
                <ThemedText style={styles.invitedEmptyText}>
                  You haven&apos;t invited anyone yet.
                </ThemedText>
              ) : (
                <View style={styles.invitedList}>
                  {sentPings.map((ping) => {
                    const statusLabel = ping.dismissed_at
                      ? "Dismissed"
                      : ping.seen_at
                        ? "Seen"
                        : "Pending";
                    const statusColor = ping.dismissed_at
                      ? colors.red.secondary
                      : ping.seen_at
                        ? colors.green.secondary
                        : colors.textSecondary;
                    return (
                      <View key={ping.id} style={styles.invitedRow}>
                        <MaterialIcons name="person" size={14} color={colors.textSecondary} />
                        <ThemedText style={styles.invitedRowName} numberOfLines={1}>
                          {ping.receiver_name}
                        </ThemedText>
                        <ThemedText style={[styles.invitedRowStatus, { color: statusColor }]}>
                          {statusLabel}
                        </ThemedText>
                        <TouchableOpacity
                          style={styles.uninviteButton}
                          onPress={() => {
                            if (!showtime) return;
                            uninviteFriend({ showtimeId: showtime.id, friendId: ping.receiver_id });
                          }}
                          disabled={isUninviting}
                          hitSlop={6}
                          activeOpacity={0.6}
                        >
                          <MaterialIcons name="close" size={14} color={colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* Invite friends (collapsible, blue invite coding) */}
            <TouchableOpacity
              style={styles.inviteToggle}
              onPress={toggleInviteFriends}
              activeOpacity={0.85}
            >
              <MaterialIcons name="mail-outline" size={18} color={colors.blue.secondary} />
              <ThemedText style={styles.inviteToggleText}>Invite friends</ThemedText>
              <Animated.View style={{ transform: [{ rotate: caretSpin }] }}>
                <MaterialIcons name="expand-more" size={20} color={colors.blue.secondary} />
              </Animated.View>
            </TouchableOpacity>

            {showInviteFriends ? (
              <View style={styles.invitePanel}>
                {!inviteListReady || isLoadingFriends ? (
                  <View style={styles.inviteLoader}>
                    <ActivityIndicator size="small" color={colors.tint} />
                  </View>
                ) : (
                  <>
                    <View style={styles.inviteSearchRow}>
                      <MaterialIcons name="search" size={15} color={colors.textSecondary} />
                      <BottomSheetTextInput
                        ref={searchInputRef}
                        autoFocus
                        onChangeText={setPingSearchQuery}
                        placeholder="Search friends"
                        placeholderTextColor={colors.textSecondary}
                        style={styles.inviteSearchInput}
                        returnKeyType="done"
                        submitBehavior="submit"
                        onFocus={handleInviteSearchFocus}
                        onSubmitEditing={handleSubmitInviteSearch}
                      />
                    </View>
                    {filteredFriendsForPing.length === 0 ? (
                      <ThemedText style={styles.inviteEmptyText}>No friends found.</ThemedText>
                    ) : (
                      <View style={styles.inviteList}>
                        {filteredFriendsForPing.map((friend) => {
                          const isEligible = friend.availability === "eligible";
                          const isHighlighted =
                            isEligible &&
                            friend.id === firstEligibleFriendId &&
                            pingSearchQuery.trim().length > 0;
                          const statusLabel =
                            friend.availability === "going"
                              ? "Going"
                              : friend.availability === "interested"
                                ? "Interested"
                                : null;
                          return (
                            <FriendInviteRow
                              key={friend.id}
                              name={friend.label}
                              watchStatus={friend.watchStatus}
                              statusLabel={statusLabel}
                              mode="invite"
                              highlighted={isHighlighted}
                              disabled={!isEligible || isPingingFriend}
                              onInvite={() => handlePingFriend(friend.id)}
                            />
                          );
                        })}
                      </View>
                    )}
                    {/* Over-scroll room + a subtle end marker so the search can
                        always be parked above the keyboard, even when typing has
                        filtered the list down to a couple of names. */}
                    <View
                      style={[styles.inviteEndSpacer, { height: inviteScrollPadding }]}
                      pointerEvents="none"
                    >
                      {filteredFriendsForPing.length > 0 ? (
                        <View style={styles.inviteEndMark} />
                      ) : null}
                    </View>
                  </>
                )}
              </View>
            ) : null}
          </>
        )}
      </BottomSheetScrollView>

      {/* Seat editor (assigned-seating cinemas only) */}
      <Modal
        transparent
        statusBarTranslucent
        visible={isSeatDialogVisible && !isFreeSeating}
        animationType="fade"
        onRequestClose={() => setIsSeatDialogVisible(false)}
      >
        <View style={styles.seatDialogBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setIsSeatDialogVisible(false)}
          />
          <View style={styles.seatDialogCard}>
            <ThemedText style={styles.seatDialogTitle}>Seat info</ThemedText>
            <View style={styles.seatEditorRow}>
              <TextInput
                value={seatRowDraft}
                onChangeText={setSeatRowDraft}
                placeholder="Row"
                placeholderTextColor={colors.textSecondary}
                style={[styles.seatInput, seatRowValidationError && styles.seatInputInvalid]}
                autoCapitalize="characters"
                autoCorrect={false}
                keyboardType={seatInputConfig.rowKind === "digits" ? "number-pad" : "default"}
                maxLength={getSeatFieldMaxLength(seatInputConfig.rowKind)}
              />
              <TextInput
                value={seatNumberDraft}
                onChangeText={setSeatNumberDraft}
                placeholder="Seat"
                placeholderTextColor={colors.textSecondary}
                style={[styles.seatInput, seatNumberValidationError && styles.seatInputInvalid]}
                autoCapitalize="characters"
                autoCorrect={false}
                keyboardType={seatInputConfig.seatKind === "digits" ? "number-pad" : "default"}
                maxLength={getSeatFieldMaxLength(seatInputConfig.seatKind)}
              />
            </View>
            {seatValidationError ? (
              <ThemedText style={styles.seatValidationErrorText}>{seatValidationError}</ThemedText>
            ) : null}
            <TouchableOpacity
              style={[styles.seatSaveButton, !canSaveSeat && styles.seatSaveButtonDisabled]}
              onPress={handleSaveSeat}
              activeOpacity={0.8}
              disabled={!canSaveSeat}
            >
              <ThemedText style={styles.seatSaveButtonText}>Save</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Friends who watchlisted / watched this film, with an invite affordance */}
      <Modal
        transparent
        statusBarTranslucent
        visible={watchModalKind !== null}
        animationType="fade"
        onRequestClose={() => setWatchModalKind(null)}
      >
        <View style={styles.seatDialogBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setWatchModalKind(null)}
          />
          <View style={styles.watchModalCard}>
            {(() => {
              const watchFriends =
                watchModalKind === "watched" ? friendsWatched : friendsWatchlisted;
              const verb = watchModalKind === "watched" ? "Watched" : "Watchlisted";
              const title = `${verb} by ${watchFriends.length} friend${
                watchFriends.length === 1 ? "" : "s"
              }`;
              return (
                <>
                  <View style={styles.watchModalHeader}>
                    <ThemedText style={styles.watchModalTitle}>{title}</ThemedText>
                    <TouchableOpacity
                      onPress={() => setWatchModalKind(null)}
                      hitSlop={8}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="close" size={18} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                  <ScrollView
                    style={styles.watchModalScroll}
                    contentContainerStyle={styles.watchModalList}
                    showsVerticalScrollIndicator={false}
                  >
                    {watchFriends.map((friend) => {
                      const availability: FriendPingAvailability = friendsGoingIds.has(friend.id)
                        ? "going"
                        : friendsInterestedIds.has(friend.id)
                          ? "interested"
                          : pingedReceiverIds.has(friend.id)
                            ? "pinged"
                            : "eligible";
                      const statusLabel =
                        availability === "going"
                          ? "Going"
                          : availability === "interested"
                            ? "Interested"
                            : null;
                      return (
                        <FriendInviteRow
                          key={friend.id}
                          name={friend.display_name?.trim() || "Friend"}
                          watchStatus={watchModalKind}
                          statusLabel={statusLabel}
                          mode="invite"
                          invited={availability === "pinged"}
                          disabled={availability !== "eligible" || isPingingFriend}
                          onInvite={() => handlePingFriend(friend.id)}
                        />
                      );
                    })}
                  </ScrollView>
                </>
              );
            })()}
          </View>
        </View>
      </Modal>

      <VisibilityModePicker
        visible={isVisibilityPickerOpen}
        selectedMode={visibility?.mode ?? null}
        onSelect={handleVisibilityModeSelect}
        onClose={() => setIsVisibilityPickerOpen(false)}
      />
    </BottomSheetModal>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) =>
  StyleSheet.create({
    handleContainer: {
      alignItems: "center",
      paddingTop: 10,
      paddingBottom: 2,
    },
    handleBar: {
      width: 40,
      height: 4,
      borderRadius: 999,
      backgroundColor: colors.divider,
    },
    sheetBackground: {
      backgroundColor: colors.background,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
      overflow: "hidden",
    },
    topTint: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      height: 190,
      borderTopLeftRadius: 16,
      borderTopRightRadius: 16,
    },
    scroll: { flex: 1, backgroundColor: "transparent" },
    scrollContent: { paddingHorizontal: 20, paddingTop: 0, paddingBottom: 32, gap: 14, flexGrow: 1 },

    loadingState: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
    loadingErrorText: { fontSize: 14, color: colors.textSecondary },

    summaryRow: { flexDirection: "row", gap: 12 },
    poster: {
      width: 84,
      height: 126,
      borderRadius: 8,
      backgroundColor: colors.posterPlaceholder,
    },
    summaryInfo: { flex: 1, gap: 1 },
    movieTitle: { fontSize: 19, fontWeight: "800", color: colors.text, paddingRight: 36 },
    originalTitle: { fontSize: 12, color: colors.textSecondary, fontStyle: "italic", marginTop: 1 },
    directorText: { fontSize: 10, color: colors.textSecondary, marginTop: -4 },
    directorLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.6, color: colors.textSecondary },
    dateText: { fontSize: 12.5, fontWeight: "600", color: colors.text, marginTop: -4 },
    timeText: { fontSize: 12.5, color: colors.textSecondary, marginTop: -4 },
    cinemaBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    movieLinksRow: { flexDirection: "row", gap: 6, marginTop: 2 },
    movieLinkChip: {
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: 20,
      backgroundColor: colors.pillBackground,
      borderWidth: 1,
      borderColor: colors.cardBorder,
    },
    movieLinkChipText: { fontSize: 11, fontWeight: "600", color: colors.textSecondary },
    closeButton: {
      position: "absolute",
      top: -10,
      right: 0,
      width: 30,
      height: 30,
      borderRadius: 15,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.pillBackground,
    },

    audienceBox: {
      minHeight: 42,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: `${colors.divider}80`,
      paddingVertical: 10,
      justifyContent: "center",
    },
    audienceBoxEmpty: { alignItems: "center" },
    audienceEmptyText: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: "center",
    },

    watchButtonsRow: { flexDirection: "row", gap: 8 },
    watchButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingVertical: 9,
      paddingHorizontal: 10,
    },
    watchButtonEmpty: { opacity: 0.6 },
    watchButtonText: {
      flexShrink: 1,
      fontSize: 12,
      fontWeight: "700",
      color: colors.textSecondary,
    },

    invitedYouBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: colors.blue.primary,
    },
    invitedYouText: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.text },

    statusRow: { flexDirection: "row", gap: 8 },
    statusButton: {
      flex: 1,
      gap: 5,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.pillBackground,
      paddingVertical: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    statusButtonSelected: {
      shadowOpacity: 0.2,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    statusButtonText: { fontSize: 13, fontWeight: "700", color: colors.textSecondary },

    visibilityChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      borderWidth: 1,
      borderRadius: 11,
      backgroundColor: colors.cardBackground,
      paddingVertical: 8,
      paddingHorizontal: 12,
    },
    visibilityChipLabel: {
      flex: 1,
      fontSize: 13,
      fontWeight: "600",
      color: colors.textSecondary,
    },
    visibilityChipValue: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderRadius: 8,
      paddingVertical: 3,
      paddingHorizontal: 8,
    },
    visibilityChipValueText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.pillActiveText,
    },
    ctaRow: { flexDirection: "row", gap: 8 },
    ctaIconButton: {
      gap: 4,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingTop: 11,
      paddingBottom: 7,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.cardBackground,
    },
    ctaIconButtonText: { fontSize: 11, fontWeight: "700", color: colors.textSecondary, textAlign: "center" },
    ticketButton: { flex: 1 },
    seatButtonSet: { borderColor: colors.green.secondary, backgroundColor: colors.green.primary },
    seatButtonTextSet: { color: colors.green.secondary },

    invitedSection: { gap: 8 },
    sectionLabel: {
      fontSize: 11,
      fontWeight: "700",
      letterSpacing: 0.4,
      textTransform: "uppercase",
      color: colors.textSecondary,
    },
    invitedEmptyText: { fontSize: 13, color: colors.textSecondary },
    invitedList: { gap: 4 },
    invitedRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 7,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    invitedRowName: { flex: 1, fontSize: 13, fontWeight: "500", color: colors.text },
    invitedRowStatus: { fontSize: 11, fontWeight: "600" },
    uninviteButton: {
      padding: 2,
      borderRadius: 4,
    },

    inviteToggle: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 11,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: colors.blue.primary,
    },
    inviteToggleText: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.blue.secondary },

    invitePanel: { gap: 10, paddingTop: 2 },
    inviteLoader: { alignItems: "center", paddingVertical: 20 },
    inviteEmptyText: { fontSize: 13, color: colors.textSecondary, paddingVertical: 6 },
    inviteList: { gap: 6 },
    inviteEndSpacer: { paddingTop: 16, alignItems: "center" },
    inviteEndMark: { width: 28, height: 3, borderRadius: 2, backgroundColor: colors.divider },
    inviteSearchRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.searchBackground,
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    inviteSearchInput: { flex: 1, fontSize: 14, color: colors.text, paddingVertical: 0 },

    seatDialogBackdrop: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.28)",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 20,
    },
    seatDialogCard: {
      width: "100%",
      maxWidth: 360,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      padding: 14,
      gap: 10,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 9,
    },
    seatDialogTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
    seatEditorRow: { flexDirection: "row", gap: 8 },
    seatInput: {
      flex: 1,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 9,
      paddingVertical: 8,
      fontSize: 14,
      color: colors.text,
    },
    seatInputInvalid: { borderColor: colors.red.secondary },
    seatValidationErrorText: { fontSize: 11, color: colors.red.secondary, marginTop: -2 },
    seatSaveButton: {
      minHeight: 38,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.tint,
    },
    seatSaveButtonDisabled: { opacity: 0.5 },
    seatSaveButtonText: { fontSize: 13, fontWeight: "700", color: colors.pillActiveText },

    watchModalCard: {
      width: "100%",
      maxWidth: 380,
      maxHeight: "70%",
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.background,
      padding: 14,
      gap: 10,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 9,
    },
    watchModalHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    watchModalTitle: { flex: 1, fontSize: 16, fontWeight: "700", color: colors.text },
    watchModalScroll: { flexGrow: 0 },
    watchModalList: { gap: 6, paddingBottom: 2 },
  });
