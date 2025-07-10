import { useQuery } from "@tanstack/react-query";
import { MeService, MeGetMyShowtimesResponse } from "@/client";

export default function useIsShowtimeSelected(id: number) {
    const { data, isLoading } = useQuery<MeGetMyShowtimesResponse, Error>({
        queryKey: ["selectShowtime"],
        queryFn: () => MeService.getMyShowtimes(),
    });

    const isSelected = data?.some(showtime => showtime.id === id);

    return {isSelected, isLoading };
}