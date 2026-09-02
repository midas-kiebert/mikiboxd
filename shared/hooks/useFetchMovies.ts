import { useInfiniteQuery, useQueryClient, InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { MoviesService, MoviesReadMoviesResponse } from "../client";
import type { GoingStatus, Language, SearchField } from "../client";
import { seedShowtimeSeatAvailability } from "./useShowtimeSeatAvailability";
import { seedShowtimeVisibility } from "./useShowtimeVisibility";

export type MovieFilters = {
    query?: string;
    searchField?: SearchField;
    watchlistOnly?: boolean;
    watchlistExclude?: boolean;
    hideWatched?: boolean;
    watchedOnly?: boolean;
    days?: string[];
    selectedCinemaIds?: number[];
    timeRanges?: string[];
    runtimeMin?: number;
    runtimeMax?: number;
    selectedStatuses?: GoingStatus[];
    selectedListIds?: string[];
    excludeListIds?: string[];
    selectedLanguages?: Language[];
};

type useFetchMoviesProps = {
    limit?: number;
    /**
     * Page size for the first page only. Defaults to `limit`.
     *
     * The first page is the one page that is always fetched, and on a filtered
     * feed it is very often the only one anybody looks at — four or five cards
     * fit a phone screen, so the rest of a full page is query, payload and
     * parse spent on a scroll that never happens. Later pages stay large: by
     * then the user is scrolling, and a big page is what keeps them from
     * meeting the loader again.
     */
    firstPageLimit?: number;
    snapshotTime?: string;
    filters?: MovieFilters;
    enabled?: boolean;
};


export function useFetchMovies(
    {
        limit = 15,
        firstPageLimit = limit,
        snapshotTime,
        filters = {},
        enabled = true,
    }: useFetchMoviesProps = {}
): UseInfiniteQueryResult<InfiniteData<MoviesReadMoviesResponse>, Error>{
    const queryClient = useQueryClient();
    const result = useInfiniteQuery<MoviesReadMoviesResponse, Error, InfiniteData<MoviesReadMoviesResponse>, [string, string | undefined, MovieFilters], number>({
        queryKey: ["movies", snapshotTime, filters],
        enabled,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        initialPageParam: 0,
        queryFn: async ({ pageParam = 0 }) => {
            const page = await MoviesService.readMovies({
                offset: pageParam,
                // Offset zero is the first page, and nothing else can be: the
                // offsets below are cumulative row counts, which only start at
                // zero before anything has been fetched.
                limit: pageParam === 0 ? firstPageLimit : limit,
                snapshotTime,
                ...filters
            });
            // A movie card lists its own showtimes, each carrying how full it
            // is, so the busyness icons can be cached straight off the payload
            // rather than fetched once the cards are already on screen.
            seedShowtimeSeatAvailability(
                queryClient,
                page.flatMap((movie) => movie.showtimes),
            );
            for (const movie of page) {
                seedShowtimeVisibility(queryClient, movie.showtimes, {
                    movieId: movie.id,
                });
            }
            return page;
        },
        select: (data) => {
            const seen = new Set<number>();
            const dedupedPages: MoviesReadMoviesResponse[] = [];

            for (const page of data.pages) {
                const filteredPage = page.filter((movie) => {
                    if (seen.has(movie.id)) return false;
                    seen.add(movie.id);
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
            if (lastPage.length < requested) return undefined;
            return allPages.reduce((total, page) => total + page.length, 0);
        },
        staleTime: 5 * 60 * 1000,
        gcTime: 5 * 60 * 1000,
    });

    return result;
}
