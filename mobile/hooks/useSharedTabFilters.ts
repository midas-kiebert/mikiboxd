import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Language } from "shared/client";
import { useFetchFavoriteSavedPreset } from "shared/hooks/useFetchFavoriteSavedPreset";
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
import { listDimension } from "@/components/filters/saved-presets";
import { normalizeSingleTimeRangeSelection } from "@/components/filters/time-range-utils";

const EMPTY_DAYS: string[] = [];
const EMPTY_TIME_RANGES: string[] = [];
const EMPTY_RUNTIME_RANGES: string[] = [];
const EMPTY_LIST_IDS: string[] = [];
const EMPTY_LANGUAGES: Language[] = [];
const SESSION_CINEMA_SELECTIONS_KEY = ["session", "cinema_selections"] as const;
const SESSION_DAY_SELECTIONS_KEY = ["session", "day_selections"] as const;
const SESSION_SHOWTIME_FILTER_KEY = ["session", "showtime_filter"] as const;
const SESSION_TIME_RANGE_SELECTIONS_KEY = ["session", "time_range_selections"] as const;
const SESSION_RUNTIME_RANGE_SELECTIONS_KEY = [
  "session",
  "runtime_range_selections",
] as const;
const SESSION_WATCHLIST_ONLY_KEY = ["session", "watchlist_only"] as const;
const SESSION_HIDE_WATCHED_KEY = ["session", "hide_watched"] as const;
const SESSION_WATCHLIST_EXCLUDE_KEY = ["session", "watchlist_exclude"] as const;
const SESSION_WATCHED_ONLY_KEY = ["session", "watched_only"] as const;
const SESSION_SELECTED_LIST_IDS_KEY = ["session", "selected_list_ids"] as const;
const SESSION_EXCLUDE_LIST_IDS_KEY = ["session", "exclude_list_ids"] as const;
const SESSION_GROUP_BY_MOVIE_KEY = ["session", "group_by_movie"] as const;
// A ceiling on how long a feed waits for the seeding below, not a target: the
// two requests it depends on are small and normally settle well inside this.
// Only a stalled/offline account query would ever hit it, and at that point
// the feed's own fetch is about to fail for the same reason — better that
// than leaving the feed gated forever on a query that never settles.
const FILTER_HYDRATION_FALLBACK_MS = 4000;

export function useSharedTabFilters() {
  const queryClient = useQueryClient();
  const initializedFromFavoritesRef = useRef(false);
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
  // A guest has no account to read defaults from, so these stay off rather than
  // 401-ing on a loop. Their equivalent — the cinemas they picked on this
  // device — is read from storage instead, and seeded below by the same effect.
  const isSignedIn = useIsSignedIn();
  const favoriteSavedPresetQuery = useFetchFavoriteSavedPreset({ enabled: isSignedIn });
  const favoriteCinemasQuery = useFetchSelectedCinemas({ enabled: isSignedIn });
  const guestCinemaIds = useGuestCinemaSelection();
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
    (!isSignedIn
      ? guestCinemaIds !== undefined && (guestCinemaIds.length > 0 || hasCinemaList)
      : favoriteSavedPresetQuery.isFetched && favoriteCinemasQuery.isFetched);

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

  useEffect(() => {
    if (initializedFromFavoritesRef.current) return;

    // A guest has one dimension to seed and one source for it: the cinemas they
    // picked on this device. Everything below reads a saved preset, which is an
    // account-only thing to have, so there is nothing else here for them.
    if (!isSignedIn) {
      if (guestCinemaIds === undefined) return;
      // A guest who has picked nothing yet gets every cinema, and that is the
      // full list resolved into a real selection rather than an empty one —
      // which is what useCinemaSelection does with an empty list, but only once
      // it has the cinemas to resolve against. Seeding before then would write
      // the empty selection this is meant to avoid, and the ref below would
      // stop us ever coming back to fix it.
      if (guestCinemaIds.length === 0 && !hasCinemaList) return;
      const rawSessionCinemaIds = queryClient.getQueryData<number[]>(
        SESSION_CINEMA_SELECTIONS_KEY
      );
      if (rawSessionCinemaIds === undefined) {
        setSessionCinemaIds(guestCinemaIds);
      }
      initializedFromFavoritesRef.current = true;
      return;
    }

    if (!favoriteSavedPresetQuery.isFetched || !favoriteCinemasQuery.isFetched) return;

    const savedFavorite = favoriteSavedPresetQuery.data;
    const savedUntouched = new Set(savedFavorite?.untouched_fields ?? []);
    const filterSource = savedFavorite;
    // Opt-out model: a saved preset controls every dimension except the ones it
    // left untouched.
    const appliesDimension = (dimension: string) => !savedUntouched.has(dimension);

    // Cinemas are opt-in: a saved favorite that carries a selection wins;
    // otherwise fall back to the favorite cinema preset.
    const rawSessionCinemaIds = queryClient.getQueryData<number[]>(
      SESSION_CINEMA_SELECTIONS_KEY
    );
    if (rawSessionCinemaIds === undefined) {
      if (savedFavorite && savedFavorite.cinema_ids) {
        setSessionCinemaIds(savedFavorite.cinema_ids);
      } else if (favoriteCinemasQuery.data !== undefined) {
        setSessionCinemaIds(favoriteCinemasQuery.data);
      }
    }

    if (filterSource) {
      const rawSessionShowtimeFilter = queryClient.getQueryData<SharedTabShowtimeFilter>(
        SESSION_SHOWTIME_FILTER_KEY
      );
      if (appliesDimension("selected_showtime_filter") && rawSessionShowtimeFilter === undefined) {
        setSelectedShowtimeFilter(
          toSharedTabShowtimeFilter(filterSource.filters.selected_showtime_filter)
        );
      }

      const rawWatchlistOnly = queryClient.getQueryData<boolean>(SESSION_WATCHLIST_ONLY_KEY);
      if (appliesDimension("watchlist_only") && rawWatchlistOnly === undefined) {
        setWatchlistOnly(Boolean(filterSource.filters.watchlist_only));
      }

      const rawWatchlistExclude = queryClient.getQueryData<boolean>(
        SESSION_WATCHLIST_EXCLUDE_KEY
      );
      if (appliesDimension("watchlist_only") && rawWatchlistExclude === undefined) {
        setWatchlistExclude(Boolean(filterSource.filters.watchlist_exclude));
      }

      const rawHideWatched = queryClient.getQueryData<boolean>(SESSION_HIDE_WATCHED_KEY);
      if (appliesDimension("hide_watched") && rawHideWatched === undefined) {
        setHideWatched(Boolean(filterSource.filters.hide_watched));
      }

      const rawWatchedOnly = queryClient.getQueryData<boolean>(SESSION_WATCHED_ONLY_KEY);
      if (appliesDimension("hide_watched") && rawWatchedOnly === undefined) {
        setWatchedOnly(Boolean(filterSource.filters.watched_only));
      }

      // Lists: apply the favorite's stored membership for every controlled list.
      // A legacy favorite controls all lists (clears them); lists left untouched
      // keep their (cold-start empty) default.
      const rawSelectedListIds = queryClient.getQueryData<string[]>(
        SESSION_SELECTED_LIST_IDS_KEY
      );
      if (rawSelectedListIds === undefined) {
        setSessionListIds(
          (filterSource.filters.selected_list_ids ?? []).filter((id) =>
            appliesDimension(listDimension(id))
          )
        );
      }

      const rawExcludeListIds = queryClient.getQueryData<string[]>(
        SESSION_EXCLUDE_LIST_IDS_KEY
      );
      if (rawExcludeListIds === undefined) {
        setSessionExcludeListIds(
          (filterSource.filters.exclude_list_ids ?? []).filter((id) =>
            appliesDimension(listDimension(id))
          )
        );
      }

      const rawSessionDays = queryClient.getQueryData<string[]>(SESSION_DAY_SELECTIONS_KEY);
      if (appliesDimension("days") && rawSessionDays === undefined) {
        setSessionDays(filterSource.filters.days ?? []);
      }

      const rawSessionTimeRanges = queryClient.getQueryData<string[]>(
        SESSION_TIME_RANGE_SELECTIONS_KEY
      );
      if (appliesDimension("time_ranges") && rawSessionTimeRanges === undefined) {
        setSelectedTimeRanges(filterSource.filters.time_ranges ?? []);
      }

      const rawSessionRuntimeRanges = queryClient.getQueryData<string[]>(
        SESSION_RUNTIME_RANGE_SELECTIONS_KEY
      );
      if (appliesDimension("runtime_ranges") && rawSessionRuntimeRanges === undefined) {
        setSelectedRuntimeRanges(filterSource.filters.runtime_ranges ?? []);
      }

      const rawGroupByMovie = queryClient.getQueryData<boolean>(
        SESSION_GROUP_BY_MOVIE_KEY
      );
      if (appliesDimension("group_by_movie") && rawGroupByMovie === undefined) {
        setGroupByMovie(Boolean(filterSource.filters.group_by_movie));
      }
    }

    initializedFromFavoritesRef.current = true;
  }, [
    favoriteCinemasQuery.data,
    favoriteCinemasQuery.isFetched,
    favoriteSavedPresetQuery.data,
    favoriteSavedPresetQuery.isFetched,
    guestCinemaIds,
    hasCinemaList,
    isSignedIn,
    queryClient,
    setSessionCinemaIds,
    setSessionDays,
    setSelectedShowtimeFilter,
    setSelectedTimeRanges,
    setSelectedRuntimeRanges,
    setGroupByMovie,
    setWatchlistOnly,
    setWatchlistExclude,
    setHideWatched,
    setWatchedOnly,
    setSessionListIds,
    setSessionExcludeListIds,
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
 * And it is a great deal cheaper: `useSharedTabFilters` carries the favourite-
 * preset query and the one-shot seeding effect, none of which a reader needs.
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
