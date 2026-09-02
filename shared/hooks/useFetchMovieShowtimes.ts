import { useInfiniteQuery, useQueryClient, keepPreviousData, InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { MoviesService, MoviesReadMovieShowtimesResponse } from "../client";
import { ApiError } from "../client";
import type { GoingStatus, Language } from "../client";
import { seedShowtimeSeatAvailability } from "./useShowtimeSeatAvailability";
import { seedShowtimeVisibility } from "./useShowtimeVisibility";

type ShowtimesFilters = {
    query?: string;
    days?: string[];
    selectedCinemaIds?: number[];
    timeRanges?: string[];
    runtimeMin?: number;
    runtimeMax?: number;
    watchlistOnly?: boolean;
    hideWatched?: boolean;
    selectedStatuses?: GoingStatus[];
    selectedLanguages?: Language[];
};

type useFetchMovieShowtimesProps = {
    movieId: number;
    limit?: number;
    snapshotTime?: string;
    filters?: ShowtimesFilters;
};

export function useFetchMovieShowtimes(
    {
        movieId,
        limit = 20,
        snapshotTime,
        filters = {},
    } : useFetchMovieShowtimesProps
): UseInfiniteQueryResult<InfiniteData<MoviesReadMovieShowtimesResponse>, Error>{
    const queryClient = useQueryClient();
    const result = useInfiniteQuery<
        MoviesReadMovieShowtimesResponse,
        Error,
        InfiniteData<MoviesReadMovieShowtimesResponse>,
        [string, number, string, string | undefined, ShowtimesFilters],
        number
    >({
        queryKey: ["movie", movieId, "showtimes", snapshotTime, filters],
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        initialPageParam: 0,
        // `!== 0` (not `> 0`): synthetic listings like sneak previews use
        // negative movie ids. 0 and NaN remain invalid.
        enabled: Number.isFinite(movieId) && movieId !== 0,
        queryFn: async ({ pageParam = 0 }) => {
            const page = await MoviesService.readMovieShowtimes({
                offset: pageParam,
                limit: limit,
                snapshotTime: snapshotTime,
                id: movieId,
                ...filters,
            });
            // The badges read this cache, so filling it here — with what the
            // page itself already carries — is what lets them paint with the
            // cards instead of a request later. See `seedShowtimeSeatAvailability`.
            seedShowtimeSeatAvailability(queryClient, page);
            // Listed under the movie, so these showtimes carry no movie of
            // their own — it is the one this screen is about.
            seedShowtimeVisibility(queryClient, page, { movieId });
            return page;
        },
        retry: (failureCount, error) => {
            if (error instanceof ApiError && error.status === 403) {
                return false;
            }
            return failureCount < 3;
        },
        select: (data) => {
            const seen = new Set<number>();
            const dedupedPages: MoviesReadMovieShowtimesResponse[] = [];

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
        getNextPageParam: (lastPage, allPages) =>
            lastPage.length === limit ? allPages.length * limit : undefined,
        placeholderData: keepPreviousData,
        staleTime: 0,
        gcTime: 5 * 60 * 1000,
    });

    return result;
}
