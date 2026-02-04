import { useInfiniteQuery, InfiniteData, UseInfiniteQueryResult } from "@tanstack/react-query";
import { UsersService, UsersGetUserSelectedShowtimesResponse } from "../client";
import { UUID } from "crypto";
import { ApiError } from "../client";

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
): UseInfiniteQueryResult<InfiniteData<UsersGetUserSelectedShowtimesResponse>, Error>{
    const result = useInfiniteQuery<UsersGetUserSelectedShowtimesResponse, Error, InfiniteData<UsersGetUserSelectedShowtimesResponse>, [string, string], number>({
        queryKey: ["showtimes", userId],
        refetchOnMount: false,
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
