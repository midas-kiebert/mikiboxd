/**
 * Shared data access for cinema presets — named cinema selections the user can
 * switch between. Kept in one place so the cinema filter sheet, the cinema
 * preset tip and anything checking "does this user have presets yet?" all read
 * and invalidate the same cache entry.
 */
import { useQuery, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { MeService, type CinemaPresetPublic } from "shared";

import { displayPresetsQueryKey } from "@/components/filters/saved-presets";

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

/**
 * Refresh everything a preset write can affect — including any saved (filter)
 * preset that follows one of these by `cinema_preset_id`: its resolved cinema
 * list is read fresh from the backend on every fetch, but the display-presets
 * query caches that resolved value, so editing a cinema preset has to bust it
 * too or a linked saved preset keeps showing the pre-edit cinemas.
 */
export const invalidateCinemaPresets = (queryClient: QueryClient): void => {
  queryClient.invalidateQueries({ queryKey: cinemaPresetsQueryKey });
  queryClient.invalidateQueries({ queryKey: cinemaSelectionsQueryKey });
  queryClient.invalidateQueries({ queryKey: displayPresetsQueryKey });
};

/**
 * The one preset every account has: the cinemas the user actually goes to,
 * applied on startup. It is a real preset row, told apart by `is_favorite` and
 * never by its name — the user can rename it, and the backend has shipped three
 * different auto-generated names for it over time.
 */
export const findMyCinemasPreset = (
  presets: readonly CinemaPresetPublic[]
): CinemaPresetPublic | null => presets.find((preset) => preset.is_favorite) ?? null;

/**
 * The presets the user deliberately named and can manage: everything except
 * their cinemas and the synthetic "All cinemas" row, which has no database row
 * behind it and so can be neither renamed nor deleted.
 */
export const findNamedCinemaPresets = (
  presets: readonly CinemaPresetPublic[]
): CinemaPresetPublic[] =>
  presets.filter((preset) => !preset.is_default && !preset.is_favorite);

const GENERATED_PRESET_NAME_PREFIX = "Preset";

/**
 * "Preset 1", or the first number after it that is free.
 *
 * The name field is prefilled with this so saving a preset never *requires*
 * typing: an empty box that blocks the save button is what made the feature
 * read as a mistake rather than a choice.
 */
export const nextCinemaPresetName = (presets: readonly CinemaPresetPublic[]): string => {
  const taken = new Set(presets.map((preset) => preset.name));
  let index = 1;
  while (taken.has(`${GENERATED_PRESET_NAME_PREFIX} ${index}`)) index += 1;
  return `${GENERATED_PRESET_NAME_PREFIX} ${index}`;
};
