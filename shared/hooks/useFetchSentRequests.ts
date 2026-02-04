import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { MeService, MeGetSentFriendRequestsResponse } from "../client";


export function useFetchSentRequests(): UseQueryResult<MeGetSentFriendRequestsResponse, Error>{
    const result = useQuery<MeGetSentFriendRequestsResponse, Error>({
        queryKey: ["users", "sentRequests"],
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        queryFn: () => MeService.getSentFriendRequests(),
        staleTime: 0,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
