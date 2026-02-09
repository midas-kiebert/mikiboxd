import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { MeService, MeGetFriendsResponse } from "../client";

type UseFetchFriendsProps = {
    enabled?: boolean;
};

export const useFetchFriends = ({ enabled = true }: UseFetchFriendsProps = {}): UseQueryResult<MeGetFriendsResponse, Error> => {
    const result = useQuery<MeGetFriendsResponse, Error>({
        queryKey: ["users", "friends"],
        enabled,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        queryFn: () => MeService.getFriends(),
        staleTime: 0,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
