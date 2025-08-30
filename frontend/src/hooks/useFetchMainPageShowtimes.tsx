import { useInfiniteQuery, InfiniteData } from "@tanstack/react-query";
import { ShowtimesService, ShowtimesGetMainPageShowtimesResponse } from "@/client";
import { ApiError } from "@/client";

type useFetchMainPageShowtimesProps = {
    limit?: number;
    snapshotTime?: string;
};

export function useFetchMainPageShowtimes(
    {
        limit,
        snapshotTime,
    } : useFetchMainPageShowtimesProps
) {
    const result = useInfiniteQuery<ShowtimesGetMainPageShowtimesResponse, Error, InfiniteData<ShowtimesGetMainPageShowtimesResponse>, [string], number>({
        queryKey: ["showtimes"],
        refetchOnMount: true,
        refetchOnWindowFocus: false,
        initialPageParam: 0,
        queryFn: ({ pageParam = 0}) => {
            return ShowtimesService.getMainPageShowtimes({
                offset: pageParam,
                limit: limit,
                snapshotTime: snapshotTime,
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
        getNextPageParam: (lastPage, allPages) =>
            lastPage.length === limit ? allPages.length * limit : undefined,
        staleTime: 0,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
