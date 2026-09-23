import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Language } from "shared/client";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionDaySelections } from "shared/hooks/useSessionDaySelections";
import { useSessionShowtimeFilter } from "shared/hooks/useSessionShowtimeFilter";
import { useSessionTimeRangeSelections } from "shared/hooks/useSessionTimeRangeSelections";
import { useSessionRuntimeRangeSelections } from "shared/hooks/useSessionRuntimeRangeSelections";
import { useSessionLanguageSelections } from "shared/hooks/useSessionLanguageSelections";
import { useSessionWatchlistOnly } from "shared/hooks/useSessionWatchlistOnly";
import { useSessionHideWatched } from "shared/hooks/useSessionHideWatched";
import { useSessionGroupByMovie } from "shared/hooks/useSessionGroupByMovie";
import { useSessionSelectedListIds } from "shared/hooks/useSessionSelectedListIds";
import { useSessionExcludeListIds } from "shared/hooks/useSessionExcludeListIds";
import { useSessionWatchlistExclude } from "shared/hooks/useSessionWatchlistExclude";
import { useSessionWatchedOnly } from "shared/hooks/useSessionWatchedOnly";

import { useCinemaSelection } from "@/hooks/useCinemaSelection";
import { useFeedDefaults } from "@/hooks/useFeedDefaults";
import { useIsSignedIn } from "@/utils/auth-session";
import { useGuestCinemaSelection } from "@/utils/guest-cinema-selection";
import { useFetchCinemas } from "shared/hooks/useFetchCinemas";
import type { PageFilterPresetState } from "@/components/filters/filter-preset-utils";
import {
  normalizeSingleRuntimeRangeSelection,
} from "@/components/filters/runtime-range-utils";
import {
  toSharedTabShowtimeFilter,
  type SharedTabShowtimeFilter,
} from "@/components/filters/shared-tab-filters";
import { normalizeSingleTimeRangeSelection } from "@/components/filters/time-range-utils";

const EMPTY_DAYS: string[] = [];
const EMPTY_TIME_RANGES: string[] = [];
const EMPTY_RUNTIME_RANGES: string[] = [];
const EMPTY_LIST_IDS: string[] = [];
const EMPTY_LANGUAGES: Language[] = [];
const SESSION_CINEMA_SELECTIONS_KEY = ["session", "cinema_selections"] as const;
const SESSION_GROUP_BY_MOVIE_KEY = ["session", "group_by_movie"] as const;
const SESSION_LANGUAGE_SELECTIONS_KEY = ["session", "language_selections"] as const;
// A ceiling on how long a feed waits for the seeding below, not a target: the
// reads it depends on are small and normally settle well inside this.
// Only a stalled/offline account query would ever hit it, and at that point
// the feed's own fetch is about to fail for the same reason — better that
// than leaving the feed gated forever on a query that never settles.
const FILTER_HYDRATION_FALLBACK_MS = 4000;

export function useSharedTabFilters() {
  const queryClient = useQueryClient();
  const initializedDefaultsRef = useRef(false);
  const applyShowtimeFilterFrameRef = useRef<number | null>(null);
  const applyWatchlistOnlyFrameRef = useRef<number | null>(null);
  const applyHideWatchedFrameRef = useRef<number | null>(null);
  const applyGroupByMovieFrameRef = useRef<number | null>(null);

  const { cinemaIds: sessionCinemaIds, setCinemaIds: setSessionCinemaIds } =
    useCinemaSelection();
  const { selections: sessionDays, setSelections: setSessionDays } =
    useSessionDaySelections();
  const { selections: sessionTimeRanges, setSelections: setSessionTimeRanges } =
    useSessionTimeRangeSelections();
  const { selections: sessionRuntimeRanges, setSelections: setSessionRuntimeRanges } =
    useSessionRuntimeRangeSelections();
  const { selections: sessionLanguages, setSelections: setSessionLanguages } =
    useSessionLanguageSelections();
  const { selection: sessionShowtimeFilter, setSelection: setSessionShowtimeFilter } =
    useSessionShowtimeFilter();
  const { selection: sessionWatchlistOnly, setSelection: setSessionWatchlistOnly } =
    useSessionWatchlistOnly();
  const { selection: sessionHideWatched, setSelection: setSessionHideWatched } =
    useSessionHideWatched();
  const { selection: sessionGroupByMovie, setSelection: setSessionGroupByMovie } =
    useSessionGroupByMovie();
  const { selections: sessionListIds, setSelections: setSessionListIds } =
    useSessionSelectedListIds();
  const { selections: sessionExcludeListIds, setSelections: setSessionExcludeListIds } =
    useSessionExcludeListIds();
  const { selection: watchlistExclude, setSelection: setWatchlistExclude } =
    useSessionWatchlistExclude();
  const { selection: watchedOnly, setSelection: setWatchedOnly } =
    useSessionWatchedOnly();
  // A guest has no account to read preferred cinemas from, so this stays off
  // rather than 401-ing on a loop. Their equivalent — the cinemas they picked
  // on this device — is read from storage instead, and seeded below by the
  // same effect.
  const isSignedIn = useIsSignedIn();
  const favoriteCinemasQuery = useFetchSelectedCinemas({ enabled: isSignedIn });
  const guestCinemaIds = useGuestCinemaSelection();
  const feedDefaults = useFeedDefaults();
  const { data: allCinemas } = useFetchCinemas();
  const hasCinemaList = (allCinemas?.length ?? 0) > 0;

  // Whether the one-time seeding effect below has settled — same conditions
  // it gates on. A feed that starts fetching before this is true risks
  // starting under placeholder filters (no cinema selection yet) and then
  // having `setSessionCinemaIds` change them a beat later once the seeding
  // effect actually runs: the query key changes out from under an in-flight
  // fetch, which can permanently strand a scroll-triggered "load more" (see
  // `feed-paging.ts`'s `useScrollTriggeredLoadMore`). Callers that page a
  // feed off `sessionCinemaIds` should hold their query's `enabled` on this.
  const [hydrationFallback, setHydrationFallback] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setHydrationFallback(true), FILTER_HYDRATION_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, []);
  const isHydrated =
    hydrationFallback ||
    (feedDefaults.isLoaded &&
      (!isSignedIn
        ? guestCinemaIds !== undefined && (guestCinemaIds.length > 0 || hasCinemaList)
        : favoriteCinemasQuery.isFetched));

  const initialShowtimeFilter = toSharedTabShowtimeFilter(sessionShowtimeFilter);
  const initialWatchlistOnly = Boolean(sessionWatchlistOnly);
  const initialHideWatched = Boolean(sessionHideWatched);
  const initialGroupByMovie = Boolean(sessionGroupByMovie);
  const [selectedShowtimeFilter, setSelectedShowtimeFilterState] =
    useState<SharedTabShowtimeFilter>(initialShowtimeFilter);
  const [appliedShowtimeFilter, setAppliedShowtimeFilterState] =
    useState<SharedTabShowtimeFilter>(initialShowtimeFilter);
  const [watchlistOnly, setWatchlistOnlyState] = useState<boolean>(initialWatchlistOnly);
  const [appliedWatchlistOnly, setAppliedWatchlistOnlyState] = useState<boolean>(initialWatchlistOnly);
  const [hideWatched, setHideWatchedState] = useState<boolean>(initialHideWatched);
  const [appliedHideWatched, setAppliedHideWatchedState] = useState<boolean>(initialHideWatched);
  const [groupByMovie, setGroupByMovieState] = useState<boolean>(initialGroupByMovie);
  const [appliedGroupByMovie, setAppliedGroupByMovieState] =
    useState<boolean>(initialGroupByMovie);
  const selectedDays = sessionDays ?? EMPTY_DAYS;
  const selectedTimeRanges = normalizeSingleTimeRangeSelection(sessionTimeRanges ?? EMPTY_TIME_RANGES);
  const selectedRuntimeRanges = normalizeSingleRuntimeRangeSelection(
    sessionRuntimeRanges ?? EMPTY_RUNTIME_RANGES
  );
  const selectedListIds = sessionListIds ?? EMPTY_LIST_IDS;
  const excludeListIds = sessionExcludeListIds ?? EMPTY_LIST_IDS;
  const selectedLanguages = sessionLanguages ?? EMPTY_LANGUAGES;

  const setSelectedShowtimeFilter = useCallback(
    (next: SharedTabShowtimeFilter) => {
      // Update pill visuals immediately, defer cache+query-facing state by one frame.
      setSelectedShowtimeFilterState(next);
      if (applyShowtimeFilterFrameRef.current !== null) {
        cancelAnimationFrame(applyShowtimeFilterFrameRef.current);
      }
      applyShowtimeFilterFrameRef.current = requestAnimationFrame(() => {
        applyShowtimeFilterFrameRef.current = null;
        setAppliedShowtimeFilterState(next);
        setSessionShowtimeFilter(next);
      });
    },
    [setSessionShowtimeFilter]
  );

  const setWatchlistOnly = useCallback(
    (next: boolean) => {
      // Update pill visuals immediately, defer cache+query-facing state by one frame.
      setWatchlistOnlyState(next);
      if (applyWatchlistOnlyFrameRef.current !== null) {
        cancelAnimationFrame(applyWatchlistOnlyFrameRef.current);
      }
      applyWatchlistOnlyFrameRef.current = requestAnimationFrame(() => {
        applyWatchlistOnlyFrameRef.current = null;
        setAppliedWatchlistOnlyState(next);
        setSessionWatchlistOnly(next);
      });
    },
    [setSessionWatchlistOnly]
  );

  const setHideWatched = useCallback(
    (next: boolean) => {
      // Update pill visuals immediately, defer cache+query-facing state by one frame.
      setHideWatchedState(next);
      if (applyHideWatchedFrameRef.current !== null) {
        cancelAnimationFrame(applyHideWatchedFrameRef.current);
      }
      applyHideWatchedFrameRef.current = requestAnimationFrame(() => {
        applyHideWatchedFrameRef.current = null;
        setAppliedHideWatchedState(next);
        setSessionHideWatched(next);
      });
    },
    [setSessionHideWatched]
  );

  const setGroupByMovie = useCallback(
    (next: boolean) => {
      // Update chip visuals immediately, defer cache+query-facing state by one
      // frame. This one buys more than the others do: the applied value picks
      // which feed is mounted at all, so writing it in the tap's own commit
      // tears one list down and builds the other in the frame the tap's
      // animations are supposed to start in — which is exactly what a preset
      // carrying "Group by movie" felt like.
      setGroupByMovieState(next);
      if (applyGroupByMovieFrameRef.current !== null) {
        cancelAnimationFrame(applyGroupByMovieFrameRef.current);
      }
      applyGroupByMovieFrameRef.current = requestAnimationFrame(() => {
        applyGroupByMovieFrameRef.current = null;
        setAppliedGroupByMovieState(next);
        setSessionGroupByMovie(next);
      });
    },
    [setSessionGroupByMovie]
  );

  const setSelectedTimeRanges = useCallback(
    (next: string[]) => {
      setSessionTimeRanges(normalizeSingleTimeRangeSelection(next));
    },
    [setSessionTimeRanges]
  );

  const setSelectedRuntimeRanges = useCallback(
    (next: string[]) => {
      setSessionRuntimeRanges(normalizeSingleRuntimeRangeSelection(next));
    },
    [setSessionRuntimeRanges]
  );

  useEffect(() => {
    const normalized = toSharedTabShowtimeFilter(sessionShowtimeFilter);
    setSelectedShowtimeFilterState(normalized);
    setAppliedShowtimeFilterState(normalized);
  }, [sessionShowtimeFilter]);

  useEffect(() => {
    const normalized = Boolean(sessionWatchlistOnly);
    setWatchlistOnlyState(normalized);
    setAppliedWatchlistOnlyState(normalized);
  }, [sessionWatchlistOnly]);

  useEffect(() => {
    const normalized = Boolean(sessionHideWatched);
    setHideWatchedState(normalized);
    setAppliedHideWatchedState(normalized);
  }, [sessionHideWatched]);

  useEffect(() => {
    const normalized = Boolean(sessionGroupByMovie);
    setGroupByMovieState(normalized);
    setAppliedGroupByMovieState(normalized);
  }, [sessionGroupByMovie]);

  useEffect(
    () => () => {
      if (applyShowtimeFilterFrameRef.current !== null) {
        cancelAnimationFrame(applyShowtimeFilterFrameRef.current);
      }
      if (applyWatchlistOnlyFrameRef.current !== null) {
        cancelAnimationFrame(applyWatchlistOnlyFrameRef.current);
      }
      if (applyHideWatchedFrameRef.current !== null) {
        cancelAnimationFrame(applyHideWatchedFrameRef.current);
      }
      if (applyGroupByMovieFrameRef.current !== null) {
        cancelAnimationFrame(applyGroupByMovieFrameRef.current);
      }
    },
    []
  );

  // Startup: the only things a feed opens with are its defaults — the preferred
  // cinemas, and the feed style and language set with "Make this the default"
  // (`useFeedDefaults`). Every other filter opens off. Each is only seeded when
  // this session has not set it yet.
  useEffect(() => {
    if (initializedDefaultsRef.current) return;
    if (!feedDefaults.isLoaded) return;

    const rawSessionCinemaIds = queryClient.getQueryData<number[]>(
      SESSION_CINEMA_SELECTIONS_KEY
    );
    if (!isSignedIn) {
      // A guest's preferred cinemas are the ones they picked on this device.
      if (guestCinemaIds === undefined) return;
      // A guest who has picked nothing yet gets every cinema, and that is the
      // full list resolved into a real selection rather than an empty one —
      // which is what useCinemaSelection does with an empty list, but only once
      // it has the cinemas to resolve against. Seeding before then would write
      // the empty selection this is meant to avoid, and the ref below would
      // stop us ever coming back to fix it.
      if (guestCinemaIds.length === 0 && !hasCinemaList) return;
      if (rawSessionCinemaIds === undefined) setSessionCinemaIds(guestCinemaIds);
    } else {
      if (!favoriteCinemasQuery.isFetched) return;
      if (rawSessionCinemaIds === undefined && favoriteCinemasQuery.data !== undefined) {
        setSessionCinemaIds(favoriteCinemasQuery.data);
      }
    }

    if (queryClient.getQueryData<boolean>(SESSION_GROUP_BY_MOVIE_KEY) === undefined) {
      setGroupByMovie(feedDefaults.defaultGroupByMovie);
    }
    if (
      queryClient.getQueryData<Language[]>(SESSION_LANGUAGE_SELECTIONS_KEY) === undefined &&
      feedDefaults.defaultLanguages.length > 0
    ) {
      setSessionLanguages([...feedDefaults.defaultLanguages]);
    }

    initializedDefaultsRef.current = true;
  }, [
    favoriteCinemasQuery.data,
    favoriteCinemasQuery.isFetched,
    feedDefaults.isLoaded,
    feedDefaults.defaultGroupByMovie,
    feedDefaults.defaultLanguages,
    guestCinemaIds,
    hasCinemaList,
    isSignedIn,
    queryClient,
    setSessionCinemaIds,
    setGroupByMovie,
    setSessionLanguages,
  ]);

  return {
    selectedShowtimeFilter,
    appliedShowtimeFilter,
    setSelectedShowtimeFilter,
    watchlistOnly,
    appliedWatchlistOnly,
    setWatchlistOnly,
    hideWatched,
    appliedHideWatched,
    setHideWatched,
    sessionCinemaIds,
    setSessionCinemaIds,
    selectedDays,
    setSelectedDays: setSessionDays,
    selectedTimeRanges,
    setSelectedTimeRanges,
    selectedRuntimeRanges,
    setSelectedRuntimeRanges,
    selectedListIds,
    setSelectedListIds: setSessionListIds,
    excludeListIds,
    setExcludeListIds: setSessionExcludeListIds,
    selectedLanguages,
    setSelectedLanguages: setSessionLanguages,
    watchlistExclude,
    setWatchlistExclude,
    watchedOnly,
    setWatchedOnly,
    groupByMovie,
    appliedGroupByMovie,
    setGroupByMovie,
    isHydrated,
  };
}

/**
 * The current filter selection in the shape presets are built from, for callers
 * that only want to read it — the preset buttons asking whether they still have
 * anything to do, and the tip that asks whether anything is set at all.
 *
 * Reads the session values directly rather than going through
 * `useSharedTabFilters`, for two reasons. It is a commit faster: that hook
 * mirrors each session value into local state so the *owner* of a setter can
 * paint before the write lands, and an instance that owns no setters gets
 * nothing from the mirror but the extra render it takes to catch up — which is
 * the delay before a preset button lights back up when you remove a filter.
 * And it is a great deal cheaper: `useSharedTabFilters` carries the defaults
 * queries and the one-shot seeding effect, none of which a reader needs.
 */
export function useCurrentFilterPresetState(): PageFilterPresetState {
  const { selection: sessionShowtimeFilter } = useSessionShowtimeFilter();
  const { selection: sessionWatchlistOnly } = useSessionWatchlistOnly();
  const { selection: sessionWatchlistExclude } = useSessionWatchlistExclude();
  const { selection: sessionHideWatched } = useSessionHideWatched();
  const { selection: sessionWatchedOnly } = useSessionWatchedOnly();
  const { selection: sessionGroupByMovie } = useSessionGroupByMovie();
  const { selections: sessionListIds } = useSessionSelectedListIds();
  const { selections: sessionExcludeListIds } = useSessionExcludeListIds();
  const { selections: sessionDays } = useSessionDaySelections();
  const { selections: sessionTimeRanges } = useSessionTimeRangeSelections();
  const { selections: sessionRuntimeRanges } = useSessionRuntimeRangeSelections();
  const { selections: sessionLanguages } = useSessionLanguageSelections();

  return useMemo(
    () => ({
      selected_showtime_filter: toSharedTabShowtimeFilter(sessionShowtimeFilter),
      watchlist_only: Boolean(sessionWatchlistOnly),
      watchlist_exclude: Boolean(sessionWatchlistExclude),
      hide_watched: Boolean(sessionHideWatched),
      watched_only: Boolean(sessionWatchedOnly),
      selected_list_ids: [...(sessionListIds ?? EMPTY_LIST_IDS)],
      exclude_list_ids: [...(sessionExcludeListIds ?? EMPTY_LIST_IDS)],
      days: [...(sessionDays ?? EMPTY_DAYS)],
      // Normalised exactly as `useSharedTabFilters` normalises them, or the
      // same selection would serialise two ways and a preset would read as
      // changing something it does not.
      time_ranges: normalizeSingleTimeRangeSelection(
        sessionTimeRanges ?? EMPTY_TIME_RANGES
      ),
      runtime_ranges: normalizeSingleRuntimeRangeSelection(
        sessionRuntimeRanges ?? EMPTY_RUNTIME_RANGES
      ),
      group_by_movie: Boolean(sessionGroupByMovie),
      selected_languages: [...(sessionLanguages ?? EMPTY_LANGUAGES)],
    }),
    [
      sessionShowtimeFilter,
      sessionWatchlistOnly,
      sessionWatchlistExclude,
      sessionHideWatched,
      sessionWatchedOnly,
      sessionGroupByMovie,
      sessionListIds,
      sessionExcludeListIds,
      sessionDays,
      sessionTimeRanges,
      sessionRuntimeRanges,
      sessionLanguages,
    ]
  );
}
