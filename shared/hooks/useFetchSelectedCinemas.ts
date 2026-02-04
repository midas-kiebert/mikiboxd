import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { MeService, MeGetCinemaSelectionsResponse } from "../client";

export function useFetchSelectedCinemas(): UseQueryResult<MeGetCinemaSelectionsResponse, Error>{
    const result = useQuery<MeGetCinemaSelectionsResponse, Error>({
        queryKey: ["user", "cinema_selections"],
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        queryFn: () => MeService.getCinemaSelections(),
        staleTime: 0,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
