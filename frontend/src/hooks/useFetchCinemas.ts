import { useQuery } from "@tanstack/react-query";
import { CinemasService, CinemasGetAllCinemasResponse } from "@/client";


export function useFetchCinemas() {
    const result = useQuery<CinemasGetAllCinemasResponse, Error>({
        queryKey: ["cinemas"],
        refetchOnMount: false,
        refetchOnWindowFocus: false,
        queryFn: () => CinemasService.getAllCinemas(),
        staleTime: 0,
        gcTime: 5 * 60 * 1000, // 5 minutes
    });

    return result;
}
