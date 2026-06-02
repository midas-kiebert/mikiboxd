/**
 * Layout-level provider that keeps one FiltersModal instance permanently mounted.
 * Screens call openFiltersModal() via the context hook to open it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DateTime } from 'luxon';
import { useQuery } from '@tanstack/react-query';
import useAuth from 'shared/hooks/useAuth';
import { MeService, MoviesService, ShowtimesService } from 'shared';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
import FiltersModal from '@/components/filters/FiltersModal';
import {
  SHARED_TAB_FILTER_PRESET_SCOPE,
  getSelectedStatusesFromShowtimeFilter,
} from '@/components/filters/shared-tab-filters';
import { type PageFilterPresetState } from '@/components/filters/FilterPresetsModal';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import { getRuntimeBoundsFromSelections } from '@/components/filters/runtime-range-utils';

type OpenConfig = { showGroupByMovie?: boolean };

type FiltersModalContextValue = {
  openFiltersModal: (config?: OpenConfig) => void;
};

const FiltersModalContext = createContext<FiltersModalContextValue>({
  openFiltersModal: () => {},
});

export function useFiltersModal() {
  return useContext(FiltersModalContext);
}

export function FiltersModalProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [showGroupByMovie, setShowGroupByMovieConfig] = useState(false);

  const {
    selectedShowtimeFilter,
    setSelectedShowtimeFilter,
    selectedShowtimeAudience,
    setSelectedShowtimeAudience,
    watchlistOnly,
    setWatchlistOnly,
    groupByMovie,
    setGroupByMovie,
    sessionCinemaIds,
    selectedDays,
    setSelectedDays,
    selectedTimeRanges,
    setSelectedTimeRanges,
    selectedRuntimeRanges,
    setSelectedRuntimeRanges,
  } = useSharedTabFilters();

  const { user } = useAuth();
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  const effectiveWatchlistOnly = hasLetterboxdUsername ? watchlistOnly : false;

  const currentPresetFilters = useMemo<PageFilterPresetState>(
    () => ({
      selected_showtime_filter: selectedShowtimeFilter,
      showtime_audience: selectedShowtimeAudience,
      watchlist_only: effectiveWatchlistOnly,
      days: selectedDays.length > 0 ? selectedDays : null,
      time_ranges: selectedTimeRanges.length > 0 ? selectedTimeRanges : null,
      runtime_ranges: selectedRuntimeRanges.length > 0 ? selectedRuntimeRanges : null,
    }),
    [selectedShowtimeFilter, selectedShowtimeAudience, effectiveWatchlistOnly, selectedDays, selectedTimeRanges, selectedRuntimeRanges]
  );

  const dayAnchorKey =
    DateTime.now().setZone('Europe/Amsterdam').startOf('day').toISODate() ?? '';
  const resolvedApiDays = useMemo(
    () => resolveDaySelectionsForApi(selectedDays),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayAnchorKey, selectedDays]
  );
  const runtimeBounds = useMemo(
    () => getRuntimeBoundsFromSelections(selectedRuntimeRanges),
    [selectedRuntimeRanges]
  );

  const shouldShowAudienceToggle = selectedShowtimeFilter !== 'all';
  const isMyShowtimes = shouldShowAudienceToggle && selectedShowtimeAudience === 'only-you';
  const isMovies = showGroupByMovie && groupByMovie;

  // Debounce the query mode flags so rapid toggling doesn't thrash query enable/disable
  // on iOS, which can cause a native crash without JS logs.
  const debouncedIsMovies = useDebounced(isMovies, 150);
  const debouncedIsMyShowtimes = useDebounced(isMyShowtimes, 150);

  const countFilters = useMemo(() => ({
    selectedCinemaIds: sessionCinemaIds ?? undefined,
    days: resolvedApiDays && resolvedApiDays.length > 0 ? resolvedApiDays : undefined,
    timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
    runtimeMin: runtimeBounds.runtimeMin,
    runtimeMax: runtimeBounds.runtimeMax,
    watchlistOnly: effectiveWatchlistOnly || undefined,
    selectedStatuses: getSelectedStatusesFromShowtimeFilter(selectedShowtimeFilter),
  }), [sessionCinemaIds, resolvedApiDays, selectedTimeRanges, runtimeBounds, effectiveWatchlistOnly, selectedShowtimeFilter]);

  const { data: showtimesCount } = useQuery({
    queryKey: ['count', 'showtimes', 'main', countFilters],
    queryFn: () => ShowtimesService.countMainPageShowtimes(countFilters),
    enabled: visible && !debouncedIsMyShowtimes && !debouncedIsMovies,
    staleTime: 30_000,
  });

  const { data: myShowtimesCount } = useQuery({
    queryKey: ['count', 'showtimes', 'me', countFilters],
    queryFn: () => MeService.countMyShowtimes(countFilters),
    enabled: visible && debouncedIsMyShowtimes && !debouncedIsMovies,
    staleTime: 30_000,
  });

  const { data: moviesCount } = useQuery({
    queryKey: ['count', 'movies', countFilters],
    queryFn: () => MoviesService.countMovies(countFilters),
    enabled: visible && debouncedIsMovies,
    staleTime: 30_000,
  });

  const resultCount = isMovies ? moviesCount : isMyShowtimes ? myShowtimesCount : showtimesCount;

  const openFiltersModal = useCallback((config?: OpenConfig) => {
    if (config?.showGroupByMovie !== undefined) setShowGroupByMovieConfig(config.showGroupByMovie);
    setVisible(true);
  }, []);

  return (
    <FiltersModalContext.Provider value={{ openFiltersModal }}>
      {children}
      <FiltersModal
        visible={visible}
        onClose={() => setVisible(false)}
        scope={SHARED_TAB_FILTER_PRESET_SCOPE}
        groupByMovie={groupByMovie}
        setGroupByMovie={setGroupByMovie}
        showGroupByMovie={showGroupByMovie}
        watchlistOnly={effectiveWatchlistOnly}
        setWatchlistOnly={setWatchlistOnly}
        canUseWatchlistFilter={hasLetterboxdUsername}
        selectedShowtimeFilter={selectedShowtimeFilter}
        setSelectedShowtimeFilter={setSelectedShowtimeFilter}
        showStatusFilter
        selectedShowtimeAudience={selectedShowtimeAudience}
        setSelectedShowtimeAudience={setSelectedShowtimeAudience}
        selectedDays={selectedDays}
        setSelectedDays={setSelectedDays}
        selectedTimeRanges={selectedTimeRanges}
        setSelectedTimeRanges={setSelectedTimeRanges}
        selectedRuntimeRanges={selectedRuntimeRanges}
        setSelectedRuntimeRanges={setSelectedRuntimeRanges}
        currentPresetFilters={currentPresetFilters}
        resultCount={resultCount}
      />
    </FiltersModalContext.Provider>
  );
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setDebounced(value), delay);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [value, delay]);
  return debounced;
}
