import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { MeService, MeGetReceivedFriendRequestsResponse } from "../client";

type UseFetchReceivedRequestsProps = {
    enabled?: boolean;
    refetchIntervalMs?: number | false;
};

export function useFetchReceivedRequests(
    { enabled = true, refetchIntervalMs = 30000 }: UseFetchReceivedRequestsProps = {}
): UseQueryResult<MeGetReceivedFriendRequestsResponse, Error> {
    const result = useQuery<MeGetReceivedFriendRequestsResponse, Error>({
        queryKey: ["users", "receivedRequests"],
        enabled,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchInterval: enabled ? refetchIntervalMs : false,
        refetchIntervalInBackground: false,
        queryFn: () => MeService.getReceivedFriendRequests(),
        staleTime: 0,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
