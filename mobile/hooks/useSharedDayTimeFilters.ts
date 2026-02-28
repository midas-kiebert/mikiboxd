import { useCallback } from "react";
import { useSessionDaySelections } from "shared/hooks/useSessionDaySelections";
import { useSessionTimeRangeSelections } from "shared/hooks/useSessionTimeRangeSelections";

import { normalizeSingleTimeRangeSelection } from "@/components/filters/time-range-utils";

const EMPTY_DAYS: string[] = [];
const EMPTY_TIME_RANGES: string[] = [];

export function useSharedDayTimeFilters() {
  const { selections: sessionDays, setSelections: setSessionDays } =
    useSessionDaySelections();
  const { selections: sessionTimeRanges, setSelections: setSessionTimeRanges } =
    useSessionTimeRangeSelections();

  const selectedDays = sessionDays ?? EMPTY_DAYS;
  const selectedTimeRanges = normalizeSingleTimeRangeSelection(
    sessionTimeRanges ?? EMPTY_TIME_RANGES
  );

  const setSelectedTimeRanges = useCallback(
    (next: string[]) => {
      setSessionTimeRanges(normalizeSingleTimeRangeSelection(next));
    },
    [setSessionTimeRanges]
  );

  return {
    selectedDays,
    setSelectedDays: setSessionDays,
    selectedTimeRanges,
    setSelectedTimeRanges,
  };
}
