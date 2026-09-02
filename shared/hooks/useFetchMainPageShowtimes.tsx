import { useInfiniteQuery, useQueryClient, InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { ShowtimesService, ShowtimesGetMainPageShowtimesResponse } from "../client";
import { ApiError } from "../client";
import type { GoingStatus, Language, SearchField } from "../client";
import { seedShowtimeSeatAvailability } from "./useShowtimeSeatAvailability";
import { seedShowtimeVisibility } from "./useShowtimeVisibility";

type ShowtimesFilters = {
    query?: string;
    searchField?: SearchField;
    days?: string[];
    selectedCinemaIds?: number[];
    timeRanges?: string[];
    runtimeMin?: number;
    runtimeMax?: number;
    watchlistOnly?: boolean;
    watchlistExclude?: boolean;
    hideWatched?: boolean;
    watchedOnly?: boolean;
    selectedStatuses?: GoingStatus[];
    friendsOnly?: boolean;
    allCinemas?: boolean;
    selectedListIds?: string[];
    excludeListIds?: string[];
    selectedLanguages?: Language[];
};

type useFetchMainPageShowtimesProps = {
    limit?: number;
    /**
     * Page size for the first page only. Defaults to `limit`.
     *
     * The first page is the one page that is always fetched, and on a filtered
     * feed it is very often the only one anybody looks at — four or five cards
     * fit a phone screen, so a full page of twenty is fifteen rows of query,
     * payload and prefetch spent on a scroll that never happens. Later pages
     * stay large: by then the user is scrolling, and a big page is what keeps
     * them from meeting the loader again.
     */
    firstPageLimit?: number;
    snapshotTime?: string;
    filters?: ShowtimesFilters;
    enabled?: boolean;
};

export function useFetchMainPageShowtimes(
    {
        limit,
        firstPageLimit = limit,
        snapshotTime,
        filters = {},
        enabled = true,
    } : useFetchMainPageShowtimesProps
): UseInfiniteQueryResult<InfiniteData<ShowtimesGetMainPageShowtimesResponse>, Error>{
    const queryClient = useQueryClient();
    const result = useInfiniteQuery<
        ShowtimesGetMainPageShowtimesResponse,
        Error,
        InfiniteData<ShowtimesGetMainPageShowtimesResponse>,
        [string, string, string | undefined, ShowtimesFilters],
        number
    >({
        queryKey: ["showtimes", "main", snapshotTime, filters],
        enabled,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        initialPageParam: 0,
        queryFn: async ({ pageParam = 0 }) => {
            const page = await ShowtimesService.getMainPageShowtimes({
                offset: pageParam,
                // Offset zero is the first page, and nothing else can be: the
                // offsets below are cumulative row counts, which only start at
                // zero before anything has been fetched.
                limit: pageParam === 0 ? firstPageLimit : limit,
                snapshotTime: snapshotTime,
                ...filters,
            });
            // The badges read this cache, so filling it here — with what the
            // page itself already carries — is what lets them paint with the
            // cards instead of a request later. See `seedShowtimeSeatAvailability`.
            seedShowtimeSeatAvailability(queryClient, page);
            seedShowtimeVisibility(queryClient, page);
            return page;
        },
        retry: (failureCount, error) => {
            if (error instanceof ApiError && error.status === 403) {
                // If we get a 403 error, we don't want to retry
                return false;
            }
            return failureCount < 3; // Retry up to 3 times for other errors
        },
        select: (data) => {
            const seen = new Set<number>();
            const dedupedPages: ShowtimesGetMainPageShowtimesResponse[] = [];

            for (const page of data.pages) {
                const filteredPage = page.filter((showtime) => {
                    if (seen.has(showtime.id)) return false;
                    seen.add(showtime.id);
                    return true;
                });
                dedupedPages.push(filteredPage);
            }
            return {
                ...data,
                pages: dedupedPages,
            };
        },
        // Summed rather than `allPages.length * limit`, which assumes every
        // page is the same size and would skip or repeat rows the moment the
        // first one is not. A short page means the end of the results.
        getNextPageParam: (lastPage, allPages) => {
            const requested = allPages.length === 1 ? firstPageLimit : limit;
            if (requested === undefined || lastPage.length < requested) return undefined;
            return allPages.reduce((total, page) => total + page.length, 0);
        },
        staleTime: 0,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
