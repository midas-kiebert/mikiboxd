/**
 * Shared data access for cinema presets — named cinema selections the user can
 * switch between. Kept in one place so the cinema filter sheet, the cinema
 * preset tip and anything checking "does this user have presets yet?" all read
 * and invalidate the same cache entry.
 */
import { useQuery, type QueryClient, type UseQueryResult } from "@tanstack/react-query";
import { MeService, type CinemaPresetPublic } from "../client";

import { serializeCinemaIds } from "./cinema-grouping";
import { formatCinemaCount } from "./cinema-selection";
import { displayPresetsQueryKey } from "./saved-presets";

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
 * never by its name — the user can rename it, or promote a preset they named.
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

/**
 * The name reserved for preferred cinemas that have no name of their own — the
 * backend's `FAVORITE_CINEMA_PRESET_NAME`. The intro saves under it, and so does
 * "Set as preferred cinemas" for a selection that is not one of your presets.
 */
export const PREFERRED_CINEMA_PRESET_NAME = "My Cinemas";

/** The row holding the reserved name, preferred or not. */
export const findReservedPreferredPreset = (
  presets: readonly CinemaPresetPublic[]
): CinemaPresetPublic | null =>
  presets.find((preset) => !preset.is_default && preset.name === PREFERRED_CINEMA_PRESET_NAME) ??
  null;

/**
 * What "Set as preferred cinemas" does with a selection:
 *
 * - `promote` — the selection already *is* one of your presets, so that preset
 *   becomes the preferred one, under its own name. No copy, no duplicate row.
 * - `confirm-demote` — the same, but "My Cinemas" is preferred right now. It
 *   would quietly turn into an ordinary preset, so the client asks first:
 *   delete it, or keep it as a preset (renamed, if you like).
 * - `create` — nothing is called "My Cinemas" yet, so the selection is saved
 *   as a new set under that name. Whatever was preferred before keeps its
 *   cinemas and becomes an ordinary preset.
 * - `confirm-replace` — "My Cinemas" exists with other cinemas. Saving would
 *   overwrite them, so the client asks first: replace them, or rename the old
 *   set out of the way and then save.
 */
export type SaveAsPreferredPlan =
  | { kind: "promote"; preset: CinemaPresetPublic }
  | { kind: "confirm-demote"; preset: CinemaPresetPublic; reserved: CinemaPresetPublic }
  | { kind: "create" }
  | { kind: "confirm-replace"; reserved: CinemaPresetPublic };

export const planSaveAsPreferred = (
  presets: readonly CinemaPresetPublic[],
  cinemaIds: Iterable<number>
): SaveAsPreferredPlan => {
  const signature = serializeCinemaIds(cinemaIds);
  const match = presets.find(
    (preset) => !preset.is_default && serializeCinemaIds(preset.cinema_ids) === signature
  );
  if (match) return planPromotePreset(presets, match);
  const reserved = findReservedPreferredPreset(presets);
  return reserved ? { kind: "confirm-replace", reserved } : { kind: "create" };
};

/**
 * Making an existing preset the preferred one — from "Set as preferred
 * cinemas" on a matching selection, or from the manage-presets list.
 */
export const planPromotePreset = (
  presets: readonly CinemaPresetPublic[],
  preset: CinemaPresetPublic
): Extract<SaveAsPreferredPlan, { kind: "promote" | "confirm-demote" }> => {
  const current = findMyCinemasPreset(presets);
  const isReservedPreferred =
    current !== null && current.id !== preset.id && current.name === PREFERRED_CINEMA_PRESET_NAME;
  return isReservedPreferred
    ? { kind: "confirm-demote", preset, reserved: current }
    : { kind: "promote", preset };
};

/** The words of the "replace My Cinemas?" question, the same on both clients. */
export const describeReplacePreferredPrompt = (reserved: CinemaPresetPublic) => ({
  title: `Replace “${reserved.name}”?`,
  body:
    `You already have a set called “${reserved.name}” ` +
    `(${formatCinemaCount(reserved.cinema_ids.length)}). ` +
    "Saving these as your preferred cinemas replaces the cinemas in it. " +
    "Rename it first to keep it as a separate set.",
  replaceLabel: "Replace",
  renameLabel: "Rename old set",
  renameConfirmLabel: "Rename and save",
  renamePlaceholder: "Name for your old set",
});

/** The words of the "what happens to My Cinemas?" question. */
export const describeDemotePreferredPrompt = (
  reserved: CinemaPresetPublic,
  preset: CinemaPresetPublic
) => ({
  title: `Stop using “${reserved.name}”?`,
  body:
    `“${preset.name}” becomes your preferred cinemas. ` +
    `Delete “${reserved.name}” (${formatCinemaCount(reserved.cinema_ids.length)}), ` +
    "or keep it as a preset?",
  deleteLabel: "Delete it",
  keepLabel: "Keep as preset",
  keepConfirmLabel: "Keep as preset",
  renamePlaceholder: "Preset name",
});

const RENAMED_RESERVED_PRESET_NAME = "Previous cinemas";

/** Prefilled into the rename field: "Previous cinemas", numbered once taken. */
export const suggestRenameForReservedPreset = (
  presets: readonly CinemaPresetPublic[]
): string => {
  const taken = new Set(presets.map((preset) => preset.name));
  if (!taken.has(RENAMED_RESERVED_PRESET_NAME)) return RENAMED_RESERVED_PRESET_NAME;
  let index = 2;
  while (taken.has(`${RENAMED_RESERVED_PRESET_NAME} ${index}`)) index += 1;
  return `${RENAMED_RESERVED_PRESET_NAME} ${index}`;
};

/**
 * Save a selection that is none of your presets as the preferred cinemas.
 * The backend writes it into the "My Cinemas" row (creating it if needed), so
 * `create` and `confirm-replace` → Replace are the same call. Rename moves the
 * old row out of the way first; a taken name fails that step with a 409 and
 * nothing else is written.
 */
export const saveSelectionAsPreferred = async ({
  cinemaIds,
  renameReserved,
}: {
  cinemaIds: number[];
  renameReserved?: { presetId: string; name: string };
}): Promise<void> => {
  if (renameReserved) {
    await MeService.renameCinemaPreset({
      presetId: renameReserved.presetId,
      requestBody: { name: renameReserved.name },
    });
  }
  await MeService.setCinemaSelections({ requestBody: cinemaIds });
};

/**
 * Make `presetId` the preferred cinemas and deal with the "My Cinemas" it
 * takes over from. A rename runs first, so a taken name (409) changes nothing;
 * a delete runs last, so there is never a moment with no preferred cinemas.
 * Keeping the old name is just a promote.
 */
export const promotePresetOverReserved = async ({
  presetId,
  reserved,
}: {
  presetId: string;
  reserved:
    | { presetId: string; action: "delete" }
    | { presetId: string; action: "keep"; name: string | null };
}): Promise<void> => {
  if (reserved.action === "keep" && reserved.name !== null) {
    await MeService.renameCinemaPreset({
      presetId: reserved.presetId,
      requestBody: { name: reserved.name },
    });
  }
  await MeService.setFavoriteCinemaPreset({ presetId });
  if (reserved.action === "delete") {
    await MeService.deleteCinemaPreset({ presetId: reserved.presetId });
  }
};
