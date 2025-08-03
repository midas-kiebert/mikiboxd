import { useQuery } from "@tanstack/react-query";
import { MeService, MeGetFriendsResponse } from "@/client";


export function useFetchFriends() {
    const result = useQuery<MeGetFriendsResponse, Error>({
        queryKey: ["users", "friends"],
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        queryFn: () => MeService.getFriends(),
        staleTime: 0,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
