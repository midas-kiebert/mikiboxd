import { QueryClient, useQuery, UseQueryResult } from "@tanstack/react-query";
import { CinemasService, CinemasGetAllCinemasResponse } from "../client";

export const cinemasQueryKey = ["cinemas"] as const;

export const fetchCinemas = (): Promise<CinemasGetAllCinemasResponse> =>
    CinemasService.getAllCinemas();

/**
 * Warm the cinema list before something that needs it complete on its very
 * first frame (the intro's cinema picker, the cinema filter). The hook below
 * sets `refetchOnMount: false`, so a prefetched list is rendered as-is rather
 * than arriving a second after the screen it belongs to.
 */
export const prefetchCinemas = (queryClient: QueryClient): Promise<void> =>
    queryClient.prefetchQuery({
        queryKey: cinemasQueryKey,
        queryFn: fetchCinemas,
    });

export const useFetchCinemas = (): UseQueryResult<CinemasGetAllCinemasResponse, Error> => {
    const result = useQuery<CinemasGetAllCinemasResponse, Error>({
        queryKey: cinemasQueryKey,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        queryFn: fetchCinemas,
        staleTime: 0,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
