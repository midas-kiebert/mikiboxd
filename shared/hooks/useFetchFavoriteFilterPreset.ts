import { useQuery, UseQueryResult } from "@tanstack/react-query";
import {
  MeService,
  type FilterPresetPublic,
  type FilterPresetScope,
} from "../client";

type UseFetchFavoriteFilterPresetInput = {
  scope: FilterPresetScope;
};

export function useFetchFavoriteFilterPreset({
  scope,
}: UseFetchFavoriteFilterPresetInput): UseQueryResult<FilterPresetPublic | null, Error> {
  return useQuery<FilterPresetPublic | null, Error>({
    queryKey: ["user", "favorite_filter_preset", scope],
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: () => MeService.getFavoriteFilterPreset({ scope }),
    staleTime: 0,
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}
