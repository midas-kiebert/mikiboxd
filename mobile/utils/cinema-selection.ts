/**
 * Utility helper for mobile feature logic: Cinema selection state.
 */
type CinemaSelectionState = {
  sessionCinemaIds: number[] | undefined;
  preferredCinemaIds: number[] | undefined;
};

export const selectionsMatch = (left: readonly number[], right: readonly number[]) => {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
};

export const isCinemaSelectionDifferentFromPreferred = ({
  sessionCinemaIds,
  preferredCinemaIds,
}: CinemaSelectionState) => {
  if (preferredCinemaIds === undefined) return false;
  const currentCinemaIds = sessionCinemaIds ?? preferredCinemaIds;
  return !selectionsMatch(currentCinemaIds, preferredCinemaIds);
};
