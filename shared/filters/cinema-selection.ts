/**
 * What "which cinemas am I looking at" means, for every client.
 *
 * A cinema selection is read through three layers, and the order matters:
 *
 *   1. what the user picked this session (the app's session selection, the
 *      website's `?cinemas=` in the URL),
 *   2. failing that, the cinemas saved on their account — the favourite preset,
 *      applied at startup,
 *   3. failing that, every cinema there is.
 *
 * The third step is the one that is easy to get wrong. The backend reads "no
 * cinema ids" as "do not filter by cinema", so an empty selection has always
 * *behaved* as every cinema — but only the server knew that, and a client that
 * reported it literally showed "0 cinemas" or "your usual" over a feed that was
 * plainly showing something else. Emptiness is resolved here instead, at both
 * the read and the write, so the only selection a UI ever sees is one that says
 * what the feed is doing.
 */
import type { CinemaPresetPublic } from "../client";

import { serializeCinemaIds, sortCinemaIds } from "./cinema-grouping";

type CinemaSelectionState = {
  sessionCinemaIds: readonly number[] | undefined;
  preferredCinemaIds: readonly number[] | undefined;
};

/** Same cinemas, whatever order they arrived in. */
export const selectionsMatch = (
  left: readonly number[],
  right: readonly number[]
): boolean => {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
};

/**
 * Whether the cinema dimension is *filtering*, for a "filters active" count.
 *
 * Sitting on the account's own cinemas is the resting state, not a filter — a
 * badge saying "1 filter active" on a feed nobody has touched is noise. With no
 * preferred cinemas to compare against there is no resting state to be away
 * from, so nothing counts.
 */
export const isCinemaSelectionDifferentFromPreferred = ({
  sessionCinemaIds,
  preferredCinemaIds,
}: CinemaSelectionState): boolean => {
  if (preferredCinemaIds === undefined) return false;
  const currentCinemaIds = sessionCinemaIds ?? preferredCinemaIds;
  return !selectionsMatch(currentCinemaIds, preferredCinemaIds);
};

/**
 * The selection to *show*: the three layers above, resolved to a real list of
 * cinema ids. A picker opens on this, so it opens already ticked rather than
 * empty over a feed that is showing cinemas.
 */
export const resolveCinemaSelection = ({
  sessionCinemaIds,
  preferredCinemaIds,
  allCinemaIds,
}: CinemaSelectionState & {
  allCinemaIds: readonly number[];
}): number[] => {
  const chosen = sessionCinemaIds ?? preferredCinemaIds ?? [];
  if (chosen.length > 0) return sortCinemaIds(chosen);
  return sortCinemaIds(allCinemaIds);
};

/**
 * The selection to *store*, for the same reason in the other direction:
 * deselecting the last cinema is not a request for an empty feed, it is the
 * only way the picker can say "all of them".
 */
export const commitCinemaSelection = (
  next: readonly number[],
  allCinemaIds: readonly number[]
): number[] =>
  next.length === 0 ? sortCinemaIds(allCinemaIds) : sortCinemaIds(next);

/**
 * The preset this selection *is*, if it is one — so a picker can say "Amsterdam
 * indies" instead of "6 cinemas", and a preset row can show that it is the one
 * currently applied. Matched on the cinemas, never on a name.
 */
export const findCinemaPresetForSelection = (
  presets: readonly CinemaPresetPublic[],
  cinemaIds: readonly number[]
): CinemaPresetPublic | null => {
  const signature = serializeCinemaIds(cinemaIds);
  return (
    presets.find((preset) => serializeCinemaIds(preset.cinema_ids) === signature) ?? null
  );
};

/** "1 cinema" / "7 cinemas" — the plain count, where no scope rule applies. */
export const formatCinemaCount = (count: number): string =>
  `${count} cinema${count === 1 ? "" : "s"}`;
