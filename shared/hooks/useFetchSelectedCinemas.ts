import { QueryClient, useQuery, UseQueryResult } from "@tanstack/react-query";
import { MeService, MeGetCinemaSelectionsResponse } from "../client";

export const selectedCinemasQueryKey = ["user", "cinema_selections"] as const;

export const fetchSelectedCinemas = (): Promise<MeGetCinemaSelectionsResponse> =>
    MeService.getCinemaSelections();

/**
 * Companion to `prefetchCinemas`: the account's saved picks, so a picker that
 * seeds itself from them opens already ticked instead of filling in later.
 */
export const prefetchSelectedCinemas = (queryClient: QueryClient): Promise<void> =>
    queryClient.prefetchQuery({
        queryKey: selectedCinemasQueryKey,
        queryFn: fetchSelectedCinemas,
    });

type UseFetchSelectedCinemasProps = {
    /** Off for a signed-out visitor: this reads an account that isn't there. */
    enabled?: boolean;
};

export function useFetchSelectedCinemas(
    { enabled = true }: UseFetchSelectedCinemasProps = {}
): UseQueryResult<MeGetCinemaSelectionsResponse, Error>{
    const result = useQuery<MeGetCinemaSelectionsResponse, Error>({
        queryKey: selectedCinemasQueryKey,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        queryFn: fetchSelectedCinemas,
        enabled,
        staleTime: 0,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
