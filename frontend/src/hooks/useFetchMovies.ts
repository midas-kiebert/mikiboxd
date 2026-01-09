import { useInfiniteQuery, InfiniteData } from "@tanstack/react-query";
import { MoviesService, MoviesReadMoviesResponse } from "@/client";
import { DateTime } from "luxon";

export type MovieFilters = {
    query?: string;
    watchlistOnly?: boolean;
    days?: string[];
};

type useFetchMoviesProps = {
    limit?: number;
    snapshotTime?: string;
    filters?: MovieFilters;
};


export function useFetchMovies(
    {
        limit = 20,
        snapshotTime = DateTime.now().setZone('Europe/Amsterdam').toFormat("yyyy-MM-dd'T'HH:mm:ss"),
        filters = {}
    }: useFetchMoviesProps = {}
) {
    const result = useInfiniteQuery<MoviesReadMoviesResponse, Error, InfiniteData<MoviesReadMoviesResponse>, [string, MovieFilters], number>({
        queryKey: ["movies", filters],
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        initialPageParam: 0,
        queryFn: ({ pageParam = 0 }) => {
            return MoviesService.readMovies({
                offset: pageParam,
                limit,
                snapshotTime,
                ...filters
            });
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
        getNextPageParam: (lastPage, allPages) =>
            lastPage.length === limit ? allPages.length * limit : undefined,
        staleTime: 5 * 60 * 1000,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
