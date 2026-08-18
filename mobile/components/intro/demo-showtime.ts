/**
 * The showtime the intro's tour points at.
 *
 * The tour explains the real sheet rather than a drawing of it, so it needs a
 * showtime to render. It borrows the first one the showtimes list would show —
 * a real film, poster, cinema and time, so the sheet looks exactly like the one
 * the user will open a minute later — and falls back to a fixed listing when
 * that call fails or the user's cinemas have nothing on.
 *
 * Everything that would be personal is replaced with invented data: made-up
 * friends going and interested (a brand-new account has none, and an empty
 * sheet demonstrates nothing) and a neutral "not going" status, so the three
 * status buttons all start unselected.
 *
 * The id is overwritten with a sentinel that matches no real showtime. The
 * sheet's own network calls are already off in tour mode and every handler is a
 * no-op, so this is only a backstop: nothing the tour does can land on a real
 * showtime.
 */
import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import {
  ShowtimesService,
  type CinemaPublic,
  type MovieInShowtime,
  type ShowtimePublic,
  type UserPublic,
} from "shared";
import { showtimeVisibilityQueryKey } from "shared/hooks/useShowtimeVisibility";

/** Matches no real showtime — see the note above. */
export const DEMO_SHOWTIME_ID = -1;

/** Movie ids below zero mean "synthetic listing" and render as "???". */
const DEMO_MOVIE_ID = 0;

const DEMO_SHOWTIME_HOUR = 20;
const DEMO_SHOWTIME_MINUTE = 15;
const DEMO_MOVIE_DURATION_MINUTES = 124;

const buildDemoFriend = (id: string, name: string): UserPublic => ({
  id,
  is_active: true,
  display_name: name,
});

const DEMO_FRIENDS_GOING: UserPublic[] = [
  buildDemoFriend("intro-demo-friend-1", "Sanne"),
  buildDemoFriend("intro-demo-friend-2", "Tom"),
];

const DEMO_FRIENDS_INTERESTED: UserPublic[] = [
  buildDemoFriend("intro-demo-friend-3", "Noor"),
];

const DEMO_CINEMA: CinemaPublic = {
  id: -1,
  name: "Kriterion",
  cineville: true,
  badge_bg_color: "#6b4ea8",
  url: "https://kriterion.nl",
  seating: "unknown",
  city: { id: -1, name: "Amsterdam" },
};

const DEMO_MOVIE: MovieInShowtime = {
  id: DEMO_MOVIE_ID,
  title: "Perfect Days",
  original_title: null,
  poster_link: null,
  letterboxd_slug: null,
  directors: ["Wim Wenders"],
  cast: null,
  release_year: 2023,
  duration: DEMO_MOVIE_DURATION_MINUTES,
  languages: ["ja"],
  original_language: "ja",
};

/** Tomorrow evening, so the sheet's date line reads like a real listing. */
const buildDemoTimes = (): { datetime: string; endDatetime: string } => {
  const start = DateTime.now()
    .setZone("Europe/Amsterdam")
    .plus({ days: 1 })
    .set({ hour: DEMO_SHOWTIME_HOUR, minute: DEMO_SHOWTIME_MINUTE, second: 0, millisecond: 0 });
  return {
    // Naive Amsterdam time, the same shape the API returns.
    datetime: start.toISO({ includeOffset: false }) ?? "",
    endDatetime:
      start.plus({ minutes: DEMO_MOVIE_DURATION_MINUTES }).toISO({ includeOffset: false }) ?? "",
  };
};

const buildFallbackShowtime = (): ShowtimePublic => {
  const { datetime, endDatetime } = buildDemoTimes();
  return {
    id: DEMO_SHOWTIME_ID,
    datetime,
    end_datetime: endDatetime,
    ticket_link: "https://example.com",
    subtitles: ["en"],
    movie: DEMO_MOVIE,
    cinema: DEMO_CINEMA,
    viewer: { going: "NOT_GOING" },
  };
};

/** Strip anything personal off a real showtime and dress it for the tour. */
const toDemoShowtime = (showtime: ShowtimePublic | undefined): ShowtimePublic => ({
  ...(showtime ?? buildFallbackShowtime()),
  id: DEMO_SHOWTIME_ID,
  // Replaced wholesale rather than merged: the tour shows its own cast, and
  // anything left over from the real showtime would be the viewer's own data.
  viewer: {
    going: "NOT_GOING",
    seat_row: null,
    seat_number: null,
    friends_going: DEMO_FRIENDS_GOING,
    friends_interested: DEMO_FRIENDS_INTERESTED,
    friends_watchlisted: [],
    friends_watched: [],
    invited_by: [],
    invite_ping_ids: [],
    co_invited_friends: [],
    pending_invited_friends: [],
    non_friend_participants: [],
  },
});

/**
 * The showtime the tour renders, and the visibility mode the sheet reads for
 * it. The mode is seeded straight into the cache because the sheet's own
 * visibility query is switched off in tour mode — without it the sheet would
 * show a skeleton pill for the whole tour.
 *
 * Fetched from the moment the intro starts rather than when the tour page
 * opens, so the sheet does not visibly swap the fallback listing for a real one
 * while the user is reading about it.
 */
export function useDemoShowtime(): ShowtimePublic {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["intro", "demoShowtime"],
    queryFn: () => ShowtimesService.getMainPageShowtimes({ limit: 1 }),
    // One sample is enough for a tour that runs once; never refetch under it.
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    queryClient.setQueryData(showtimeVisibilityQueryKey(DEMO_SHOWTIME_ID), {
      showtime_id: DEMO_SHOWTIME_ID,
      movie_id: DEMO_MOVIE_ID,
      mode: "ALL_FRIENDS",
    });
  }, [queryClient]);

  return useMemo(() => toDemoShowtime(data?.[0]), [data]);
}
