import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useFetchFavoriteFilterPreset } from "shared/hooks/useFetchFavoriteFilterPreset";
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";
import { useSessionDaySelections } from "shared/hooks/useSessionDaySelections";
import { useSessionShowtimeFilter } from "shared/hooks/useSessionShowtimeFilter";
import { useSessionTimeRangeSelections } from "shared/hooks/useSessionTimeRangeSelections";
import { useSessionWatchlistOnly } from "shared/hooks/useSessionWatchlistOnly";

import {
  SHARED_TAB_FILTER_PRESET_SCOPE,
  toSharedTabShowtimeFilter,
  type SharedTabShowtimeFilter,
} from "@/components/filters/shared-tab-filters";

const EMPTY_DAYS: string[] = [];
const EMPTY_TIME_RANGES: string[] = [];
const SESSION_CINEMA_SELECTIONS_KEY = ["session", "cinema_selections"] as const;
const SESSION_DAY_SELECTIONS_KEY = ["session", "day_selections"] as const;
const SESSION_SHOWTIME_FILTER_KEY = ["session", "showtime_filter"] as const;
const SESSION_TIME_RANGE_SELECTIONS_KEY = ["session", "time_range_selections"] as const;
const SESSION_WATCHLIST_ONLY_KEY = ["session", "watchlist_only"] as const;

export function useSharedTabFilters() {
  const queryClient = useQueryClient();
  const initializedFromFavoritesRef = useRef(false);

  const { selections: sessionCinemaIds, setSelections: setSessionCinemaIds } =
    useSessionCinemaSelections();
  const { selections: sessionDays, setSelections: setSessionDays } =
    useSessionDaySelections();
  const { selections: sessionTimeRanges, setSelections: setSessionTimeRanges } =
    useSessionTimeRangeSelections();
  const { selection: sessionShowtimeFilter, setSelection: setSessionShowtimeFilter } =
    useSessionShowtimeFilter();
  const { selection: watchlistOnly, setSelection: setWatchlistOnly } = useSessionWatchlistOnly();
  const favoriteFilterPresetQuery = useFetchFavoriteFilterPreset({
    scope: SHARED_TAB_FILTER_PRESET_SCOPE,
  });
  const favoriteCinemasQuery = useFetchSelectedCinemas();

  const selectedShowtimeFilter = toSharedTabShowtimeFilter(sessionShowtimeFilter);
  const selectedDays = sessionDays ?? EMPTY_DAYS;
  const selectedTimeRanges = sessionTimeRanges ?? EMPTY_TIME_RANGES;

  const setSelectedShowtimeFilter = useCallback(
    (next: SharedTabShowtimeFilter) => {
      setSessionShowtimeFilter(next);
    },
    [setSessionShowtimeFilter]
  );

  useEffect(() => {
    if (initializedFromFavoritesRef.current) return;
    if (!favoriteFilterPresetQuery.isFetched || !favoriteCinemasQuery.isFetched) return;

    const rawSessionCinemaIds = queryClient.getQueryData<number[]>(
      SESSION_CINEMA_SELECTIONS_KEY
    );
    if (rawSessionCinemaIds === undefined && favoriteCinemasQuery.data !== undefined) {
      setSessionCinemaIds(favoriteCinemasQuery.data);
    }

    const favoritePreset = favoriteFilterPresetQuery.data;
    if (favoritePreset) {
      const rawSessionShowtimeFilter = queryClient.getQueryData<SharedTabShowtimeFilter>(
        SESSION_SHOWTIME_FILTER_KEY
      );
      if (rawSessionShowtimeFilter === undefined) {
        setSessionShowtimeFilter(
          toSharedTabShowtimeFilter(favoritePreset.filters.selected_showtime_filter)
        );
      }

      const rawWatchlistOnly = queryClient.getQueryData<boolean>(SESSION_WATCHLIST_ONLY_KEY);
      if (rawWatchlistOnly === undefined) {
        setWatchlistOnly(Boolean(favoritePreset.filters.watchlist_only));
      }

      const rawSessionDays = queryClient.getQueryData<string[]>(SESSION_DAY_SELECTIONS_KEY);
      if (rawSessionDays === undefined) {
        setSessionDays(favoritePreset.filters.days ?? []);
      }

      const rawSessionTimeRanges = queryClient.getQueryData<string[]>(
        SESSION_TIME_RANGE_SELECTIONS_KEY
      );
      if (rawSessionTimeRanges === undefined) {
        setSessionTimeRanges(favoritePreset.filters.time_ranges ?? []);
      }
    }

    initializedFromFavoritesRef.current = true;
  }, [
    favoriteCinemasQuery.data,
    favoriteCinemasQuery.isFetched,
    favoriteFilterPresetQuery.data,
    favoriteFilterPresetQuery.isFetched,
    queryClient,
    setSessionCinemaIds,
    setSessionDays,
    setSessionShowtimeFilter,
    setSessionTimeRanges,
    setWatchlistOnly,
  ]);

  return {
    selectedShowtimeFilter,
    setSelectedShowtimeFilter,
    watchlistOnly,
    setWatchlistOnly,
    sessionCinemaIds,
    setSessionCinemaIds,
    selectedDays,
    setSelectedDays: setSessionDays,
    selectedTimeRanges,
    setSelectedTimeRanges: setSessionTimeRanges,
  };
}
