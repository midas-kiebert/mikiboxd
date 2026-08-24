/**
 * Showtime status bottom sheet ("Update your status").
 *
 * Rises from the bottom (gorhom BottomSheetModal, mirroring FiltersModal) and is
 * self-contained: poster + title + full date + time·runtime + cinema badge, a box
 * of who is going/interested, the tiny watchlisted/watched friend markers, an
 * optional "X invited you" banner, the status
 * buttons (Not going / Interested / Going), the Get Ticket + Seat actions, a list
 * of who you've invited, and the invite-friends panel. A subtle colored tint bleeds
 * from the top to reflect the current status (green going / orange interested /
 * blue when you have an open invite).
 *
 * It is mounted once by ShowtimeModalProvider and driven by the controlled
 * `visible` prop; screens open it through the useShowtimeModal() hook. Opening
 * waits for the showtime's content to have reached the sheet before raising it,
 * so it never rises showing the showtime it was opened with last time — see
 * `CommittedShowtimeReporter`.
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
  Share,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import {
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "@gorhom/bottom-sheet";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { LinearGradient } from "expo-linear-gradient";
import { QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ShowtimesService,
  type GoingStatus,
  type MeGetCurrentUserResponse,
  type SentShowtimePingPublic,
  type ShowtimePublic,
  type UserPublic,
  type VisibilityMode,
} from "shared";
import useAuth from "shared/hooks/useAuth";
import { useFetchFriends } from "shared/hooks/useFetchFriends";
import {
  showtimeVisibilityQueryKey,
  useShowtimeVisibility,
} from "shared/hooks/useShowtimeVisibility";
import {
  showtimeSeatAvailabilityQueryKey,
  useShowtimeSeatAvailability,
} from "shared/hooks/useShowtimeSeatAvailability";
import useTrackEvent from "shared/hooks/useTrackEvent";

import CinemaPill from "@/components/badges/CinemaPill";
import {
  formatCheckedAt,
  formatSeatCount,
  getSeatAvailabilityMeta,
} from "@/components/showtimes/seat-availability-level";
import {
  getVisibilityModeMeta,
  VISIBILITY_MODE_ORDER,
} from "@/components/showtimes/visibility-mode";
import SubtitlesBadges from "@/components/badges/SubtitlesBadges";
import FriendBadges from "@/components/badges/FriendBadges";
import FriendListRow, {
  type FriendPingStatus,
  type FriendWatchStatus,
} from "@/components/friends/FriendListRow";
import FriendWatchListModal from "@/components/friends/FriendWatchListModal";
import InviteBeforePrivateDialog from "@/components/showtimes/InviteBeforePrivateDialog";
import SheetBackdrop from "@/components/sheets/SheetBackdrop";
import {
  getFriendWatchKindMeta,
  type FriendWatchKind,
} from "@/components/friends/friend-watch-kind";
import InlineFriendRequestButtons from "@/components/friends/InlineFriendRequestButtons";
import { ThemedText } from "@/components/themed-text";
import { useSingleFireNavigation } from "@/hooks/useSingleFireNavigation";
import { useThemeColors } from "@/hooks/use-theme-color";
import { formatShowtimeTimeRange } from "@/utils/showtime-time";
import { formatSeatLabel } from "@/utils/seat-label";
import { buildShowtimePingUrl } from "@/constants/ping-link";
import {
  UNKNOWN_METADATA_PLACEHOLDER,
  isSyntheticMovieId,
} from "@/constants/synthetic-movies";
import { getAvatarColors, getAvatarInitial } from "@/utils/avatar-color";
import { useIsSignedIn } from "@/utils/auth-session";
import { useSignInGate } from "@/components/auth/SignInGateProvider";
import { useRegisterBlockingOverlay } from "@/utils/blocking-overlays";
import { EXPAND_LAYOUT_ANIMATION } from "@/utils/expand-animation";
import { triggerImpactHaptic, triggerSelectionHaptic } from "@/utils/long-press";
import { Skeleton } from "@/components/ui/Skeleton";
import PosterPlaceholder from "@/components/ui/PosterPlaceholder";
import { formatLanguageCode } from "@/utils/language";
import { measureForSpotlight } from "@/utils/spotlight-measure";
import * as Clipboard from "expo-clipboard";
import { loadCinevilleCardDigits } from "@/utils/cineville-card";

export type ShowtimeInvite = {
  senders: UserPublic[];
  pingIds: number[];
};

/** The controls the first-run intro's tour can point at. */
export type ShowtimeSheetTourTarget = "interested" | "going" | "invite";

export type ShowtimeSheetTour = {
  /** Which control the tour is on; the sheet scrolls it into view. */
  target: ShowtimeSheetTourTarget;
  /**
   * Where that control ended up, in window coordinates, once the sheet and the
   * scroll have settled. Drives the spotlight drawn over the sheet.
   */
  onTargetRect: (rect: { x: number; y: number; width: number; height: number }) => void;
};

type FriendPingAvailability = "eligible" | "pinged" | "going" | "interested";

type ReportReason =
  | "incorrect_movie"
  | "incorrect_time"
  | "does_not_exist"
  | "duplicate"
  | "wrong_subtitles";

const REPORT_REASON_OPTIONS: { value: ReportReason; label: string }[] = [
  { value: "incorrect_movie", label: "Wrong movie" },
  { value: "incorrect_time", label: "Wrong time" },
  { value: "wrong_subtitles", label: "Wrong subtitles" },
  { value: "does_not_exist", label: "Doesn't exist" },
  { value: "duplicate", label: "Duplicate" },
];

type ShowtimeActionModalProps = {
  visible: boolean;
  showtime: ShowtimePublic | null;
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
  /** Carries the showtimes-tab filters over to the movie page when navigating there. */
  inheritFilters?: boolean;
  /**
   * Set by the first-run intro: renders the sheet as a showcase over mock data
   * — no requests, no gestures — and reports where the tour's current target
   * sits so the intro can spotlight it.
   */
  tour?: ShowtimeSheetTour | null;
};

// ─── Seat input helpers ───────────────────────────────────────────────────────

type SeatFieldKind = "unknown" | "digits" | "letter";

type SeatInputConfig = {
  rowKind: SeatFieldKind;
  seatKind: SeatFieldKind;
};

// Header close button geometry, shared with the watch-marker column that starts
// just below it so the two can't collide as either one is retuned.
const CLOSE_BUTTON_SIZE = 30;
const CLOSE_BUTTON_TOP = -10;
const WATCH_MARKER_GAP = 8;

/**
 * How long the tour waits before reading its first target's position: long
 * enough for the sheet's entry animation (`animationConfigs` below is 220ms)
 * to have finished, with a small safety margin. Only applies to the very
 * first step after the sheet opens — see `SUBSEQUENT_TOUR_MEASURE_DELAYS_MS`
 * for every step after that, where the sheet is already open and there is no
 * entry animation left to wait out.
 */
const TOUR_MEASURE_DELAYS_MS = [300, 600];

/**
 * How long later steps wait: the sheet is already open, so there is nothing
 * to settle except a possible `scrollTo`/`scrollToEnd` — and most steps don't
 * even trigger one, since they're already scrolled to the top. Near-instant,
 * with one late correction in case that step's scroll was real (the "invite"
 * step is the only one that is).
 */
const SUBSEQUENT_TOUR_MEASURE_DELAYS_MS = [0, 300];

/**
 * How long an open waits for the sheet's content to reach the portal (see
 * `CommittedShowtimeReporter`) before the sheet rises anyway. That wait is
 * normally a frame or two; this only puts a floor under a pathological render
 * so a content commit that never arrives can't keep the sheet shut.
 */
const PRESENT_CONTENT_TIMEOUT_MS = 150;

/**
 * Renders nothing: it reports which showtime the sheet's content has actually
 * been committed with.
 *
 * The sheet's content is handed to @gorhom/portal, whose host renders it from
 * its own state — so it lands on screen one commit *after* the render that
 * produced it. This component is part of that content, which makes its effect
 * fire in the commit the content itself became visible in.
 */
function CommittedShowtimeReporter({
  showtimeId,
  onCommitted,
}: {
  showtimeId: number | null;
  onCommitted: (showtimeId: number | null) => void;
}) {
  useEffect(() => {
    onCommitted(showtimeId);
  }, [showtimeId, onCommitted]);
  return null;
}

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

/** "Alice", "Alice and Bob", "Alice and 2 others". */
const formatInviterNames = (senders: UserPublic[]): string => {
  const names = getUniqueSenderNames(senders);
  return names.length <= 1
    ? (names[0] ?? "A friend")
    : names.length === 2
      ? `${names[0]} and ${names[1]}`
      : `${names[0]} and ${names.length - 1} others`;
};

const formatInvitedYou = (senders: UserPublic[]): string =>
  `${formatInviterNames(senders)} invited you.`;

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
  inheritFilters = false,
  tour = null,
}: ShowtimeActionModalProps) {
  const { top: topInset, bottom: bottomInset } = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const router = useRouter();
  const goToMoviePage = useSingleFireNavigation(
    (movieId: number, cinemaId: number) =>
      router.push({
        pathname: "/movie/[id]",
        params: {
          id: String(movieId),
          cinemaId: String(cinemaId),
          ...(inheritFilters ? { inheritFilters: "1" } : {}),
        },
      })
  );
  const goToUserPage = useSingleFireNavigation((userId: string, name: string) =>
    router.push({ pathname: "/friend-showtimes/[id]", params: { id: userId, name } })
  );
  // Generous trailing space so the invite section can always be scrolled to the
  // top, even after typing shrinks the friend list (so the view doesn't jump).
  const inviteScrollPadding = Math.round(windowHeight * 0.6);
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const queryClient = useQueryClient();
  const currentUser = queryClient.getQueryData<MeGetCurrentUserResponse>(["currentUser"]);
  const { trackEvent } = useTrackEvent();

  const bottomSheetModalRef = useRef<BottomSheetModal>(null);
  const scrollViewRef = useRef<any>(null);
  const searchInputRef = useRef<any>(null);
  // Y-offset of the "Invited" section header; used so that section is visible
  // at the top of the sheet when the invite panel opens / search focuses.
  const invitedSectionYRef = useRef(0);
  // 80% by default; a full-height detent so scrolling up first lifts the sheet
  // to the top of the screen before the content itself scrolls.
  // Everything on this sheet below the status buttons is about people — the
  // friends coming, who you invited, who can see you're going. A guest has
  // none of it and no way to get any without an account, so those sections are
  // absent rather than rendered permanently empty. The status buttons stay:
  // tapping one is how a guest finds out an account is what they're for (see
  // ShowtimeModalProvider's gate), and the screening itself — film, cinema,
  // time, ticket link — is public and unchanged.
  const isSignedIn = useIsSignedIn();
  const { promptForAccount } = useSignInGate();

  // A guest sees the header, the status buttons and the ticket row — roughly
  // half of what a signed-in sheet holds — so it opens at half the height
  // rather than as a mostly-empty tall sheet. Both keep the full-height snap.
  const snapPoints = useMemo(
    () => (isSignedIn ? ["80%", "100%"] : ["52%", "100%"]),
    [isSignedIn]
  );

  // Drive the gorhom sheet imperatively from the controlled `visible` prop
  // (same approach as FiltersModal): present() on open, close() on programmatic
  // close, and never close() when gorhom already closed the sheet.
  const hasEverPresentedRef = useRef(false);
  const closedByGorhomRef = useRef(false);
  // Because the portal renders the content a commit late, raising the sheet the
  // moment `visible` flips would show the *previous* showtime for a frame or
  // two — the sheet stays mounted between opens, so its old content is still
  // there. These line the two up: what the portal has committed, and which
  // showtime is waiting on that to be presented.
  const committedShowtimeIdRef = useRef<number | null>(null);
  const pendingPresentShowtimeIdRef = useRef<number | null>(null);
  const isPresentPendingRef = useRef(false);
  const presentTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showInviteFriends, setShowInviteFriends] = useState(false);
  const [inviteListReady, setInviteListReady] = useState(false);
  const [pingSearchQuery, setPingSearchQuery] = useState("");
  const [seatRowDraft, setSeatRowDraft] = useState("");
  const [seatNumberDraft, setSeatNumberDraft] = useState("");
  const [isSeatDialogVisible, setIsSeatDialogVisible] = useState(false);
  const [isReportDialogVisible, setIsReportDialogVisible] = useState(false);
  const { user } = useAuth();
  const canReport = isSignedIn && (user ? user.can_report : true);
  const [isVisibilityExpanded, setIsVisibilityExpanded] = useState(false);
  const [isSeatInfoExpanded, setIsSeatInfoExpanded] = useState(false);
  // Which "watchlisted/watched by friends" popup is open, if any.
  const [watchModalKind, setWatchModalKind] = useState<FriendWatchKind | null>(null);
  const [isDismissInviteDialogVisible, setIsDismissInviteDialogVisible] = useState(false);
  // Friends already going/interested but not yet invited, surfaced right
  // before a switch to INVITED_ONLY so they aren't silently hidden.
  const [inviteBeforePrivateCandidates, setInviteBeforePrivateCandidates] = useState<
    UserPublic[]
  >([]);
  const [isInviteBeforePrivateVisible, setIsInviteBeforePrivateVisible] = useState(false);
  // Same custom fade, plus a subtle scale-in for the confirm card.
  const dismissDialogAnim = useRef(new Animated.Value(0)).current;
  const dismissDialogScale = useMemo(
    () => dismissDialogAnim.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }),
    [dismissDialogAnim]
  );

  // Caret rotation for the invite-friends toggle (native thread, like FiltersModal).
  const caretRotation = useRef(new Animated.Value(0)).current;
  const caretSpin = useMemo(
    () => caretRotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }),
    [caretRotation]
  );
  // Same native-thread caret rotation for the visibility dropdown toggle.
  const visibilityCaretRotation = useRef(new Animated.Value(0)).current;
  const visibilityCaretSpin = useMemo(
    () =>
      visibilityCaretRotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }),
    [visibilityCaretRotation]
  );
  // ...and for the busyness detail toggle.
  const seatInfoCaretRotation = useRef(new Animated.Value(0)).current;
  const seatInfoCaretSpin = useMemo(
    () =>
      seatInfoCaretRotation.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }),
    [seatInfoCaretRotation]
  );

  const selectedShowtimeId = showtime?.id ?? null;
  // Read by the present effect, which must run on `visible` alone: re-presenting
  // a sheet that is already open would snap it back to its first detent. Kept in
  // sync above that effect, so it is already current when the sheet opens.
  const selectedShowtimeIdRef = useRef(selectedShowtimeId);
  useEffect(() => {
    selectedShowtimeIdRef.current = selectedShowtimeId;
  }, [selectedShowtimeId]);
  // The tour runs on mock data: every request it could make would be about a
  // showtime that does not exist, and the answers are already invented.
  const isTour = tour !== null;
  const sheetDataEnabled = visible && selectedShowtimeId !== null && !isTour && isSignedIn;

  // Window positions of the controls the tour explains, read on demand rather
  // than on layout: layout fires while the sheet is still rising, so it would
  // report where a button was on the way up.
  const tourTargetRefs = useRef<Record<ShowtimeSheetTourTarget, View | null>>({
    interested: null,
    going: null,
    invite: null,
  });
  const tourTarget = tour?.target ?? null;
  const onTourTargetRect = tour?.onTargetRect;

  // Registered as a blocking overlay for as long as the sheet is actually on
  // screen — including mid-close-animation. Driven off gorhom's own index
  // rather than the `visible` prop: `visible` flips false the instant a close
  // is requested, but the sheet keeps sliding down for a couple hundred ms
  // after that, and anything gating on "is a blocking overlay open" (e.g. the
  // intro's filters spotlight) must not treat the sheet as gone until it
  // truly is, or it ends up highlighting the Filters button over a sheet
  // that's still visibly there.
  const [isPresented, setIsPresented] = useState(false);

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) {
        closedByGorhomRef.current = true;
        setIsPresented(false);
        onClose();
        return;
      }
      // The sheet just settled on a snap point — including, on the very
      // first open, the end of its entry animation. TOUR_MEASURE_DELAYS_MS
      // above is only a guess at how long that takes; if it ran long, the
      // guessed delay sampled the target mid-rise and the first tour step
      // never got a hole to highlight. Re-measuring off the real settle
      // event catches that case regardless of device speed.
      if (tourTarget) {
        measureForSpotlight(tourTargetRefs.current[tourTarget], (rect) => {
          onTourTargetRectRef.current?.(rect);
        });
      }
    },
    [onClose, tourTarget]
  );

  useRegisterBlockingOverlay(isPresented, onClose);

  const presentSheet = useCallback(() => {
    isPresentPendingRef.current = false;
    if (presentTimeoutRef.current !== null) {
      clearTimeout(presentTimeoutRef.current);
      presentTimeoutRef.current = null;
    }
    hasEverPresentedRef.current = true;
    closedByGorhomRef.current = false;
    setIsPresented(true);
    bottomSheetModalRef.current?.present();
  }, []);

  // Reported from inside the portal: if the sheet was waiting for this showtime
  // to be on screen before rising, it can rise now.
  const handleContentCommitted = useCallback(
    (showtimeId: number | null) => {
      committedShowtimeIdRef.current = showtimeId;
      if (isPresentPendingRef.current && pendingPresentShowtimeIdRef.current === showtimeId) {
        presentSheet();
      }
    },
    [presentSheet]
  );

  useEffect(() => {
    if (!visible) {
      isPresentPendingRef.current = false;
      if (presentTimeoutRef.current !== null) {
        clearTimeout(presentTimeoutRef.current);
        presentTimeoutRef.current = null;
      }
      if (hasEverPresentedRef.current && !closedByGorhomRef.current) {
        bottomSheetModalRef.current?.close();
      }
      return;
    }
    // Nothing has been rendered into the portal yet (first open of the app's
    // session), or it already holds this showtime (re-opening the same one):
    // either way there is no stale content to wait out.
    if (
      !hasEverPresentedRef.current ||
      committedShowtimeIdRef.current === selectedShowtimeIdRef.current
    ) {
      presentSheet();
      return;
    }
    pendingPresentShowtimeIdRef.current = selectedShowtimeIdRef.current;
    isPresentPendingRef.current = true;
    presentTimeoutRef.current = setTimeout(presentSheet, PRESENT_CONTENT_TIMEOUT_MS);
  }, [visible, presentSheet]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // Held in a ref so re-measuring depends on which target the tour is on, not
  // on the identity of the callback that receives it.
  const onTourTargetRectRef = useRef(onTourTargetRect);
  useEffect(() => {
    onTourTargetRectRef.current = onTourTargetRect;
  }, [onTourTargetRect]);

  // Whether this presentation of the sheet has already measured a target
  // once: false right after the sheet opens (so the first step waits out its
  // entry animation), true from then on (so later steps don't).
  const hasMeasuredTourTargetRef = useRef(false);
  useEffect(() => {
    if (!visible) hasMeasuredTourTargetRef.current = false;
  }, [visible]);

  // Bring the tour's current target into view, then report where it landed.
  useEffect(() => {
    if (!visible || tourTarget === null) return;
    const isFirstMeasureThisOpen = !hasMeasuredTourTargetRef.current;
    hasMeasuredTourTargetRef.current = true;
    // The invite toggle is the last thing in the sheet; the status buttons are
    // in the part that is on screen the moment the sheet opens.
    if (tourTarget === "invite") {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    } else {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    }
    const delays = isFirstMeasureThisOpen
      ? TOUR_MEASURE_DELAYS_MS
      : SUBSEQUENT_TOUR_MEASURE_DELAYS_MS;
    const timers = delays.map((delay) =>
      setTimeout(() => {
        measureForSpotlight(tourTargetRefs.current[tourTarget], (rect) => {
          onTourTargetRectRef.current?.(rect);
        });
      }, delay)
    );
    return () => timers.forEach(clearTimeout);
  }, [tourTarget, visible]);

  // Reset transient UI when the sheet closes or switches showtime.
  useEffect(() => {
    if (!visible) {
      setShowInviteFriends(false);
      setInviteListReady(false);
      setPingSearchQuery("");
      setIsSeatDialogVisible(false);
      setIsReportDialogVisible(false);
      setWatchModalKind(null);
      setIsVisibilityExpanded(false);
      caretRotation.setValue(0);
      visibilityCaretRotation.setValue(0);
    }
  }, [visible, caretRotation, visibilityCaretRotation]);


  useEffect(() => {
    setSeatRowDraft(showtime?.viewer?.seat_row ?? "");
    setSeatNumberDraft(showtime?.viewer?.seat_number ?? "");
  }, [showtime?.id, showtime?.viewer?.seat_row, showtime?.viewer?.seat_number]);

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
    // The row's "Invited" state reads off `sentPings`, so without an
    // optimistic entry it only flips once the request round-trips and the
    // invalidated query refetches — paint it immediately instead.
    onMutate: async ({ friendId }) => {
      await queryClient.cancelQueries({ queryKey: sentPingsQueryKey });
      const previousPings = queryClient.getQueryData<SentShowtimePingPublic[]>(sentPingsQueryKey);
      const friendName = friends?.find((f) => f.id === friendId)?.display_name?.trim() || "Friend";
      const optimisticPing: SentShowtimePingPublic = {
        id: -Date.now(),
        receiver_id: friendId,
        receiver_name: friendName,
        created_at: new Date().toISOString(),
        seen_at: null,
        dismissed_at: null,
      };
      queryClient.setQueryData<SentShowtimePingPublic[]>(sentPingsQueryKey, (prev) => [
        ...(prev ?? []),
        optimisticPing,
      ]);
      return { previousPings };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sentPingsQueryKey });
      trackEvent("invite_sent");
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(sentPingsQueryKey, context?.previousPings);
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

  const { mutate: reportShowtimeIssue, isPending: isSubmittingReport } = useMutation({
    mutationFn: ({
      showtimeId,
      reason,
    }: {
      showtimeId: number;
      reason: ReportReason;
    }) => ShowtimesService.reportShowtime({ showtimeId, requestBody: { reason } }),
    onSuccess: () => {
      setIsReportDialogVisible(false);
      Alert.alert("Thanks!", "We'll take a look at this showtime.");
    },
    onError: () => {
      Alert.alert("Error", "Could not submit the report. Please try again.");
    },
  });

  const handleSubmitReport = (reason: ReportReason) => {
    if (!showtime) return;
    reportShowtimeIssue({ showtimeId: showtime.id, reason });
  };

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
  const visibilityQueryKey = useMemo(
    () => showtimeVisibilityQueryKey(selectedShowtimeId),
    [selectedShowtimeId]
  );
  // Usually already cached by the list that opened the sheet (see
  // usePrefetchShowtimeVisibility), so the mode pill paints without a
  // skeleton; this still revalidates in the background on every open.
  const { data: visibility } = useShowtimeVisibility({
    showtimeId: selectedShowtimeId,
    enabled: sheetDataEnabled,
  });

  const { mutate: updateVisibilityMode } = useMutation({
    mutationFn: ({ showtimeId, mode }: { showtimeId: number; mode: VisibilityMode }) =>
      ShowtimesService.updateShowtimeVisibility({ showtimeId, requestBody: { mode } }),
    onMutate: async ({ mode }) => {
      await queryClient.cancelQueries({ queryKey: visibilityQueryKey });
      const previousVisibility = queryClient.getQueryData(visibilityQueryKey);
      queryClient.setQueryData(visibilityQueryKey, (prev: typeof visibility) =>
        prev ? { ...prev, mode } : prev
      );
      return { previousVisibility };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(visibilityQueryKey, updated);
      queryClient.invalidateQueries({ queryKey: ["showtimes"] });
      queryClient.invalidateQueries({ queryKey: ["movie"] });
      queryClient.invalidateQueries({ queryKey: ["movies"] });
    },
    onError: (_error, _variables, context) => {
      // Roll back — otherwise the sheet keeps showing the mode the user
      // picked even though the backend never actually applied it.
      queryClient.setQueryData(visibilityQueryKey, context?.previousVisibility);
      Alert.alert("Error", "Could not update who can see your status.");
    },
  });

  const handleToggleVisibilityExpanded = useCallback(() => {
    triggerSelectionHaptic();
    const next = !isVisibilityExpanded;
    // Rotate the caret on the native thread, same as the invite-friends toggle.
    Animated.timing(visibilityCaretRotation, {
      toValue: next ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
    LayoutAnimation.configureNext(EXPAND_LAYOUT_ANIMATION);
    setIsVisibilityExpanded(next);
  }, [isVisibilityExpanded, visibilityCaretRotation]);

  const applyVisibilityMode = useCallback(
    (mode: VisibilityMode) => {
      if (!showtime) return;
      triggerSelectionHaptic();
      // Optimistic patch + rollback-on-error both live in the mutation's
      // onMutate/onError now, so every caller gets the same behavior.
      updateVisibilityMode({ showtimeId: showtime.id, mode });
    },
    [showtime, updateVisibilityMode]
  );

  const handleVisibilityModeSelect = useCallback(
    async (mode: VisibilityMode) => {
      LayoutAnimation.configureNext(EXPAND_LAYOUT_ANIMATION);
      Animated.timing(visibilityCaretRotation, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start();
      setIsVisibilityExpanded(false);
      if (!showtime || mode === visibility?.mode) return;

      if (mode === "INVITED_ONLY") {
        try {
          const { friends } = await queryClient.fetchQuery({
            queryKey: ["showtimes", "uninvitedSelectedFriends", showtime.id],
            queryFn: () =>
              ShowtimesService.getUninvitedSelectedFriendsForShowtime({
                showtimeId: showtime.id,
              }),
          });
          if (friends.length > 0) {
            setInviteBeforePrivateCandidates(friends);
            setIsInviteBeforePrivateVisible(true);
            return;
          }
        } catch {
          // If the lookup fails, fall through and apply the mode switch as
          // normal rather than blocking the user on an unrelated request.
        }
      }

      applyVisibilityMode(mode);
    },
    [showtime, visibility?.mode, queryClient, applyVisibilityMode]
  );

  const handleInviteBeforePrivateSkip = useCallback(() => {
    setIsInviteBeforePrivateVisible(false);
    applyVisibilityMode("INVITED_ONLY");
  }, [applyVisibilityMode]);

  const handleInviteBeforePrivateConfirm = useCallback(
    async (selectedIds: string[]) => {
      setIsInviteBeforePrivateVisible(false);
      if (showtime) {
        const showtimeId = showtime.id;
        // Bypasses the shared pingFriendForShowtime mutation on purpose: this
        // is a best-effort courtesy invite alongside the mode switch, not the
        // user directly pressing "Invite" on this friend, so a friend who
        // turns out to already be invited (a race with another invite path,
        // or this same tap landing twice) shouldn't surface an alert — the
        // outcome the user wants (friend invited) already holds either way.
        // Paint them as invited right away, same as the single-invite mutation
        // — otherwise the invite panel would show them as still invitable
        // until the invalidated query below wins its race with these writes.
        queryClient.setQueryData<SentShowtimePingPublic[]>(sentPingsQueryKey, (prev) => [
          ...(prev ?? []),
          ...selectedIds.map((friendId, index): SentShowtimePingPublic => ({
            id: -Date.now() - index,
            receiver_id: friendId,
            receiver_name:
              inviteBeforePrivateCandidates.find((friend) => friend.id === friendId)
                ?.display_name?.trim() || "Friend",
            created_at: new Date().toISOString(),
            seen_at: null,
            dismissed_at: null,
          })),
        ]);
        // One at a time, awaited: each invite (and the visibility switch
        // right after) rebuilds the same showtime's effective-visibility rows
        // on the backend, and firing them concurrently deadlocks Postgres —
        // seen on staging as a 500 on the visibility PUT and friends silently
        // not invited. There's no way to invite a handful of friends here
        // faster without that risk, so sequential is the correct fix, not
        // just a workaround.
        for (const friendId of selectedIds) {
          try {
            await ShowtimesService.pingFriendForShowtime({ showtimeId, friendId });
          } catch {
            // Best-effort, see comment above.
          }
        }
        queryClient.invalidateQueries({ queryKey: sentPingsQueryKey });
      }
      applyVisibilityMode("INVITED_ONLY");
    },
    [
      showtime,
      queryClient,
      sentPingsQueryKey,
      applyVisibilityMode,
      inviteBeforePrivateCandidates,
    ]
  );

  const visibilityMeta = visibility ? getVisibilityModeMeta(visibility.mode, colors) : null;

  // ─── How busy the showtime is ──────────────────────────────────────────────
  // Not gated on `sheetDataEnabled`: how full a screening is is a public fact,
  // and a guest browsing the schedule is exactly the person deciding whether
  // it's still worth going.
  const { data: seatAvailability } = useShowtimeSeatAvailability({
    showtimeId: selectedShowtimeId,
    enabled: visible && selectedShowtimeId !== null && !isTour,
  });
  const seatMeta = seatAvailability?.level
    ? getSeatAvailabilityMeta(seatAvailability.level, colors)
    : null;
  const isCheckingSeatAvailability = Boolean(seatAvailability?.checking);
  const seatCountLabel = seatAvailability ? formatSeatCount(seatAvailability) : null;
  const seatCheckedLabel = seatAvailability
    ? formatCheckedAt(seatAvailability.checked_at)
    : null;

  const handleToggleSeatInfoExpanded = useCallback(() => {
    triggerSelectionHaptic();
    const next = !isSeatInfoExpanded;
    Animated.timing(seatInfoCaretRotation, {
      toValue: next ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start();
    LayoutAnimation.configureNext(EXPAND_LAYOUT_ANIMATION);
    setIsSeatInfoExpanded(next);
  }, [isSeatInfoExpanded, seatInfoCaretRotation]);

  // ─── Waiting for a returned ticket ─────────────────────────────────────────
  // The account either has this or it doesn't; there is no tier to show, no
  // upsell, and nothing rendered at all for someone who can't use it.
  const canWatchSoldOut = Boolean(currentUser?.can_watch_sold_out);
  const soldOutWatchQueryKey = useMemo(() => ["soldOutWatch"] as const, []);
  const { data: soldOutWatch } = useQuery({
    queryKey: soldOutWatchQueryKey,
    queryFn: () => ShowtimesService.getSoldOutWatch(),
    enabled: sheetDataEnabled && canWatchSoldOut,
  });
  const isWatchingThisShowtime =
    soldOutWatch != null && soldOutWatch.showtime_id === selectedShowtimeId;
  // A watch pointed elsewhere is not an obstacle — starting one here moves it —
  // but the user should be told that is what will happen.
  const isWatchingAnotherShowtime = soldOutWatch != null && !isWatchingThisShowtime;

  const { mutate: startSoldOutWatch } = useMutation({
    mutationFn: (showtimeId: number) =>
      ShowtimesService.startSoldOutWatch({ showtimeId }),
    onMutate: async (showtimeId) => {
      await queryClient.cancelQueries({ queryKey: soldOutWatchQueryKey });
      const previous = queryClient.getQueryData(soldOutWatchQueryKey);
      queryClient.setQueryData(soldOutWatchQueryKey, {
        showtime_id: showtimeId,
        created_at: new Date().toISOString(),
      });
      return { previous };
    },
    onError: (error, _showtimeId, context) => {
      queryClient.setQueryData(soldOutWatchQueryKey, context?.previous);
      Alert.alert(
        "Error",
        (error as { body?: { detail?: string } })?.body?.detail ??
          "Could not watch this showtime for tickets."
      );
    },
    onSuccess: (watch) => queryClient.setQueryData(soldOutWatchQueryKey, watch),
  });

  const { mutate: stopSoldOutWatch } = useMutation({
    mutationFn: () => ShowtimesService.stopSoldOutWatch(),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: soldOutWatchQueryKey });
      const previous = queryClient.getQueryData(soldOutWatchQueryKey);
      queryClient.setQueryData(soldOutWatchQueryKey, null);
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(soldOutWatchQueryKey, context?.previous);
      Alert.alert("Error", "Could not stop watching this showtime.");
    },
  });

  const handleToggleSoldOutWatch = useCallback(() => {
    if (selectedShowtimeId === null) return;
    triggerSelectionHaptic();
    if (isWatchingThisShowtime) {
      stopSoldOutWatch();
      return;
    }
    startSoldOutWatch(selectedShowtimeId);
  }, [
    selectedShowtimeId,
    isWatchingThisShowtime,
    startSoldOutWatch,
    stopSoldOutWatch,
  ]);

  // ─── Seat handling ─────────────────────────────────────────────────────────
  const normalizedSeatRowDraft = seatRowDraft.trim() || null;
  const normalizedSeatNumberDraft = seatNumberDraft.trim() || null;
  const normalizedCurrentSeatRow = showtime?.viewer?.seat_row?.trim() || null;
  const normalizedCurrentSeatNumber = showtime?.viewer?.seat_number?.trim() || null;
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
  const isGoingSelected = showtime?.viewer?.going === "GOING";
  const isInterestedSelected = showtime?.viewer?.going === "INTERESTED";
  // When invited, the Not-going button is a dismiss affordance, not a status —
  // so don't render it as "selected" even if the stored status is NOT_GOING.
  const isNotGoingSelected = showtime?.viewer?.going === "NOT_GOING" && !hasInvite;
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

  useEffect(() => {
    if (!isDismissInviteDialogVisible) return;
    dismissDialogAnim.setValue(0);
    Animated.timing(dismissDialogAnim, {
      toValue: 1,
      duration: 140,
      useNativeDriver: true,
    }).start();
  }, [isDismissInviteDialogVisible, dismissDialogAnim]);

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

  const handleDismissInvitePress = () => {
    if (!onDismissInvite) return;
    triggerSelectionHaptic();
    setIsDismissInviteDialogVisible(true);
  };

  const handleCloseDismissInviteDialog = useCallback(() => {
    Animated.timing(dismissDialogAnim, {
      toValue: 0,
      duration: 120,
      useNativeDriver: true,
    }).start(() => setIsDismissInviteDialogVisible(false));
  }, [dismissDialogAnim]);

  const handleConfirmDismissInvite = () => {
    triggerSelectionHaptic();
    handleCloseDismissInviteDialog();
    onDismissInvite?.();
  };

  const handleOpenTicketLink = async () => {
    const ticketLink = showtime?.ticket_link;
    if (!ticketLink) return;
    if (showtime?.cinema?.cineville) {
      const digits = await loadCinevilleCardDigits();
      if (digits) {
        await Clipboard.setStringAsync(digits);
      }
    }
    if (await Linking.canOpenURL(ticketLink)) {
      await Linking.openURL(ticketLink);
    }
  };

  const handleGoToMoviePage = () => {
    if (!showtime) return;
    onClose();
    goToMoviePage(showtime.movie.id, showtime.cinema.id);
  };

  const handleGoToUserPage = (userId: string, name: string) => {
    onClose();
    goToUserPage(userId, name);
  };


  const handleOpenSeatDialog = () => {
    if (!showtime || isUpdatingStatus || showtime.viewer?.going !== "GOING" || isFreeSeating) return;
    setSeatRowDraft(showtime.viewer?.seat_row ?? "");
    setSeatNumberDraft(showtime.viewer?.seat_number ?? "");
    setIsSeatDialogVisible(true);
  };

  const handleSaveSeat = () => {
    if (!showtime || isUpdatingStatus || showtime.viewer?.going !== "GOING" || isFreeSeating) return;
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
    try {
      const { token } = await ShowtimesService.createShowtimePingLinkToken({
        showtimeId: showtime.id,
      });
      const pingUrl = buildShowtimePingUrl(showtime.id, token);
      await Share.share({
        message: pingUrl,
        url: pingUrl,
      });
    } catch {
      Alert.alert("Error", "Could not share invite link.");
    }
  };

  // ─── Derivations ────────────────────────────────────────────────────────────
  const friendsGoingIds = useMemo(
    () => new Set((showtime?.viewer?.friends_going ?? []).map((friend) => friend.id)),
    [showtime?.viewer?.friends_going]
  );
  const friendsInterestedIds = useMemo(
    () => new Set((showtime?.viewer?.friends_interested ?? []).map((friend) => friend.id)),
    [showtime?.viewer?.friends_interested]
  );

  const pingedReceiverIds = useMemo(
    () => new Set(sentPings.map((p) => p.receiver_id)),
    [sentPings]
  );

  const friendsWatchlisted = useMemo(
    () => showtime?.viewer?.friends_watchlisted ?? [],
    [showtime?.viewer?.friends_watchlisted]
  );
  const friendsWatched = useMemo(
    () => showtime?.viewer?.friends_watched ?? [],
    [showtime?.viewer?.friends_watched]
  );
  // Only the non-empty relationships get a marker.
  const watchMarkers = useMemo(
    () =>
      (
        [
          { kind: "watchlisted" as const, count: friendsWatchlisted.length },
          { kind: "watched" as const, count: friendsWatched.length },
        ]
      )
        .filter((entry) => entry.count > 0)
        .map((entry) => ({ ...entry, meta: getFriendWatchKindMeta(entry.kind, colors) })),
    [friendsWatchlisted.length, friendsWatched.length, colors]
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

  // Pinged wins over going/interested: a friend can be both (invites to an
  // already-selected friend are allowed now), and once invited that's the
  // state that matters — otherwise the row would show "Invite" forever for
  // exactly the friends this feature made invitable.
  const getPingAvailability = useCallback(
    (friendId: string): FriendPingAvailability =>
      pingedReceiverIds.has(friendId)
        ? "pinged"
        : friendsGoingIds.has(friendId)
          ? "going"
          : friendsInterestedIds.has(friendId)
            ? "interested"
            : "eligible",
    [friendsGoingIds, friendsInterestedIds, pingedReceiverIds]
  );

  const getPingRowStatus = (availability: FriendPingAvailability): FriendPingStatus =>
    availability === "going" ? "GOING" : availability === "interested" ? "INTERESTED" : null;

  const friendsForPing = useMemo(() => {
    const availabilityRank: Record<FriendPingAvailability, number> = {
      eligible: 0,
      pinged: 1,
      interested: 2,
      going: 3,
    };
    return (friends ?? [])
      .map((friend) => {
        const availability = getPingAvailability(friend.id);
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
  }, [friends, getPingAvailability, getWatchStatus, watchlistedIds]);

  // The list shows every friend you can still invite, including those who
  // already set a going/interested status on their own (their status shows
  // next to the button, but inviting them still works — it just won't notify
  // them); already-pinged friends live in the summary instead.
  const filteredFriendsForPing = useMemo(() => {
    const invitable = friendsForPing.filter((friend) => friend.availability !== "pinged");
    const query = pingSearchQuery.trim().toLowerCase();
    if (!query) return invitable;
    return invitable.filter((friend) => friend.label.toLowerCase().includes(query));
  }, [friendsForPing, pingSearchQuery]);

  // The top result is what Enter selects (and what we visually highlight) — the
  // list already excludes already-pinged friends, so anyone left is invitable.
  const firstEligibleFriendId = useMemo(
    () => filteredFriendsForPing[0]?.id ?? null,
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

  const coInvitedFriends = showtime?.viewer?.co_invited_friends ?? [];
  const nonFriendParticipants = showtime?.viewer?.non_friend_participants ?? [];
  const invitedByUsers = showtime?.viewer?.invited_by ?? [];
  const invitedYouLabel = hasInvite ? formatInvitedYou(invite!.senders) : null;
  const inviterNames = hasInvite ? formatInviterNames(invite!.senders) : null;

  // The "Invited" tab merges who you've invited (with their respond status),
  // who your inviter(s) also invited (your co-invitees), friends who invited
  // you directly, and non-friends from the same invite chain (with an inline
  // friend-request affordance instead of a status) — each row says who's
  // responsible for the invite, "you" taking priority when both apply.
  //
  // A row's attribution (you invited them / they invited you / a shared
  // inviter) and its friendship status are independent facts — someone you
  // invited while you were friends can unfriend you afterward and still show
  // up here, still attributed the same way, just no longer a friend. So every
  // attribution bucket below checks `nonFriendParticipantsById` for its own
  // rows instead of assuming friendship from which bucket it landed in.
  const invitedTabEntries = useMemo(() => {
    const nonFriendParticipantsById = new Map(
      nonFriendParticipants.map((entry) => [entry.user.id, entry.user])
    );
    const sentEntries = sentPings.map((ping) => ({
      key: `sent-${ping.id}`,
      userId: ping.receiver_id,
      name: ping.receiver_name,
      invitedByLabel: "Invited by you" as string | null,
      statusLabel: ping.dismissed_at ? "Dismissed" : ping.seen_at ? "Seen" : "Pending",
      statusColor: ping.dismissed_at
        ? colors.red.secondary
        : ping.seen_at
          ? colors.green.secondary
          : colors.textSecondary,
      canUninvite: true,
      nonFriendUser: nonFriendParticipantsById.get(ping.receiver_id) ?? null,
    }));
    const coInvitedEntries = coInvitedFriends.map((entry) => ({
      key: `co-${entry.friend.id}`,
      userId: entry.friend.id,
      name: entry.friend.display_name?.trim() || "Friend",
      invitedByLabel: `Invited by ${entry.inviter.display_name?.trim() || "a friend"}` as
        | string
        | null,
      statusLabel: null,
      statusColor: colors.textSecondary,
      canUninvite: false,
      nonFriendUser: nonFriendParticipantsById.get(entry.friend.id) ?? null,
    }));
    const knownIds = new Set([
      ...sentEntries.map((entry) => entry.userId),
      ...coInvitedEntries.map((entry) => entry.userId),
    ]);
    // Non-friend inviters already get a "Invited you" entry below (with a
    // friend-request affordance); this only covers the ones who invited you
    // and are already friends — invited_by has no attribution/status of its
    // own, so anyone left over here must have invited you directly.
    const friendInviterEntries = invitedByUsers
      .filter(
        (sender) => !knownIds.has(sender.id) && !nonFriendParticipantsById.has(sender.id)
      )
      .map((sender) => ({
        key: `friend-inviter-${sender.id}`,
        userId: sender.id,
        name: sender.display_name?.trim() || "Friend",
        invitedByLabel: "Invited you" as string | null,
        statusLabel: null,
        statusColor: colors.textSecondary,
        canUninvite: false,
        nonFriendUser: null as (typeof nonFriendParticipants)[number]["user"] | null,
      }));
    const nonFriendEntries = nonFriendParticipants
      .filter((entry) => !knownIds.has(entry.user.id))
      .map((entry) => ({
        key: `non-friend-${entry.user.id}`,
        userId: entry.user.id,
        name: entry.user.display_name?.trim() || "Friend",
        invitedByLabel: (entry.invited_by_you
          ? "Invited by you"
          : entry.invited_you
            ? "Invited you"
            : entry.inviter
              ? `Invited by ${entry.inviter.display_name?.trim() || "a friend"}`
              : null) as string | null,
        statusLabel: null,
        statusColor: colors.textSecondary,
        canUninvite: false,
        nonFriendUser: entry.user as (typeof nonFriendParticipants)[number]["user"] | null,
      }));
    return [...sentEntries, ...coInvitedEntries, ...friendInviterEntries, ...nonFriendEntries];
  }, [sentPings, coInvitedFriends, nonFriendParticipants, invitedByUsers, colors]);
  const showtimeStartsAt = showtime ? DateTime.fromISO(showtime.datetime) : null;
  const dateLabel = showtimeStartsAt?.isValid ? showtimeStartsAt.toFormat("cccc d LLLL") : null;
  const isSyntheticMovie = showtime ? isSyntheticMovieId(showtime.movie.id) : false;
  const durationMinutes = showtime?.movie.duration ?? null;
  const durationLabel = durationMinutes
    ? `${durationMinutes} min`
    : isSyntheticMovie
      ? `${UNKNOWN_METADATA_PLACEHOLDER} min`
      : null;
  const timeRangeLabel = showtime
    ? formatShowtimeTimeRange(showtime.datetime, showtime.end_datetime, isSyntheticMovie)
    : null;
  const timeLabel = timeRangeLabel
    ? [timeRangeLabel, durationLabel, spokenLanguage].filter(Boolean).join(" • ")
    : null;

  // The pending-invite badge itself is intentionally not shown in this modal —
  // the "Invited" section below already lists who you've invited and their
  // status — so audience visibility is based on going/interested only.
  const hasAudience =
    (showtime?.viewer?.friends_going?.length ?? 0) > 0 ||
    (showtime?.viewer?.friends_interested?.length ?? 0) > 0;

  const statusOptions = [
    {
      key: "NOT_GOING" as const,
      label: "Not going",
      icon: "cancel" as const,
      palette: colors.gray,
      selected: isNotGoingSelected,
      disabled: notGoingActsAsDismiss ? isDismissingInvite : isUpdatingStatus,
      onPress: handleNotGoingPress,
      tourTarget: null,
    },
    {
      key: "INTERESTED" as const,
      label: "Interested",
      icon: "bookmark-border" as const,
      palette: colors.orange,
      selected: isInterestedSelected,
      disabled: isUpdatingStatus,
      onPress: () => handleStatusPress("INTERESTED"),
      tourTarget: "interested" as const,
    },
    {
      key: "GOING" as const,
      label: "Going",
      icon: "check-circle" as const,
      palette: colors.green,
      selected: isGoingSelected,
      disabled: isUpdatingStatus,
      onPress: () => handleStatusPress("GOING"),
      tourTarget: "going" as const,
    },
  ];

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      // The tour drives the sheet; a tap outside must not dismiss it.
      <SheetBackdrop {...props} pressBehavior={isTour ? "none" : "close"} />
    ),
    [isTour]
  );

  return (
    <BottomSheetModal
      ref={bottomSheetModalRef}
      snapPoints={snapPoints}
      enablePanDownToClose={!isTour}
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
      {/* @gorhom/portal (used by the bottom sheet) does not forward React
          context, so re-provide the QueryClient for hooks rendered inside. */}
      <QueryClientProvider client={queryClient}>
      <CommittedShowtimeReporter
        showtimeId={selectedShowtimeId}
        onCommitted={handleContentCommitted}
      />
      <BottomSheetScrollView
        ref={scrollViewRef}
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 32 + bottomInset }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        // The tour scrolls the sheet itself, one target at a time.
        scrollEnabled={!isTour}
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
              {/* Keyed by movie: an Image whose uri changes keeps showing the
                  image it already has until the new one has loaded, which for
                  an uncached poster is the previous movie's poster. */}
              {disableMovieNavigation ? (
                isSyntheticMovie ? (
                  <PosterPlaceholder style={styles.poster} glyphSize={34} />
                ) : (
                  <Image
                    key={showtime.movie.id}
                    source={{ uri: showtime.movie.poster_link ?? undefined }}
                    style={styles.poster}
                  />
                )
              ) : (
                <TouchableOpacity onPress={handleGoToMoviePage} activeOpacity={0.85}>
                  {isSyntheticMovie ? (
                    <PosterPlaceholder style={styles.poster} glyphSize={34} />
                  ) : (
                    <Image
                      key={showtime.movie.id}
                      source={{ uri: showtime.movie.poster_link ?? undefined }}
                      style={styles.poster}
                    />
                  )}
                </TouchableOpacity>
              )}
              <View style={styles.summaryInfo}>
                <ThemedText
                  style={[
                    styles.movieTitle,
                    // The gutter exists to clear the close button; when the watch
                    // markers are there they already hold that column open.
                    watchMarkers.length > 0 && styles.movieTitleNoGutter,
                  ]}
                  numberOfLines={3}
                >
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
                    {showtime.movie.release_year ? ` · ${showtime.movie.release_year}` : null}
                  </ThemedText>
                ) : isSyntheticMovie ? (
                  <ThemedText style={styles.directorText} numberOfLines={1}>
                    <ThemedText style={styles.directorLabel}>DIRECTED BY </ThemedText>
                    {`${UNKNOWN_METADATA_PLACEHOLDER} · ${UNKNOWN_METADATA_PLACEHOLDER}`}
                  </ThemedText>
                ) : null}
                {dateLabel ? (
                  <ThemedText style={styles.dateText}>{dateLabel}</ThemedText>
                ) : null}
                {timeLabel ? (
                  <ThemedText style={styles.timeText}>{timeLabel}</ThemedText>
                ) : null}
                <View style={styles.cinemaBadgeRow}>
                  <CinemaPill
                    cinema={showtime.cinema}
                    disabledIfSameId={disabledCinemaId}
                    onNavigate={onClose}
                  />
                  <SubtitlesBadges subtitles={showtime.subtitles} />
                </View>
              </View>
              {/* Friends' Letterboxd relationship to this film — deliberately just
                  an icon + count; tapping one opens the list, which is where the
                  relationship is spelled out. Empty ones aren't shown at all.
                  Its own narrow column in the header, tucked under the close
                  button: high up where there is room to spare, and out of the
                  bottom-right corner the report link floats into. */}
              {watchMarkers.length > 0 ? (
                <View style={styles.watchMarkersColumn}>
                  {watchMarkers.map((marker) => (
                    <TouchableOpacity
                      key={marker.kind}
                      style={styles.watchMarker}
                      onPress={() => {
                        triggerSelectionHaptic();
                        setWatchModalKind(marker.kind);
                      }}
                      // Half the stack gap each, so the pills' touch areas meet
                      // without overlapping — the pill itself is only ~21pt tall.
                      hitSlop={{
                        top: WATCH_MARKER_GAP / 2,
                        bottom: WATCH_MARKER_GAP / 2,
                        left: 8,
                        right: 8,
                      }}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`${marker.meta.title} by ${marker.count} friend${
                        marker.count === 1 ? "" : "s"
                      }`}
                    >
                      <MaterialIcons name={marker.meta.icon} size={13} color={marker.meta.accent} />
                      <ThemedText style={styles.watchMarkerCount}>{marker.count}</ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
              <TouchableOpacity
                style={styles.closeButton}
                onPress={onClose}
                hitSlop={8}
                activeOpacity={0.7}
              >
                <MaterialIcons name="close" size={18} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Friends going / interested, with the report link anchored just
                above its top divider — absolutely positioned so it doesn't
                claim any extra vertical space in the layout. */}
            {isSignedIn ? (
            <View style={[styles.audienceBox, !hasAudience && styles.audienceBoxEmpty]}>
              {canReport && (
                <TouchableOpacity
                  style={styles.reportLink}
                  onPress={() => setIsReportDialogVisible(true)}
                  hitSlop={8}
                  activeOpacity={0.6}
                >
                  <MaterialIcons name="flag" size={11} color={colors.textSecondary} />
                  <ThemedText style={styles.reportLinkText}>Report</ThemedText>
                </TouchableOpacity>
              )}
              {hasAudience ? (
                <FriendBadges
                  friendsGoing={showtime.viewer?.friends_going}
                  friendsInterested={showtime.viewer?.friends_interested}
                  variant="default"
                  maxVisible={30}
                  disabledUserId={disabledUserId}
                  onNavigate={onClose}
                />
              ) : (
                <ThemedText style={styles.audienceEmptyText}>
                  No friends are interested in this showtime yet.
                </ThemedText>
              )}
            </View>
            ) : null}

            {/* Optional "X invited you." banner */}
            {invitedYouLabel ? (
              <View style={styles.invitedYouBannerWrap}>
                <View style={styles.invitedYouBanner}>
                  <MaterialIcons name="mail-outline" size={16} color={colors.blue.secondary} />
                  <ThemedText style={styles.invitedYouText}>{invitedYouLabel}</ThemedText>
                  {onDismissInvite ? (
                    <TouchableOpacity
                      onPress={handleDismissInvitePress}
                      disabled={isDismissingInvite}
                      hitSlop={8}
                      activeOpacity={0.7}
                    >
                      <MaterialIcons name="close" size={18} color={colors.blue.secondary} />
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Status buttons: Not going | Interested | Going */}
            <View style={styles.statusRow}>
              {statusOptions.map((option) => (
                <TouchableOpacity
                  key={option.key}
                  ref={(node) => {
                    if (!option.tourTarget) return;
                    tourTargetRefs.current[option.tourTarget] = node;
                  }}
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
                    size={20}
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

            {/* Actions: Get Ticket (+ Seat) — Share moved down next to Invite friends */}
            <View style={styles.ctaRow}>
              {!disableMovieNavigation ? (
                <TouchableOpacity
                  style={styles.ctaIconButton}
                  onPress={handleGoToMoviePage}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="info-outline" size={18} color={colors.textSecondary} />
                  <ThemedText style={styles.ctaIconButtonText} numberOfLines={1}>
                    Movie info
                  </ThemedText>
                </TouchableOpacity>
              ) : null}
              {hasTicketLink ? (
                <TouchableOpacity
                  style={styles.ctaIconButton}
                  onPress={handleOpenTicketLink}
                  activeOpacity={0.85}
                >
                  <MaterialIcons name="local-activity" size={18} color={colors.textSecondary} />
                  <ThemedText style={styles.ctaIconButtonText} numberOfLines={1}>
                    Get ticket
                  </ThemedText>
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
                    size={18}
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

            {/* How busy this screening is. Nothing renders at all when we have
                no usable reading — a row of dashes where a real answer
                sometimes appears is worse than the answer simply not being
                there. Tapping opens the numbers behind the icon: a level is
                what you glance at, "31 of 312 left, checked 4 minutes ago" is
                what you check before buying. */}
            {isCheckingSeatAvailability ? (
              <View style={styles.seatInfoSection}>
                <View style={styles.seatInfoHeader}>
                  <ThemedText style={styles.seatInfoHeaderLabel}>Availability</ThemedText>
                  <View style={styles.seatInfoCheckingRow}>
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                    <ThemedText style={styles.seatInfoCheckingText}>
                      Checking availability…
                    </ThemedText>
                  </View>
                </View>
              </View>
            ) : null}

            {seatAvailability && seatMeta ? (
              <View style={styles.seatInfoSection}>
                <TouchableOpacity
                  style={styles.seatInfoHeader}
                  onPress={handleToggleSeatInfoExpanded}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                >
                  <ThemedText style={styles.seatInfoHeaderLabel}>Availability</ThemedText>
                  <View style={[styles.seatInfoValue, { backgroundColor: seatMeta.color }]}>
                    <MaterialIcons
                      name={seatMeta.icon}
                      size={13}
                      color={colors.pillActiveText}
                    />
                    <ThemedText style={styles.seatInfoValueText}>{seatMeta.label}</ThemedText>
                  </View>
                  <Animated.View style={{ transform: [{ rotate: seatInfoCaretSpin }] }}>
                    <MaterialIcons name="expand-more" size={20} color={colors.textSecondary} />
                  </Animated.View>
                </TouchableOpacity>
                {isSeatInfoExpanded ? (
                  <View style={styles.seatInfoDetail}>
                    <ThemedText style={styles.seatInfoDescription}>
                      {seatMeta.description}
                    </ThemedText>
                    {seatCountLabel ? (
                      <ThemedText style={styles.seatInfoCount}>{seatCountLabel}</ThemedText>
                    ) : null}
                    {seatCheckedLabel ? (
                      <ThemedText style={styles.seatInfoCheckedAt}>
                        {seatCheckedLabel}
                      </ThemedText>
                    ) : null}
                    {isSignedIn && canWatchSoldOut && seatAvailability.watchable ? (
                      <>
                        <TouchableOpacity
                          style={[
                            styles.seatWatchButton,
                            isWatchingThisShowtime && styles.seatWatchButtonActive,
                          ]}
                          onPress={handleToggleSoldOutWatch}
                          activeOpacity={0.8}
                          accessibilityRole="button"
                        >
                          <MaterialIcons
                            name={
                              isWatchingThisShowtime
                                ? "notifications-active"
                                : "notifications-none"
                            }
                            size={16}
                            color={
                              isWatchingThisShowtime
                                ? colors.green.secondary
                                : colors.textSecondary
                            }
                          />
                          <ThemedText
                            style={[
                              styles.seatWatchButtonText,
                              isWatchingThisShowtime && styles.seatWatchButtonTextActive,
                            ]}
                          >
                            {isWatchingThisShowtime
                              ? "Watching for tickets"
                              : "Tell me if a ticket frees up"}
                          </ThemedText>
                        </TouchableOpacity>
                        {isWatchingAnotherShowtime ? (
                          <ThemedText style={styles.seatWatchHint}>
                            You&apos;re watching another showtime — this replaces it.
                          </ThemedText>
                        ) : null}
                      </>
                    ) : null}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* What an account would add here, in place of the four sections a
                guest doesn't get. One line rather than a panel: the sheet is
                about this screening, not about signing up. */}
            {!isSignedIn ? (
              <TouchableOpacity
                style={styles.signInPrompt}
                onPress={() => {
                  triggerSelectionHaptic();
                  promptForAccount("invite");
                }}
                activeOpacity={0.7}
                accessibilityRole="button"
              >
                <MaterialIcons name="mail-outline" size={16} color={colors.blue.secondary} />
                <ThemedText style={styles.signInPromptText}>
                  Log in to invite friends
                </ThemedText>
                <MaterialIcons name="arrow-forward" size={14} color={colors.blue.secondary} />
              </TouchableOpacity>
            ) : null}

            {/* Who can see your status for this showtime — inline dropdown.
                The section (and its header height) renders as soon as the showtime
                does, even before the visibility query resolves, with a skeleton
                badge in place of the real one — otherwise the row pops in once the
                fetch lands and visibly shifts everything below it (worse on Android). */}
            {isSignedIn ? (
            <View style={styles.visibilitySection}>
              <TouchableOpacity
                style={styles.visibilityHeader}
                onPress={handleToggleVisibilityExpanded}
                activeOpacity={0.8}
                disabled={!visibilityMeta}
              >
                <ThemedText style={styles.visibilityHeaderLabel}>Status visible to</ThemedText>
                {visibilityMeta ? (
                  <View style={[styles.visibilityValue, { backgroundColor: visibilityMeta.color }]}>
                    <MaterialIcons name={visibilityMeta.icon} size={13} color={colors.pillActiveText} />
                    <ThemedText style={styles.visibilityValueText}>{visibilityMeta.label}</ThemedText>
                  </View>
                ) : (
                  <Skeleton style={[styles.visibilityValue, styles.visibilityValueSkeleton]} />
                )}
                <Animated.View style={{ transform: [{ rotate: visibilityCaretSpin }] }}>
                  <MaterialIcons name="expand-more" size={20} color={colors.textSecondary} />
                </Animated.View>
              </TouchableOpacity>
              {visibility && isVisibilityExpanded ? (
                <View style={styles.visibilityOptions}>
                  {VISIBILITY_MODE_ORDER.map((mode) => {
                    const optionMeta = getVisibilityModeMeta(mode, colors);
                    const isSelected = mode === visibility.mode;
                    return (
                      <TouchableOpacity
                        key={mode}
                        style={[
                          styles.visibilityOption,
                          isSelected && { borderColor: optionMeta.color, backgroundColor: colors.surfaceMuted },
                        ]}
                        onPress={() => void handleVisibilityModeSelect(mode)}
                        activeOpacity={0.8}
                      >
                        <View style={[styles.visibilityOptionIcon, { backgroundColor: optionMeta.color }]}>
                          <MaterialIcons name={optionMeta.icon} size={15} color={colors.pillActiveText} />
                        </View>
                        <View style={styles.visibilityOptionText}>
                          <ThemedText style={styles.visibilityOptionLabel}>{optionMeta.label}</ThemedText>
                          <ThemedText style={styles.visibilityOptionDescription}>
                            {optionMeta.description}
                          </ThemedText>
                        </View>
                        <MaterialIcons
                          name={isSelected ? "radio-button-checked" : "radio-button-unchecked"}
                          size={20}
                          color={isSelected ? optionMeta.color : colors.textSecondary}
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </View>
            ) : null}

            {/* Who you've invited */}
            {isSignedIn ? (
            <View
              style={styles.invitedSection}
              onLayout={(event) => {
                invitedSectionYRef.current = event.nativeEvent.layout.y;
              }}
            >
              <ThemedText style={styles.sectionLabel}>Invited</ThemedText>
              {invitedTabEntries.length === 0 ? (
                <ThemedText style={styles.invitedEmptyText}>
                  You haven&apos;t invited anyone yet.
                </ThemedText>
              ) : (
                <View style={styles.invitedList}>
                  {invitedTabEntries.map((entry) => {
                    const avatarColors = getAvatarColors(entry.userId, colors);
                    return (
                      <TouchableOpacity
                        key={entry.key}
                        style={styles.invitedRow}
                        onPress={() => handleGoToUserPage(entry.userId, entry.name)}
                        activeOpacity={0.7}
                      >
                        <View
                          style={[
                            styles.invitedRowAvatar,
                            { backgroundColor: avatarColors.primary },
                          ]}
                        >
                          <ThemedText
                            style={[styles.invitedRowAvatarText, { color: avatarColors.secondary }]}
                          >
                            {getAvatarInitial(entry.name)}
                          </ThemedText>
                        </View>
                        <View style={styles.invitedRowTextCol}>
                          <ThemedText style={styles.invitedRowName} numberOfLines={1}>
                            {entry.name}
                          </ThemedText>
                          {entry.invitedByLabel ? (
                            <ThemedText style={styles.invitedRowAttribution} numberOfLines={1}>
                              {entry.invitedByLabel}
                            </ThemedText>
                          ) : null}
                        </View>
                        {entry.statusLabel ? (
                          <ThemedText
                            style={[styles.invitedRowStatus, { color: entry.statusColor }]}
                          >
                            {entry.statusLabel}
                          </ThemedText>
                        ) : null}
                        {entry.nonFriendUser ? (
                          <InlineFriendRequestButtons user={entry.nonFriendUser} />
                        ) : null}
                        {entry.canUninvite ? (
                          <TouchableOpacity
                            style={styles.uninviteButton}
                            onPress={(event) => {
                              event.stopPropagation();
                              if (!showtime) return;
                              uninviteFriend({ showtimeId: showtime.id, friendId: entry.userId });
                            }}
                            disabled={isUninviting}
                            hitSlop={6}
                            activeOpacity={0.6}
                          >
                            <MaterialIcons name="close" size={14} color={colors.textSecondary} />
                          </TouchableOpacity>
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
            ) : null}

            {/* Share (always one tap, no expand) + Invite friends (collapsible, blue invite coding) */}
            {isSignedIn ? (
            <View style={styles.inviteBarRow}>
              <TouchableOpacity
                style={styles.shareButton}
                onPress={() => void handleSharePingLink()}
                disabled={!currentUser?.id}
                activeOpacity={0.85}
              >
                <MaterialIcons name="share" size={16} color={colors.blue.secondary} />
                <ThemedText style={styles.shareButtonText}>Share</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                ref={(node) => {
                  tourTargetRefs.current.invite = node;
                }}
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
            </View>
            ) : null}

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
                          const isHighlighted =
                            friend.id === firstEligibleFriendId &&
                            pingSearchQuery.trim().length > 0;
                          return (
                            <FriendListRow
                              key={friend.id}
                              userId={friend.id}
                              name={friend.label}
                              watchStatus={friend.watchStatus}
                              pingStatus={getPingRowStatus(friend.availability)}
                              mode="invite"
                              highlighted={isHighlighted}
                              disabled={isPingingFriend}
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

      {/* Report an issue with this showtime */}
      <Modal
        transparent
        statusBarTranslucent
        visible={isReportDialogVisible}
        animationType="fade"
        onRequestClose={() => setIsReportDialogVisible(false)}
      >
        <View style={styles.seatDialogBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setIsReportDialogVisible(false)}
          />
          <View style={styles.seatDialogCard}>
            <ThemedText style={styles.seatDialogTitle}>Report an issue</ThemedText>
            <ThemedText style={styles.reportDialogSubtitle}>
              What&apos;s wrong with this showtime?
            </ThemedText>
            <View style={styles.reportReasonList}>
              {REPORT_REASON_OPTIONS.map((option) => (
                <TouchableOpacity
                  key={option.value}
                  style={styles.reportReasonOption}
                  onPress={() => handleSubmitReport(option.value)}
                  disabled={isSubmittingReport}
                  activeOpacity={0.7}
                >
                  <ThemedText style={styles.reportReasonOptionText}>{option.label}</ThemedText>
                  <MaterialIcons name="chevron-right" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.reportCancelButton}
              onPress={() => setIsReportDialogVisible(false)}
              activeOpacity={0.8}
            >
              <ThemedText style={styles.reportCancelButtonText}>Cancel</ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Friends who watchlisted / watched this film. The rows drop the per-friend
          watch icon — the popup as a whole already says which list this is. */}
      <FriendWatchListModal
        kind={watchModalKind}
        friends={watchModalKind === "watched" ? friendsWatched : friendsWatchlisted}
        onClose={() => setWatchModalKind(null)}
        onNavigate={onClose}
        invite={{
          getState: (friendId) => {
            const availability = getPingAvailability(friendId);
            return {
              pingStatus: getPingRowStatus(availability),
              invited: availability === "pinged",
              disabled: isPingingFriend,
            };
          },
          onInvite: handlePingFriend,
        }}
      />

      {/* Confirm dismissing an invite */}
      <Modal
        transparent
        statusBarTranslucent
        visible={isDismissInviteDialogVisible}
        animationType="none"
        onRequestClose={handleCloseDismissInviteDialog}
      >
        <Animated.View style={[styles.seatDialogBackdrop, { opacity: dismissDialogAnim }]}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={handleCloseDismissInviteDialog}
          />
          <Animated.View
            style={[styles.confirmDialogCard, { transform: [{ scale: dismissDialogScale }] }]}
          >
            <View style={styles.confirmDialogIconCircle}>
              <MaterialIcons name="mail-outline" size={20} color={colors.red.secondary} />
            </View>
            <ThemedText style={styles.confirmDialogTitle}>Dismiss invite?</ThemedText>
            <ThemedText style={styles.confirmDialogMessage}>
              {inviterNames
                ? `The invite from ${inviterNames} will be removed from your list. You can still find this showtime yourself.`
                : "This invite will be removed from your list. You can still find this showtime yourself."}
            </ThemedText>
            <View style={styles.confirmDialogActions}>
              <TouchableOpacity
                style={[styles.confirmDialogButton, styles.confirmDialogCancelButton]}
                onPress={handleCloseDismissInviteDialog}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.confirmDialogCancelText}>Keep</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.confirmDialogButton, styles.confirmDialogDestructiveButton]}
                onPress={handleConfirmDismissInvite}
                activeOpacity={0.8}
              >
                <ThemedText style={styles.confirmDialogDestructiveText}>Dismiss</ThemedText>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </Animated.View>
      </Modal>

      <InviteBeforePrivateDialog
        visible={isInviteBeforePrivateVisible}
        friends={inviteBeforePrivateCandidates}
        onConfirm={handleInviteBeforePrivateConfirm}
        onSkip={handleInviteBeforePrivateSkip}
      />
      </QueryClientProvider>
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
    scrollContent: { paddingHorizontal: 20, paddingTop: 0, paddingBottom: 32, gap: 11, flexGrow: 1 },

    loadingState: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
    loadingErrorText: { fontSize: 14, color: colors.textSecondary },

    summaryRow: { flexDirection: "row", gap: 12 },
    poster: {
      width: 84,
      height: 126,
      borderRadius: 8,
      backgroundColor: colors.posterPlaceholder,
    },
    // `minWidth: 0` so a long unbroken title or director credit shrinks and
    // ellipsises instead of pushing the watch-marker column out of the row.
    summaryInfo: { flex: 1, minWidth: 0, gap: 1 },
    movieTitle: {
      fontSize: 19,
      lineHeight: 22,
      fontWeight: "800",
      color: colors.text,
      paddingRight: 36,
    },
    movieTitleNoGutter: { paddingRight: 0 },
    originalTitle: {
      fontSize: 12,
      lineHeight: 14,
      color: colors.textSecondary,
      fontStyle: "italic",
      marginTop: 0,
    },
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
      backgroundColor: colors.surfaceMuted,
    },

    audienceBox: {
      position: "relative",
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
    reportLink: {
      position: "absolute",
      top: -21,
      right: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 3,
      paddingVertical: 1,
      paddingHorizontal: 4,
    },
    reportLinkText: {
      fontSize: 10.5,
      fontWeight: "600",
      color: colors.textSecondary,
      opacity: 0.8,
    },

    // `paddingTop` clears the close button, which is absolutely positioned over
    // this same column. `alignSelf` keeps the stack from being stretched to the
    // poster's full height by the row.
    watchMarkersColumn: {
      alignSelf: "flex-start",
      alignItems: "flex-end",
      gap: WATCH_MARKER_GAP,
      paddingTop: CLOSE_BUTTON_TOP + CLOSE_BUTTON_SIZE + WATCH_MARKER_GAP,
      // Never gives up width to the text column beside it: the pills are the
      // whole point of the column, and half a pill is worse than a truncated
      // director credit.
      flexShrink: 0,
    },
    // Neutral pill; only the icon carries the watchlisted/watched colour, so the
    // markers read as a quiet aside next to the title rather than a call to act.
    // Fill only, no border — one separation cue is enough at this size, and it
    // matches the movie page's chips. `minWidth` keeps a 1-digit and a 2-digit
    // count the same width so the stack has one straight edge, not a ragged one.
    watchMarker: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 4,
      minWidth: 42,
      borderRadius: 999,
      paddingHorizontal: 7,
      paddingVertical: 3,
      backgroundColor: colors.surfaceMuted,
    },
    watchMarkerCount: { fontSize: 11, fontWeight: "600", color: colors.textSecondary },

    invitedYouBannerWrap: {
      borderRadius: 12,
      backgroundColor: colors.blue.primary,
      overflow: "hidden",
    },
    invitedYouBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    invitedYouText: { flex: 1, fontSize: 13, fontWeight: "600", color: colors.text },

    statusRow: { flexDirection: "row", gap: 8 },
    statusButton: {
      flex: 1,
      gap: 1,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.pillBackground,
      paddingTop: 8,
      paddingBottom: 5,
      alignItems: "center",
      justifyContent: "center",
    },
    statusButtonSelected: {
      shadowOpacity: 0.2,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    statusButtonText: { fontSize: 12, fontWeight: "700", color: colors.textSecondary },

    visibilitySection: {
      gap: 8,
    },
    visibilityHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 4,
      paddingHorizontal: 2,
    },
    visibilityHeaderLabel: {
      flex: 1,
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    visibilityValue: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderRadius: 8,
      paddingVertical: 3,
      paddingHorizontal: 8,
    },
    visibilityValueSkeleton: {
      width: 78,
      height: 19,
      backgroundColor: colors.surfaceMuted,
    },
    visibilityValueText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.pillActiveText,
    },
    visibilityOptions: {
      gap: 8,
    },

    seatInfoSection: {
      gap: 8,
    },
    seatInfoHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 4,
      paddingHorizontal: 2,
    },
    seatInfoHeaderLabel: {
      flex: 1,
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    seatInfoValue: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      borderRadius: 8,
      paddingVertical: 3,
      paddingHorizontal: 8,
    },
    seatInfoCheckingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    seatInfoCheckingText: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    seatInfoValueText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.pillActiveText,
    },
    seatInfoDetail: {
      gap: 4,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingVertical: 10,
      paddingHorizontal: 12,
    },
    seatInfoDescription: {
      fontSize: 13,
      color: colors.text,
    },
    seatInfoCount: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.text,
    },
    seatInfoCheckedAt: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    seatWatchButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      marginTop: 6,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.surfaceMuted,
      paddingVertical: 9,
      paddingHorizontal: 12,
    },
    seatWatchButtonActive: {
      borderColor: colors.green.border,
      backgroundColor: colors.green.primary,
    },
    seatWatchButtonText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.textSecondary,
    },
    seatWatchButtonTextActive: {
      color: colors.green.secondary,
    },
    seatWatchHint: {
      fontSize: 12,
      color: colors.textSecondary,
      textAlign: "center",
    },
    visibilityOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderRadius: 11,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingVertical: 9,
      paddingHorizontal: 12,
    },
    visibilityOptionIcon: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: "center",
      justifyContent: "center",
    },
    visibilityOptionText: {
      flex: 1,
      gap: 2,
    },
    visibilityOptionLabel: {
      fontSize: 14,
      fontWeight: "700",
      color: colors.text,
    },
    visibilityOptionDescription: {
      fontSize: 12,
      color: colors.textSecondary,
    },
    ctaRow: { flexDirection: "row", gap: 8 },
    ctaIconButton: {
      // flex: 1 (same as statusButton) so however many of these three render,
      // they split the row evenly, keeping "All showtimes" the exact same
      // width as "Not going" above it rather than sizing to its own label.
      flex: 1,
      gap: 1,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      paddingTop: 8,
      paddingBottom: 4,
      paddingHorizontal: 14,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.cardBackground,
    },
    ctaIconButtonText: { fontSize: 11, fontWeight: "700", color: colors.textSecondary, textAlign: "center" },
    seatButtonSet: { borderColor: colors.green.border, backgroundColor: colors.green.primary },
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
    invitedRowAvatar: {
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: "center",
      justifyContent: "center",
    },
    invitedRowAvatarText: { fontSize: 11, fontWeight: "700", lineHeight: 14 },
    invitedRowTextCol: { flex: 1, gap: 1 },
    invitedRowName: { fontSize: 13, fontWeight: "500", color: colors.text },
    invitedRowAttribution: { fontSize: 11, color: colors.textSecondary },
    invitedRowStatus: { fontSize: 11, fontWeight: "600" },
    uninviteButton: {
      padding: 2,
      borderRadius: 4,
    },

    inviteBarRow: { flexDirection: "row", gap: 8 },
    signInPrompt: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      marginTop: 14,
      paddingVertical: 11,
      borderRadius: 12,
      backgroundColor: colors.blue.primary,
    },
    signInPromptText: { fontSize: 13, fontWeight: "700", color: colors.blue.secondary },
    shareButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 5,
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: colors.blue.primary,
    },
    shareButtonText: { fontSize: 13, fontWeight: "700", color: colors.blue.secondary },
    inviteToggle: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 9,
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

    reportDialogSubtitle: { fontSize: 13, color: colors.textSecondary, marginTop: -4 },
    reportReasonList: { gap: 2 },
    reportReasonOption: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      borderRadius: 9,
      paddingVertical: 11,
      paddingHorizontal: 10,
    },
    reportReasonOptionText: { fontSize: 14, fontWeight: "600", color: colors.text },
    reportCancelButton: {
      minHeight: 38,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.pillBackground,
      borderWidth: 1,
      borderColor: colors.pillBorder,
    },
    reportCancelButtonText: { fontSize: 13, fontWeight: "700", color: colors.textSecondary },

    confirmDialogCard: {
      width: "100%",
      maxWidth: 320,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: colors.cardBorder,
      backgroundColor: colors.cardBackground,
      paddingHorizontal: 20,
      paddingTop: 18,
      paddingBottom: 14,
      alignItems: "center",
      gap: 8,
      shadowColor: "#000",
      shadowOpacity: 0.2,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 10,
    },
    confirmDialogIconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.red.primary,
      marginBottom: 2,
    },
    confirmDialogTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
    confirmDialogMessage: {
      fontSize: 13,
      lineHeight: 18,
      textAlign: "center",
      color: colors.textSecondary,
    },
    confirmDialogActions: { flexDirection: "row", gap: 8, alignSelf: "stretch", marginTop: 8 },
    confirmDialogButton: {
      flex: 1,
      minHeight: 42,
      borderRadius: 12,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    confirmDialogCancelButton: {
      backgroundColor: colors.pillBackground,
      borderColor: colors.cardBorder,
    },
    confirmDialogCancelText: { fontSize: 14, fontWeight: "700", color: colors.text },
    confirmDialogDestructiveButton: {
      backgroundColor: colors.red.primary,
      borderColor: colors.red.secondary,
    },
    confirmDialogDestructiveText: { fontSize: 14, fontWeight: "700", color: colors.red.secondary },
  });
