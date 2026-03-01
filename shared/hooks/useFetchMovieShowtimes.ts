import { useInfiniteQuery, InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { MoviesService, MoviesReadMovieShowtimesResponse } from "../client";
import { ApiError } from "../client";
import type { GoingStatus } from "../client";

type ShowtimesFilters = {
    query?: string;
    days?: string[];
    selectedCinemaIds?: number[];
    timeRanges?: string[];
    runtimeMin?: number;
    runtimeMax?: number;
    watchlistOnly?: boolean;
    selectedStatuses?: GoingStatus[];
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
    const result = useInfiniteQuery<
        MoviesReadMovieShowtimesResponse,
        Error,
        InfiniteData<MoviesReadMovieShowtimesResponse>,
        [string, number, string, ShowtimesFilters],
        number
    >({
        queryKey: ["movie", movieId, "showtimes", filters],
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        initialPageParam: 0,
        enabled: Number.isFinite(movieId) && movieId > 0,
        queryFn: ({ pageParam = 0}) => {
            return MoviesService.readMovieShowtimes({
                offset: pageParam,
                limit: limit,
                snapshotTime: snapshotTime,
                id: movieId,
                ...filters,
            });
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
        staleTime: 0,
        gcTime: 5 * 60 * 1000,
    });

    return result;
}
