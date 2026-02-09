import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { MeService, MeGetSentFriendRequestsResponse } from "../client";

type UseFetchSentRequestsProps = {
    enabled?: boolean;
};

export function useFetchSentRequests(
    { enabled = true }: UseFetchSentRequestsProps = {}
): UseQueryResult<MeGetSentFriendRequestsResponse, Error>{
    const result = useQuery<MeGetSentFriendRequestsResponse, Error>({
        queryKey: ["users", "sentRequests"],
        enabled,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        queryFn: () => MeService.getSentFriendRequests(),
        staleTime: 0,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
