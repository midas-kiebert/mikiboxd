import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { MeService, MeGetBlockedUsersResponse } from "../client";

type UseFetchBlockedUsersProps = {
    enabled?: boolean;
};

/**
 * The current user's blocked accounts — the "who have I blocked" list behind
 * Settings, and the only place a blocked account is still reachable (to
 * unblock it; everywhere else it is filtered out of search, friends and
 * invites). Under the ["users", ...] key so it invalidates alongside every
 * other moderation and friend-status query (see mobile's useUserModeration).
 */
export const useFetchBlockedUsers = (
    { enabled = true }: UseFetchBlockedUsersProps = {}
): UseQueryResult<MeGetBlockedUsersResponse, Error> => {
    return useQuery<MeGetBlockedUsersResponse, Error>({
        queryKey: ["users", "blocked"],
        enabled,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        queryFn: () => MeService.getBlockedUsers(),
        staleTime: 0,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });
}
