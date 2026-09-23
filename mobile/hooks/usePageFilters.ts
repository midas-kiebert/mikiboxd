/**
 * Filters that belong to one pushed page (a film, a friend's agenda, a cinema's
 * programme) rather than to the tabs.
 *
 * Opened from a feed (`inheritFilters=1`), the page starts from the feed's
 * filters, so what you were looking at is still what you see. Opened from
 * anywhere else — Activity, a notification, the friends list — it starts with
 * nothing on at all, cinema and language included: those places show no
 * filters, so the screening you tapped must still be on the page you land on.
 * Either way a change made here stays here and never reaches the feed.
 *
 * The cinema selection is read by the chip, the sheets and the preset popover
 * through `useCinemaSelection`, so the page hands its own to them by wrapping
 * its content in `CinemaSelectionScope` with `cinemaScope`.
 */
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Language } from "shared/client";

import type { SharedTabShowtimeFilter } from "@/components/filters/shared-tab-filters";
import type { CinemaSelection } from "@/hooks/useCinemaSelection";
import { useSharedTabFilters } from "@/hooks/useSharedTabFilters";

/** Reads expo-router's `inheritFilters` param the way every page spells it. */
export function isInheritFiltersParam(value: string | string[] | undefined): boolean {
  return (Array.isArray(value) ? value[0] : value) === "1";
}

/**
 * True under a feed whose filters a page opened from it should start from —
 * the Films tab, and the showtime sheet when it was opened from there. A link
 * to a film, friend or cinema page spreads `useInheritFiltersParams()` into its
 * params; everywhere else it adds nothing and the page opens unfiltered.
 */
export const InheritFiltersContext = createContext(false);

const INHERIT_PARAMS = { inheritFilters: "1" } as const;
const NO_PARAMS = {} as const;

export function useInheritFiltersParams(): { inheritFilters?: "1" } {
  return useContext(InheritFiltersContext) ? INHERIT_PARAMS : NO_PARAMS;
}

export function usePageFilters(inherit: boolean) {
  const shared = useSharedTabFilters();
  // Captured once: a page copies the feed on the way in and is its own after.
  const [start] = useState(() => ({
    showtimeFilter: inherit ? shared.appliedShowtimeFilter : ("all" as SharedTabShowtimeFilter),
    watchlistOnly: inherit && shared.appliedWatchlistOnly,
    watchlistExclude: inherit && shared.watchlistExclude,
    hideWatched: inherit && shared.appliedHideWatched,
    watchedOnly: inherit && shared.watchedOnly,
    days: inherit ? shared.selectedDays : [],
    timeRanges: inherit ? shared.selectedTimeRanges : [],
    runtimeRanges: inherit ? shared.selectedRuntimeRanges : [],
    listIds: inherit ? shared.selectedListIds : [],
    excludeListIds: inherit ? shared.excludeListIds : [],
    languages: inherit ? shared.selectedLanguages : ([] as Language[]),
    // An empty selection is every cinema (see useCinemaSelection).
    cinemaIds: inherit ? shared.sessionCinemaIds : [],
  }));

  const [showtimeFilter, setSelectedShowtimeFilter] = useState(start.showtimeFilter);
  const [watchlistOnly, setWatchlistOnly] = useState(start.watchlistOnly);
  const [watchlistExclude, setWatchlistExclude] = useState(start.watchlistExclude);
  const [hideWatched, setHideWatched] = useState(start.hideWatched);
  const [watchedOnly, setWatchedOnly] = useState(start.watchedOnly);
  // Feed style, not a filter: it follows the feed either way.
  const [groupByMovie, setGroupByMovie] = useState(shared.appliedGroupByMovie);
  const [selectedDays, setSelectedDays] = useState<string[]>(start.days);
  const [selectedTimeRanges, setSelectedTimeRanges] = useState<string[]>(start.timeRanges);
  const [selectedRuntimeRanges, setSelectedRuntimeRanges] = useState<string[]>(
    start.runtimeRanges
  );
  const [selectedListIds, setSelectedListIds] = useState<string[]>(start.listIds);
  const [excludeListIds, setExcludeListIds] = useState<string[]>(start.excludeListIds);
  const [selectedLanguages, setSelectedLanguages] = useState<Language[]>(start.languages);
  const [cinemaIds, setCinemaIdsState] = useState<number[] | undefined>(start.cinemaIds);

  const setCinemaIds = useCallback((next: number[] | undefined) => {
    setCinemaIdsState(next === undefined ? undefined : [...next]);
  }, []);
  const cinemaScope = useMemo<CinemaSelection>(
    () => ({ cinemaIds, setCinemaIds }),
    [cinemaIds, setCinemaIds]
  );

  return {
    selectedShowtimeFilter: showtimeFilter,
    appliedShowtimeFilter: showtimeFilter,
    setSelectedShowtimeFilter,
    watchlistOnly,
    appliedWatchlistOnly: watchlistOnly,
    setWatchlistOnly,
    watchlistExclude,
    setWatchlistExclude,
    hideWatched,
    appliedHideWatched: hideWatched,
    setHideWatched,
    watchedOnly,
    setWatchedOnly,
    groupByMovie,
    appliedGroupByMovie: groupByMovie,
    setGroupByMovie,
    selectedDays,
    setSelectedDays,
    selectedTimeRanges,
    setSelectedTimeRanges,
    selectedRuntimeRanges,
    setSelectedRuntimeRanges,
    selectedListIds,
    setSelectedListIds,
    excludeListIds,
    setExcludeListIds,
    selectedLanguages,
    setSelectedLanguages,
    sessionCinemaIds: cinemaIds,
    setSessionCinemaIds: setCinemaIds,
    cinemaScope,
  };
}
