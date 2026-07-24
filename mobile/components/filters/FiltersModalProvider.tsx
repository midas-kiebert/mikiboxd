/**
 * Layout-level provider that keeps one FiltersModal instance permanently mounted.
 * Screens call openFiltersModal() via the context hook to open it.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { DateTime } from 'luxon';
import { useQuery } from '@tanstack/react-query';
import useAuth from 'shared/hooks/useAuth';
import { MoviesService, ShowtimesService } from 'shared';
import { useSharedTabFilters } from '@/hooks/useSharedTabFilters';
import FiltersModal from '@/components/filters/FiltersModal';
import CinemaFilterModal from '@/components/filters/CinemaFilterModal';
import { getSelectedStatusesFromShowtimeFilter } from '@/components/filters/shared-tab-filters';
import { resolveDaySelectionsForApi } from '@/components/filters/day-filter-utils';
import { getRuntimeBoundsFromSelections } from '@/components/filters/runtime-range-utils';

type OpenConfig = { showGroupByMovie?: boolean; showPresets?: boolean };

type FiltersModalContextValue = {
  openFiltersModal: (config?: OpenConfig) => void;
  openCinemaModal: () => void;
};

const FiltersModalContext = createContext<FiltersModalContextValue>({
  openFiltersModal: () => {},
  openCinemaModal: () => {},
});

export function useFiltersModal() {
  return useContext(FiltersModalContext);
}

export function FiltersModalProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [showGroupByMovie, setShowGroupByMovieConfig] = useState(false);
  const [showPresets, setShowPresetsConfig] = useState(false);
  const [cinemaModalVisible, setCinemaModalVisible] = useState(false);

  const {
    selectedShowtimeFilter,
    setSelectedShowtimeFilter,
    watchlistOnly,
    setWatchlistOnly,
    hideWatched,
    setHideWatched,
    groupByMovie,
    setGroupByMovie,
    sessionCinemaIds,
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
    watchlistExclude,
    setWatchlistExclude,
    watchedOnly,
    setWatchedOnly,
  } = useSharedTabFilters();

  const { user } = useAuth();
  const hasLetterboxdUsername = Boolean(user?.letterboxd_username?.trim());
  const effectiveWatchlistOnly = hasLetterboxdUsername ? watchlistOnly : false;
  const effectiveHideWatched = hasLetterboxdUsername ? hideWatched : false;
  const effectiveWatchlistExclude = hasLetterboxdUsername ? watchlistExclude : false;
  const effectiveWatchedOnly = hasLetterboxdUsername ? watchedOnly : false;

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

  const isMovies = showGroupByMovie && groupByMovie;

  // Debounce the query mode flag so rapid toggling doesn't thrash query enable/disable
  // on iOS, which can cause a native crash without JS logs.
  const debouncedIsMovies = useDebounced(isMovies, 150);

  const countFilters = useMemo(() => ({
    selectedCinemaIds: sessionCinemaIds ?? undefined,
    days: resolvedApiDays && resolvedApiDays.length > 0 ? resolvedApiDays : undefined,
    timeRanges: selectedTimeRanges.length > 0 ? selectedTimeRanges : undefined,
    runtimeMin: runtimeBounds.runtimeMin,
    runtimeMax: runtimeBounds.runtimeMax,
    watchlistOnly: effectiveWatchlistOnly || undefined,
    hideWatched: effectiveHideWatched || undefined,
    watchlistExclude: effectiveWatchlistExclude || undefined,
    watchedOnly: effectiveWatchedOnly || undefined,
    selectedStatuses: getSelectedStatusesFromShowtimeFilter(selectedShowtimeFilter),
    selectedListIds: selectedListIds.length > 0 ? selectedListIds : undefined,
    excludeListIds: excludeListIds.length > 0 ? excludeListIds : undefined,
    selectedLanguages: selectedLanguages.length > 0 ? selectedLanguages : undefined,
  }), [sessionCinemaIds, resolvedApiDays, selectedTimeRanges, runtimeBounds, effectiveWatchlistOnly, effectiveHideWatched, effectiveWatchlistExclude, effectiveWatchedOnly, selectedShowtimeFilter, selectedListIds, excludeListIds, selectedLanguages]);

  const { data: showtimesCount } = useQuery({
    queryKey: ['count', 'showtimes', 'main', countFilters],
    queryFn: () => ShowtimesService.countMainPageShowtimes(countFilters),
    enabled: visible && !debouncedIsMovies,
    staleTime: 30_000,
  });

  const { data: moviesCount } = useQuery({
    queryKey: ['count', 'movies', countFilters],
    queryFn: () => MoviesService.countMovies(countFilters),
    enabled: visible && debouncedIsMovies,
    staleTime: 30_000,
  });

  const resultCount = isMovies ? moviesCount : showtimesCount;

  const openFiltersModal = useCallback((config?: OpenConfig) => {
    if (config?.showGroupByMovie !== undefined) setShowGroupByMovieConfig(config.showGroupByMovie);
    setShowPresetsConfig(config?.showPresets ?? false);
    setVisible(true);
  }, []);

  const openCinemaModal = useCallback(() => {
    setCinemaModalVisible(true);
  }, []);

  const handleCloseCinemaModal = useCallback(() => setCinemaModalVisible(false), []);
  const handleCloseFiltersModal = useCallback(() => setVisible(false), []);
  // Only show the back button (→ step back to Filters) when Filters is also open.
  const cinemaModalBack = visible ? handleCloseCinemaModal : undefined;

  return (
    <FiltersModalContext.Provider value={{ openFiltersModal, openCinemaModal }}>
      {children}
      <CinemaFilterModal
        visible={cinemaModalVisible}
        onClose={handleCloseCinemaModal}
        onBack={cinemaModalBack}
        initialPage="selection"
      />
      <FiltersModal
        visible={visible}
        onClose={handleCloseFiltersModal}
        groupByMovie={groupByMovie}
        setGroupByMovie={setGroupByMovie}
        showGroupByMovie={showGroupByMovie}
        showPresets={showPresets}
        watchlistOnly={effectiveWatchlistOnly}
        setWatchlistOnly={setWatchlistOnly}
        hideWatched={effectiveHideWatched}
        setHideWatched={setHideWatched}
        canUseWatchlistFilter={hasLetterboxdUsername}
        selectedShowtimeFilter={selectedShowtimeFilter}
        setSelectedShowtimeFilter={setSelectedShowtimeFilter}
        showStatusFilter
        selectedDays={selectedDays}
        setSelectedDays={setSelectedDays}
        selectedTimeRanges={selectedTimeRanges}
        setSelectedTimeRanges={setSelectedTimeRanges}
        selectedRuntimeRanges={selectedRuntimeRanges}
        setSelectedRuntimeRanges={setSelectedRuntimeRanges}
        selectedListIds={selectedListIds}
        setSelectedListIds={setSelectedListIds}
        excludeListIds={excludeListIds}
        setExcludeListIds={setExcludeListIds}
        selectedLanguages={selectedLanguages}
        setSelectedLanguages={setSelectedLanguages}
        watchlistExclude={effectiveWatchlistExclude}
        setWatchlistExclude={setWatchlistExclude}
        watchedOnly={effectiveWatchedOnly}
        setWatchedOnly={setWatchedOnly}
        showLists
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
