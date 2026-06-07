import { useQuery, UseQueryResult } from "@tanstack/react-query";
import {
  MeService,
  type FilterPresetScope,
  type SavedPresetPublic,
} from "../client";

type UseFetchFavoriteSavedPresetInput = {
  scope: FilterPresetScope;
};

export function useFetchFavoriteSavedPreset({
  scope,
}: UseFetchFavoriteSavedPresetInput): UseQueryResult<SavedPresetPublic | null, Error> {
  return useQuery<SavedPresetPublic | null, Error>({
    queryKey: ["user", "favorite_saved_preset", scope],
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: () => MeService.getFavoriteSavedPreset({ scope }),
    staleTime: 0,
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}
