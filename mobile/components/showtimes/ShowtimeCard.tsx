/**
 * Mobile showtimes feature component: Showtime Card.
 */
import { Image, Platform, StyleSheet, TouchableOpacity, View } from "react-native";
import { memo, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { useRouter } from "expo-router";
import type { ShowtimePublic } from "shared";

import { ThemedText } from "@/components/themed-text";
import CinemaPill from "@/components/badges/CinemaPill";
import SeatAvailabilityBadge from "@/components/badges/SeatAvailabilityBadge";
import SubtitlesBadges from "@/components/badges/SubtitlesBadges";
import FriendBadges from "@/components/badges/FriendBadges";
import { createShowtimeStatusGlowStyles } from "@/components/showtimes/showtime-glow";
import PosterPlaceholder from "@/components/ui/PosterPlaceholder";
import { isSyntheticMovieId } from "@/constants/synthetic-movies";
import { useThemeColors } from "@/hooks/use-theme-color";
import { useSingleFireNavigation } from "@/hooks/useSingleFireNavigation";
import {
  GLOBAL_LONG_PRESS_DELAY_MS,
  triggerLongPressHaptic,
} from "@/utils/long-press";

type ShowtimeCardProps = {
  showtime: ShowtimePublic;
  onPress?: (showtime: ShowtimePublic) => void;
  onLongPress?: (showtime: ShowtimePublic) => void;
};

const POSTER_HEIGHT = 112;
const CARD_GAP = 16;
/**
 * What one row of the showtimes feed occupies, top to top. Fixed, because the
 * card is: the poster sets its height and nothing inside can push it taller.
 * Exported so a list can work out how many rows a screen holds without
 * measuring one first — see `SHOWTIMES_FIRST_PAGE_LIMIT`.
 */
export const SHOWTIME_ROW_HEIGHT = POSTER_HEIGHT + CARD_GAP;
const COMPACT_BADGE_ROW_HEIGHT = 14;
const COMPACT_BADGE_ROW_GAP = 2;
const COMPACT_BADGE_TOP_PADDING = 2;
const MAX_COMPACT_BADGE_ROWS = 4;
/**
 * The date column stacks four lines (~93pt) inside a fixed {@link POSTER_HEIGHT}
 * card, so it has ~1.2x of headroom before the text starts clipping.
 */
const DATE_COLUMN_MAX_FONT_SCALE = 1.2;

const getCompactBadgeRowsForHeight = (height: number) => {
  const normalizedHeight = Math.max(0, height);
  const rows = Math.floor(
    (normalizedHeight + COMPACT_BADGE_ROW_GAP) /
      (COMPACT_BADGE_ROW_HEIGHT + COMPACT_BADGE_ROW_GAP)
  );
  return Math.max(1, Math.min(MAX_COMPACT_BADGE_ROWS, rows));
};

function ShowtimeCard({ showtime, onPress, onLongPress }: ShowtimeCardProps) {
  // Read flow: props/state setup first, then helper handlers, then returned JSX.
  const router = useRouter();
  const goToMovie = useSingleFireNavigation((movieId: number) => router.push(`/movie/${movieId}`));
  const suppressNextPressRef = useRef(false);
  const [friendBadgeAreaHeight, setFriendBadgeAreaHeight] = useState(0);
  // Read the active theme color tokens used by this screen/component.
  const colors = useThemeColors();
  // Memoised, unlike most of the app's components: this one is rendered once
  // per row of a feed, and `createStyles` builds some thirty style objects
  // through `StyleSheet.create`. Thirty times twenty, on every render of the
  // screen, is most of what made switching to a loaded tab take a moment.
  const styles = useMemo(() => createStyles(colors), [colors]);
  const date = DateTime.fromISO(showtime.datetime);
  const originalTitle =
    showtime.movie.original_title &&
    showtime.movie.original_title.trim() !== showtime.movie.title.trim()
      ? showtime.movie.original_title.trim()
      : null;
  const weekday = date.toFormat("ccc");
  const day = date.toFormat("d");
  const month = date.toFormat("LLL");
  const startTime = date.toFormat("HH:mm");
  const isSyntheticMovie = isSyntheticMovieId(showtime.movie.id);
  // Everything below is about the person looking at the card, so it is absent
  // for a guest — the card then draws in its plain, unannotated state.
  const viewer = showtime.viewer;
  // Invited-only = you've been invited but haven't responded yet → blue.
  // Going / interested take precedence over the invite tint.
  const isInvitedOnly =
    (viewer?.invited_by?.length ?? 0) > 0 && viewer?.going === "NOT_GOING";
  const cardStatusStyle =
    viewer?.going === "GOING"
      ? styles.cardGoing
      : viewer?.going === "INTERESTED"
        ? styles.cardInterested
        : isInvitedOnly
          ? styles.cardInvited
          : undefined;
  const cardGlowStyle =
    viewer?.going === "GOING"
      ? styles.cardGlowGoing
      : viewer?.going === "INTERESTED"
        ? styles.cardGlowInterested
        : undefined;
  const dateColumnStatusStyle =
    viewer?.going === "GOING"
      ? styles.dateColumnGoing
      : viewer?.going === "INTERESTED"
        ? styles.dateColumnInterested
        : isInvitedOnly
          ? styles.dateColumnInvited
          : undefined;
  const hasAudience =
    (viewer?.friends_going?.length ?? 0) > 0 ||
    (viewer?.friends_interested?.length ?? 0) > 0 ||
    (viewer?.pending_invited_friends?.length ?? 0) > 0 ||
    (viewer?.friends_of_friends_going?.length ?? 0) > 0 ||
    (viewer?.friends_of_friends_interested?.length ?? 0) > 0;
  const responsiveBadgeRows = useMemo(() => {
    if (!hasAudience) return undefined;
    return getCompactBadgeRowsForHeight(friendBadgeAreaHeight - COMPACT_BADGE_TOP_PADDING);
  }, [friendBadgeAreaHeight, hasAudience]);

  // Handle press behavior for this module.
  const handlePress = () => {
    if (suppressNextPressRef.current) {
      suppressNextPressRef.current = false;
      return;
    }
    if (onPress) {
      onPress(showtime);
      return;
    }
    goToMovie(showtime.movie.id);
  };

  const handleLongPress = () => {
    if (!onLongPress) return;
    suppressNextPressRef.current = true;
    triggerLongPressHaptic();
    onLongPress(showtime);
  };

  const handlePressOut = () => {
    if (!suppressNextPressRef.current) return;
    // Clear right after the current gesture cycle to avoid slowing the next tap.
    requestAnimationFrame(() => {
      suppressNextPressRef.current = false;
    });
  };

  // Render/output using the state and derived values prepared above.
  return (
    <View style={[styles.cardGlow, cardGlowStyle]}>
      <TouchableOpacity
        style={[styles.card, cardStatusStyle]}
        onPress={handlePress}
        onLongPress={onLongPress ? handleLongPress : undefined}
        delayLongPress={GLOBAL_LONG_PRESS_DELAY_MS}
        onPressOut={onLongPress ? handlePressOut : undefined}
        activeOpacity={0.8}
      >
        {/* The card is a fixed POSTER_HEIGHT tall (the poster fills it), so this
            column can't grow: cap font scaling here or the four stacked lines
            clip at the OS's larger text sizes. */}
        <View style={[styles.dateColumn, dateColumnStatusStyle]}>
          <ThemedText style={styles.weekday} maxFontSizeMultiplier={DATE_COLUMN_MAX_FONT_SCALE}>
            {weekday}
          </ThemedText>
          <ThemedText style={styles.day} maxFontSizeMultiplier={DATE_COLUMN_MAX_FONT_SCALE}>
            {day}
          </ThemedText>
          <ThemedText style={styles.month} maxFontSizeMultiplier={DATE_COLUMN_MAX_FONT_SCALE}>
            {month}
          </ThemedText>
          <ThemedText style={styles.time} maxFontSizeMultiplier={DATE_COLUMN_MAX_FONT_SCALE}>
            {startTime}
          </ThemedText>
        </View>
        {isSyntheticMovie ? (
          <PosterPlaceholder style={styles.poster} glyphSize={28} />
        ) : (
          <Image source={{ uri: showtime.movie.poster_link ?? undefined }} style={styles.poster} />
        )}
        <View style={styles.info}>
          <View style={styles.titleRow}>
            <View style={styles.titleColumn}>
              <ThemedText
                style={styles.title}
                numberOfLines={originalTitle ? 1 : 2}
                ellipsizeMode="tail"
              >
                {showtime.movie.title}
              </ThemedText>
              {originalTitle ? (
                <ThemedText style={styles.originalTitle} numberOfLines={1} ellipsizeMode="tail">
                  {originalTitle}
                </ThemedText>
              ) : null}
            </View>
            <CinemaPill cinema={showtime.cinema} variant="compact" />
          </View>
          <View
            style={styles.friendBadgeArea}
            onLayout={(event) => {
              const nextHeight = Math.floor(event.nativeEvent.layout.height);
              if (nextHeight === friendBadgeAreaHeight) return;
              setFriendBadgeAreaHeight(nextHeight);
            }}
          >
            {/* No `onAddFriend`: the feed shows who's around, it doesn't act —
                the "+" lives on the movie page and in the showtime sheet. */}
            <FriendBadges
              friendsGoing={viewer?.friends_going}
              friendsInterested={viewer?.friends_interested}
              friendsPending={viewer?.pending_invited_friends}
              friendsOfFriendsGoing={viewer?.friends_of_friends_going}
              friendsOfFriendsInterested={viewer?.friends_of_friends_interested}
              variant="compact"
              maxRows={responsiveBadgeRows}
            />
          </View>
          <View style={styles.seatAvailabilityCorner}>
            <SeatAvailabilityBadge showtimeId={showtime.id} variant="compact" />
          </View>
          <View style={styles.subtitlesCorner}>
            <SubtitlesBadges subtitles={showtime.subtitles} variant="compact" />
          </View>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const createStyles = (colors: typeof import("@/constants/theme").Colors.light) => {
  const glowStyles = createShowtimeStatusGlowStyles(colors);
  return StyleSheet.create({
    cardGlow: {
      marginBottom: CARD_GAP,
      borderRadius: 12,
      backgroundColor: colors.cardBackground,
    },
    cardGlowGoing: glowStyles.going,
    cardGlowInterested: glowStyles.interested,
    card: {
      flexDirection: "row",
      backgroundColor: colors.cardBackground,
      borderRadius: 12,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: colors.cardBorder,
      height: POSTER_HEIGHT,
    },
    // Status outlines take each accent's `border` tone, not its `secondary`: the
    // label tone is dark enough to make a whole tinted card read as heavy.
    cardGoing: {
      borderColor: colors.green.border,
      backgroundColor: colors.green.primary,
    },
    cardInterested: {
      borderColor: colors.orange.border,
      backgroundColor: colors.orange.primary,
    },
    cardInvited: {
      borderColor: colors.blue.border,
      backgroundColor: colors.blue.primary,
    },
    dateColumn: {
      width: 74,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.cardBackground,
      borderRightWidth: 1,
      borderRightColor: colors.cardBorder,
      paddingVertical: 8,
      gap: 2,
    },
    dateColumnGoing: {
      backgroundColor: colors.green.primary,
      borderRightColor: colors.green.border,
    },
    dateColumnInterested: {
      backgroundColor: colors.orange.primary,
      borderRightColor: colors.orange.border,
    },
    dateColumnInvited: {
      backgroundColor: colors.blue.primary,
      borderRightColor: colors.blue.border,
    },
    weekday: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    day: {
      fontSize: 26,
      fontWeight: "800",
      color: colors.text,
      lineHeight: 28,
    },
    month: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.textSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    time: {
      fontSize: 15,
      lineHeight: 17,
      fontWeight: "800",
      color: colors.text,
      marginTop: 2,
    },
    poster: {
      width: 72,
      height: "100%",
      backgroundColor: colors.posterPlaceholder,
    },
    info: {
      flex: 1,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 4,
      overflow: "hidden",
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      columnGap: 6,
      flexWrap: "nowrap",
    },
    titleColumn: {
      flex: 1,
      minWidth: 0,
    },
    originalTitle: {
      fontSize: 10,
      lineHeight: 12,
      color: colors.textSecondary,
      fontStyle: "italic",
    },
    seatAvailabilityCorner: {
      position: "absolute",
      // Absolutely positioned children are offset from the parent's border box in
      // RN, not its padding box — match `info`'s padding so this sits as far from
      // the corner as CinemaPill (a normal-flow child) sits from the top-right.
      left: 10,
      bottom: 8,
    },
    subtitlesCorner: {
      position: "absolute",
      right: 10,
      bottom: 8,
      flexDirection: "row",
      gap: 4,
    },
    title: {
      fontSize: Platform.OS === "ios" ? 14 : 15,
      lineHeight: Platform.OS === "ios" ? 16 : 17,
      fontWeight: "700",
      color: colors.text,
      minWidth: 0,
    },
    friendBadgeArea: {
      flex: 1,
      minHeight: 0,
      overflow: "hidden",
      paddingTop: COMPACT_BADGE_TOP_PADDING,
      position: "relative",
    },
  });
};

/**
 * Memoised on purpose. A feed re-renders whenever its screen does — and a tab
 * switch alone does that, twice, because `useIsFocused` changes on the screen
 * being left and the one being arrived at. Without this, every visible card
 * rebuilt itself for a change that concerned none of them.
 *
 * The props have to hold still for it to be worth anything: see the list, which
 * keeps one `renderItem` and one set of handlers for its lifetime.
 */
export default memo(ShowtimeCard);
