import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchFavoriteFilterPreset } from "shared/hooks/useFetchFavoriteFilterPreset";
import { useFetchFavoriteSavedPreset } from "shared/hooks/useFetchFavoriteSavedPreset";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";
import { useSessionDaySelections } from "shared/hooks/useSessionDaySelections";
import { useSessionShowtimeFilter } from "shared/hooks/useSessionShowtimeFilter";
import { useSessionTimeRangeSelections } from "shared/hooks/useSessionTimeRangeSelections";
import { useSessionRuntimeRangeSelections } from "shared/hooks/useSessionRuntimeRangeSelections";
import { useSessionWatchlistOnly } from "shared/hooks/useSessionWatchlistOnly";
import { useSessionGroupByMovie } from "shared/hooks/useSessionGroupByMovie";

import {
  normalizeSingleRuntimeRangeSelection,
} from "@/components/filters/runtime-range-utils";
import {
  SHARED_TAB_FILTER_PRESET_SCOPE,
  toSharedTabShowtimeFilter,
  type SharedTabShowtimeFilter,
} from "@/components/filters/shared-tab-filters";
import { normalizeSingleTimeRangeSelection } from "@/components/filters/time-range-utils";

const EMPTY_DAYS: string[] = [];
const EMPTY_TIME_RANGES: string[] = [];
const EMPTY_RUNTIME_RANGES: string[] = [];
const SESSION_CINEMA_SELECTIONS_KEY = ["session", "cinema_selections"] as const;
const SESSION_DAY_SELECTIONS_KEY = ["session", "day_selections"] as const;
const SESSION_SHOWTIME_FILTER_KEY = ["session", "showtime_filter"] as const;
const SESSION_TIME_RANGE_SELECTIONS_KEY = ["session", "time_range_selections"] as const;
const SESSION_RUNTIME_RANGE_SELECTIONS_KEY = [
  "session",
  "runtime_range_selections",
] as const;
const SESSION_WATCHLIST_ONLY_KEY = ["session", "watchlist_only"] as const;
const SESSION_GROUP_BY_MOVIE_KEY = ["session", "group_by_movie"] as const;

export function useSharedTabFilters() {
  const queryClient = useQueryClient();
  const initializedFromFavoritesRef = useRef(false);
  const applyShowtimeFilterFrameRef = useRef<number | null>(null);
  const applyWatchlistOnlyFrameRef = useRef<number | null>(null);

  const { selections: sessionCinemaIds, setSelections: setSessionCinemaIds } =
    useSessionCinemaSelections();
  const { selections: sessionDays, setSelections: setSessionDays } =
    useSessionDaySelections();
  const { selections: sessionTimeRanges, setSelections: setSessionTimeRanges } =
    useSessionTimeRangeSelections();
  const { selections: sessionRuntimeRanges, setSelections: setSessionRuntimeRanges } =
    useSessionRuntimeRangeSelections();
  const { selection: sessionShowtimeFilter, setSelection: setSessionShowtimeFilter } =
    useSessionShowtimeFilter();
  const { selection: sessionWatchlistOnly, setSelection: setSessionWatchlistOnly } =
    useSessionWatchlistOnly();
  const { selection: groupByMovie, setSelection: setGroupByMovie } =
    useSessionGroupByMovie();
  const favoriteFilterPresetQuery = useFetchFavoriteFilterPreset({
    scope: SHARED_TAB_FILTER_PRESET_SCOPE,
  });
  const favoriteSavedPresetQuery = useFetchFavoriteSavedPreset({
    scope: SHARED_TAB_FILTER_PRESET_SCOPE,
  });
  const favoriteCinemasQuery = useFetchSelectedCinemas();

  const initialShowtimeFilter = toSharedTabShowtimeFilter(sessionShowtimeFilter);
  const initialWatchlistOnly = Boolean(sessionWatchlistOnly);
  const [selectedShowtimeFilter, setSelectedShowtimeFilterState] =
    useState<SharedTabShowtimeFilter>(initialShowtimeFilter);
  const [appliedShowtimeFilter, setAppliedShowtimeFilterState] =
    useState<SharedTabShowtimeFilter>(initialShowtimeFilter);
  const [watchlistOnly, setWatchlistOnlyState] = useState<boolean>(initialWatchlistOnly);
  const [appliedWatchlistOnly, setAppliedWatchlistOnlyState] = useState<boolean>(initialWatchlistOnly);
  const selectedDays = sessionDays ?? EMPTY_DAYS;
  const selectedTimeRanges = normalizeSingleTimeRangeSelection(sessionTimeRanges ?? EMPTY_TIME_RANGES);
  const selectedRuntimeRanges = normalizeSingleRuntimeRangeSelection(
    sessionRuntimeRanges ?? EMPTY_RUNTIME_RANGES
  );

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

  useEffect(
    () => () => {
      if (applyShowtimeFilterFrameRef.current !== null) {
        cancelAnimationFrame(applyShowtimeFilterFrameRef.current);
      }
      if (applyWatchlistOnlyFrameRef.current !== null) {
        cancelAnimationFrame(applyWatchlistOnlyFrameRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (initializedFromFavoritesRef.current) return;
    if (
      !favoriteFilterPresetQuery.isFetched ||
      !favoriteSavedPresetQuery.isFetched ||
      !favoriteCinemasQuery.isFetched
    )
      return;

    // The favorite preset is unique across the legacy and new systems. A legacy
    // preset carries every filter dimension; a new saved preset carries only the
    // dimensions it includes (and optionally a cinema selection).
    const legacyFavorite = favoriteFilterPresetQuery.data;
    const savedFavorite = favoriteSavedPresetQuery.data;
    const savedIncludes = new Set(savedFavorite?.included_fields ?? []);
    const filterSource = legacyFavorite ?? savedFavorite;
    const appliesDimension = (dimension: string) =>
      Boolean(legacyFavorite) || savedIncludes.has(dimension);

    // Cinemas: a saved favorite that includes cinemas wins; otherwise fall back
    // to the favorite cinema preset.
    const rawSessionCinemaIds = queryClient.getQueryData<number[]>(
      SESSION_CINEMA_SELECTIONS_KEY
    );
    if (rawSessionCinemaIds === undefined) {
      if (savedFavorite && savedIncludes.has("cinemas") && savedFavorite.cinema_ids) {
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
    favoriteFilterPresetQuery.data,
    favoriteFilterPresetQuery.isFetched,
    favoriteSavedPresetQuery.data,
    favoriteSavedPresetQuery.isFetched,
    queryClient,
    setSessionCinemaIds,
    setSessionDays,
    setSelectedShowtimeFilter,
    setSelectedTimeRanges,
    setSelectedRuntimeRanges,
    setGroupByMovie,
    setWatchlistOnly,
  ]);

  return {
    selectedShowtimeFilter,
    appliedShowtimeFilter,
    setSelectedShowtimeFilter,
    watchlistOnly,
    appliedWatchlistOnly,
    setWatchlistOnly,
    sessionCinemaIds,
    setSessionCinemaIds,
    selectedDays,
    setSelectedDays: setSessionDays,
    selectedTimeRanges,
    setSelectedTimeRanges,
    selectedRuntimeRanges,
    setSelectedRuntimeRanges,
    groupByMovie,
    setGroupByMovie,
  };
}
