import { useInfiniteQuery } from "@tanstack/react-query";
import { UsersService, UsersSearchUsersResponse } from "@/client";
import { InfiniteData } from "@tanstack/react-query";

export type UserFilters = {
    query: string;
};

type useFetchUsersProps = {
    limit: number;
    filters?: UserFilters;
};


export function useFetchUsers(
    {
        limit = 20,
        filters = {
            query: ""
        }
    }: useFetchUsersProps
    ) {
    const result = useInfiniteQuery<UsersSearchUsersResponse, Error, InfiniteData<UsersSearchUsersResponse>, [string, UserFilters], number>({
        queryKey: ["movies", filters],
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        initialPageParam: 0,
        queryFn: ({ pageParam = 0 }) => {
            return UsersService.searchUsers({
                offset: pageParam,
                limit,
                ...filters
            });
        },
        select: (data) => {
            const seen = new Set<string>();
            const dedupedPages: UsersSearchUsersResponse[] = [];

            for (const page of data.pages) {
                const filteredPage = page.filter((user) => {
                    if (seen.has(user.id)) return false;
                    seen.add(user.id);
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
