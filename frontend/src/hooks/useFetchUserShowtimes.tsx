import { useInfiniteQuery, InfiniteData } from "@tanstack/react-query";
import { UsersService, UsersGetUserSelectedShowtimesResponse } from "@/client";
import { UUID } from "crypto";

type useFetchUserShowtimesProps = {
    limit?: number;
    snapshotTime?: string;
    userId: UUID;
};

export function useFetchUserShowtimes(
    {
        limit,
        snapshotTime,
        userId,
    } : useFetchUserShowtimesProps
) {
    const result = useInfiniteQuery<UsersGetUserSelectedShowtimesResponse, Error, InfiniteData<UsersGetUserSelectedShowtimesResponse>, [string], number>({
        queryKey: ["showtimes"],
        refetchOnMount: true,
        refetchOnWindowFocus: false,
        initialPageParam: 0,
        queryFn: ({ pageParam = 0}) => {
            return UsersService.getUserSelectedShowtimes({
                offset: pageParam,
                limit: limit,
                snapshotTime: snapshotTime,
                userId: userId,
            });
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
