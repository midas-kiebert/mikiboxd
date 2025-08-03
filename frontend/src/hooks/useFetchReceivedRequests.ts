import { useQuery } from "@tanstack/react-query";
import { MeService, MeGetReceivedFriendRequestsResponse } from "@/client";


export function useFetchReceivedRequests() {
    const result = useQuery<MeGetReceivedFriendRequestsResponse, Error>({
        queryKey: ["users", "receivedRequests"],
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        queryFn: () => MeService.getReceivedFriendRequests(),
        staleTime: 0,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
