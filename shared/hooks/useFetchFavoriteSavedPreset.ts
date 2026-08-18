import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { MeService, type SavedPresetPublic } from "../client";

type UseFetchFavoriteSavedPresetProps = {
  /** Off for a signed-out visitor: this reads an account that isn't there. */
  enabled?: boolean;
};

export function useFetchFavoriteSavedPreset(
  { enabled = true }: UseFetchFavoriteSavedPresetProps = {}
): UseQueryResult<SavedPresetPublic | null, Error> {
  return useQuery<SavedPresetPublic | null, Error>({
    queryKey: ["user", "favorite_saved_preset"],
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: () => MeService.getFavoriteSavedPreset(),
    enabled,
    staleTime: 0,
    gcTime: 5 * 60 * 1000, // 5 minutes
  });
}
