/**
 * Shared data access for cinema presets — named cinema selections the user can
 * switch between. Kept in one place so the cinema filter sheet, the cinema
 * preset tip and anything checking "does this user have presets yet?" all read
 * and invalidate the same cache entry.
 */
import { useQuery, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { MeService, type CinemaPresetPublic } from "shared";

export const cinemaPresetsQueryKey = ["cinema-presets"] as const;

/** The selection query too: creating a preset can change the active selection. */
const cinemaSelectionsQueryKey = ["user", "cinema_selections"] as const;

type UseCinemaPresetsOptions = {
  /** Skip the request until the caller actually needs the presets. */
  enabled?: boolean;
};

export const useCinemaPresets = (
  options: UseCinemaPresetsOptions = {}
): UseQueryResult<CinemaPresetPublic[], Error> =>
  useQuery({
    queryKey: cinemaPresetsQueryKey,
    enabled: options.enabled ?? true,
    queryFn: () => MeService.getCinemaPresets(),
  });

/** Refresh everything a preset write can affect. */
export const invalidateCinemaPresets = (queryClient: QueryClient): void => {
  queryClient.invalidateQueries({ queryKey: cinemaPresetsQueryKey });
  queryClient.invalidateQueries({ queryKey: cinemaSelectionsQueryKey });
};
