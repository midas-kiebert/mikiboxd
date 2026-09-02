import { useInfiniteQuery, useQueryClient, InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { MeService, MeGetMyShowtimesResponse } from "../client";
import type { GoingStatus } from "../client";
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
    const queryClient = useQueryClient();
    const result = useInfiniteQuery<
        MeGetMyShowtimesResponse,
        Error,
        InfiniteData<MeGetMyShowtimesResponse>,
        [string, string, string | undefined, ShowtimesFilters],
        number
    >({
        queryKey: ["showtimes", "me", snapshotTime, filters],
        enabled,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        initialPageParam: 0,
        queryFn: async ({ pageParam = 0 }) => {
            const page = await MeService.getMyShowtimes({
                offset: pageParam,
                limit: limit,
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
