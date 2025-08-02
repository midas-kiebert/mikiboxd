import { useQuery } from "@tanstack/react-query";
import { UsersService, UsersGetUserResponse } from "@/client";
import { UUID } from "crypto";

type useGetUserProps = {
    userId: UUID;
};

export function useGetUser(
    {
        userId,
    } : useGetUserProps
) {
    const result = useQuery<UsersGetUserResponse, Error>({
        queryKey: ["user", userId],
        queryFn: () => UsersService.getUser({
            userId: userId,
        }),
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        staleTime: 5 * 60 * 1000, // 5 minutes
        gcTime: 5 * 60 * 1000, // 5 minutes
    });
    return result;
}
