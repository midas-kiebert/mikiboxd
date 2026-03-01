import { useInfiniteQuery, InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import {
    ApiError,
    type GoingStatus,
    UsersService,
    UsersGetUserSelectedShowtimesResponse,
} from "../client";

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

type useFetchUserShowtimesProps = {
    limit?: number;
    snapshotTime?: string;
    userId: string;
    filters?: ShowtimesFilters;
    enabled?: boolean;
};

export function useFetchUserShowtimes(
    {
        limit,
        snapshotTime,
        userId,
        filters = {},
        enabled = true,
    } : useFetchUserShowtimesProps
): UseInfiniteQueryResult<InfiniteData<UsersGetUserSelectedShowtimesResponse>, Error>{
    const result = useInfiniteQuery<
        UsersGetUserSelectedShowtimesResponse,
        Error,
        InfiniteData<UsersGetUserSelectedShowtimesResponse>,
        [string, string, string, ShowtimesFilters],
        number
    >({
        queryKey: ["showtimes", "user", userId, filters],
        enabled,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        initialPageParam: 0,
        queryFn: ({ pageParam = 0}) => {
            return UsersService.getUserSelectedShowtimes({
                offset: pageParam,
                limit: limit,
                snapshotTime: snapshotTime,
                userId: userId,
                ...filters,
            });
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
            const dedupedPages: UsersGetUserSelectedShowtimesResponse[] = [];

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
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
