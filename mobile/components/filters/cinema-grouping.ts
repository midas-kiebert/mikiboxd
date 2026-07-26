/**
 * Grouping and identity helpers for a cinema selection, shared by every surface
 * that lets the user pick cinemas (the cinema filter sheet and the cinema
 * preset tip) so they group and compare selections the same way.
 */
import type { CinemaPublic, CityPublic } from "shared";

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
