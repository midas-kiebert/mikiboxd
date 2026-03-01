import { useInfiniteQuery, InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { MeService, MeGetMyShowtimesResponse } from "../client";
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

type useFetchShowtimesProps = {
    limit?: number;
    snapshotTime?: string;
    filters?: ShowtimesFilters;
    enabled?: boolean;
};

export function useFetchMyShowtimes(
    {
        limit,
        snapshotTime,
        filters = {},
        enabled = true,
    } : useFetchShowtimesProps = {}
): UseInfiniteQueryResult<InfiniteData<MeGetMyShowtimesResponse>, Error>{
    const result = useInfiniteQuery<
        MeGetMyShowtimesResponse,
        Error,
        InfiniteData<MeGetMyShowtimesResponse>,
        [string, string, ShowtimesFilters],
        number
    >({
        queryKey: ["showtimes", "me", filters],
        enabled,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        initialPageParam: 0,
        queryFn: ({ pageParam = 0}) => {
            return MeService.getMyShowtimes({
                offset: pageParam,
                limit: limit,
                snapshotTime: snapshotTime,
                ...filters,
            });
        },
        select: (data) => {
            const seen = new Set<number>();
            const dedupedPages: MeGetMyShowtimesResponse[] = [];

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
