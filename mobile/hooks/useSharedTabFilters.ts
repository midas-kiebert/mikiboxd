import { useCallback } from "react";
import { useSessionCinemaSelections } from "shared/hooks/useSessionCinemaSelections";
import { useSessionDaySelections } from "shared/hooks/useSessionDaySelections";
import { useSessionShowtimeFilter } from "shared/hooks/useSessionShowtimeFilter";
import { useSessionTimeRangeSelections } from "shared/hooks/useSessionTimeRangeSelections";
import { useSessionWatchlistOnly } from "shared/hooks/useSessionWatchlistOnly";

import {
  toSharedTabShowtimeFilter,
  type SharedTabShowtimeFilter,
} from "@/components/filters/shared-tab-filters";

const EMPTY_DAYS: string[] = [];
const EMPTY_TIME_RANGES: string[] = [];

export function useSharedTabFilters() {
  const { selections: sessionCinemaIds, setSelections: setSessionCinemaIds } =
    useSessionCinemaSelections();
  const { selections: sessionDays, setSelections: setSessionDays } = useSessionDaySelections();
  const { selections: sessionTimeRanges, setSelections: setSessionTimeRanges } =
    useSessionTimeRangeSelections();
  const { selection: sessionShowtimeFilter, setSelection: setSessionShowtimeFilter } =
    useSessionShowtimeFilter();
  const { selection: watchlistOnly, setSelection: setWatchlistOnly } = useSessionWatchlistOnly();

  const selectedShowtimeFilter = toSharedTabShowtimeFilter(sessionShowtimeFilter);
  const selectedDays = sessionDays ?? EMPTY_DAYS;
  const selectedTimeRanges = sessionTimeRanges ?? EMPTY_TIME_RANGES;

  const setSelectedShowtimeFilter = useCallback(
    (next: SharedTabShowtimeFilter) => {
      setSessionShowtimeFilter(next);
    },
    [setSessionShowtimeFilter]
  );

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
