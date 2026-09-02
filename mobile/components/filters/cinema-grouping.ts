/**
 * Grouping and identity helpers for a cinema selection, shared by every surface
 * that lets the user pick cinemas (the cinema filter sheet and the cinema
 * preset tip) so they group and compare selections the same way.
 */
import type { CinemaPublic, CinemaScope, CityPublic } from "shared";

export type CityGroup = {
  city: CityPublic;
  cinemas: CinemaPublic[];
};

/** Below this many cinemas a city is not worth its own section. */
const GROUPING_MINIMUM = 3;

/**
 * Split cinemas into per-city sections, alphabetically, with the cities too
 * small to earn a section collected into one "other" bucket.
 */
export function groupCinemas(cinemas: readonly CinemaPublic[]): {
  groupedCities: CityGroup[];
  ungrouped: CinemaPublic[];
} {
  const groupedByCity = new Map<number, CityGroup>();
  cinemas.forEach((cinema) => {
    const existing = groupedByCity.get(cinema.city.id);
    if (existing) {
      existing.cinemas.push(cinema);
      return;
    }
    groupedByCity.set(cinema.city.id, { city: cinema.city, cinemas: [cinema] });
  });

  const sortedGroups = Array.from(groupedByCity.values()).sort((a, b) =>
    a.city.name.localeCompare(b.city.name)
  );
  sortedGroups.forEach((group) => {
    group.cinemas.sort((a, b) => a.name.localeCompare(b.name));
  });

  const groupedCities: CityGroup[] = [];
  const ungrouped: CinemaPublic[] = [];
  sortedGroups.forEach((group) => {
    if (group.cinemas.length >= GROUPING_MINIMUM) {
      groupedCities.push(group);
    } else {
      ungrouped.push(...group.cinemas);
    }
  });
  ungrouped.sort((a, b) => {
    const cityCompare = a.city.name.localeCompare(b.city.name);
    if (cityCompare !== 0) return cityCompare;
    return a.name.localeCompare(b.name);
  });

  return { groupedCities, ungrouped };
}

/** Deduplicated and ordered, so a selection has one canonical form. */
export const sortCinemaIds = (cinemaIds: Iterable<number>): number[] =>
  Array.from(new Set(cinemaIds)).sort((a, b) => a - b);

/** Comparable string for a selection, for "is this already a preset?" checks. */
export const serializeCinemaIds = (cinemaIds: Iterable<number>): string =>
  JSON.stringify(sortCinemaIds(cinemaIds));

/**
 * Name a cinema selection by the rule behind it rather than by its size.
 *
 * A preset that selects every Amsterdam cinema is stored as that rule (see the
 * backend's `CinemaScope`), which is the whole point: it picks up cinemas that
 * open later. Saying "5 cinemas" would hide that, and go stale the moment a
 * sixth opens — so the rule is what gets said.
 *
 * Falls back to the count for selections that are just a list of cinemas, and
 * for presets saved before rules existed.
 */
export const formatCinemaScopeLabel = (
  scope: CinemaScope | null | undefined,
  cinemaIds: readonly number[],
  cityNamesById: ReadonlyMap<number, string>
): string => {
  const countLabel = `${cinemaIds.length} cinema${cinemaIds.length === 1 ? "" : "s"}`;
  if (!scope) return countLabel;
  if (scope.all_cinemas) return "All cinemas";

  const cityNames = (scope.city_ids ?? [])
    .map((cityId) => cityNamesById.get(cityId))
    .filter((name): name is string => name !== undefined)
    .sort((a, b) => a.localeCompare(b));
  if (cityNames.length === 0) return countLabel;

  const extraCount = (scope.cinema_ids ?? []).length;
  // Past two cities the names stop fitting anywhere they are shown, and the
  // count of cities carries the same meaning in less room.
  const citiesLabel =
    cityNames.length <= 2
      ? `All ${cityNames.join(" & ")} cinemas`
      : `All cinemas in ${cityNames.length} cities`;
  return extraCount === 0 ? citiesLabel : `${citiesLabel} + ${extraCount}`;
};

/** City names by id, for `formatCinemaScopeLabel`. */
export const buildCityNameIndex = (
  cinemas: readonly CinemaPublic[]
): ReadonlyMap<number, string> =>
  new Map(cinemas.map((cinema) => [cinema.city.id, cinema.city.name]));
