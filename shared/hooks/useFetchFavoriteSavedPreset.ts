import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { MeService, type SavedPresetPublic } from "../client";

export function useFetchFavoriteSavedPreset(): UseQueryResult<SavedPresetPublic | null, Error> {
  return useQuery<SavedPresetPublic | null, Error>({
    queryKey: ["user", "favorite_saved_preset"],
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: () => MeService.getFavoriteSavedPreset(),
    staleTime: 0,
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}
