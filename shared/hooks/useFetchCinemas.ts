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
        // Long, because the list is warmed at launch and then sat on: the intro's
        // picker can be a good few minutes behind the prefetch (signup, social
        // sign-in, picking a username), and a 5-minute window threw the warm list
        // away right before the one screen it was fetched for.
        gcTime: 30 * 60 * 1000, // 30 minutes
    });

    return result;
}
