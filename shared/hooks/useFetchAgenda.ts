import { useInfiniteQuery, useQueryClient, InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { MeService, MeGetMyAgendaResponse } from "../client";
import { seedShowtimeSeatAvailability } from "./useShowtimeSeatAvailability";
import { seedShowtimeVisibility } from "./useShowtimeVisibility";

type useFetchAgendaProps = {
    limit?: number;
    /**
     * Page size for the first page only. Defaults to `limit`.
     *
     * Same reasoning as `useFetchMainPageShowtimes`: the first page is the one
     * that always runs, and often the only one anyone scrolls to.
     */
    firstPageLimit?: number;
    snapshotTime?: string;
    includeInterested?: boolean;
    includeInvited?: boolean;
    enabled?: boolean;
};

export function useFetchAgenda(
    {
        limit,
        firstPageLimit = limit,
        snapshotTime,
        includeInterested = true,
        includeInvited = true,
        enabled = true,
    } : useFetchAgendaProps = {}
): UseInfiniteQueryResult<InfiniteData<MeGetMyAgendaResponse>, Error>{
    const queryClient = useQueryClient();
    const result = useInfiniteQuery<
        MeGetMyAgendaResponse,
        Error,
        InfiniteData<MeGetMyAgendaResponse>,
        [string, string, string | undefined, { includeInterested: boolean; includeInvited: boolean }],
        number
    >({
        queryKey: ["showtimes", "agenda", snapshotTime, { includeInterested, includeInvited }],
        enabled,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        initialPageParam: 0,
        queryFn: async ({ pageParam = 0 }) => {
            const page = await MeService.getMyAgenda({
                offset: pageParam,
                // Offset zero is the first page, and nothing else can be: the
                // offsets below are cumulative row counts, which only start at
                // zero before anything has been fetched.
                limit: pageParam === 0 ? firstPageLimit : limit,
                snapshotTime: snapshotTime,
                includeInterested,
                includeInvited,
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
            const dedupedPages: MeGetMyAgendaResponse[] = [];

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
