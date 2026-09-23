/**
 * Cinema search, matched the way the server's search-by-cinema matches.
 *
 * `_matching_cinema_ids_subquery` in `backend/app/crud/movie.py` keeps a cinema
 * when the query is a case- and accent-insensitive substring of its name or of
 * any of its aliases, with the separators `- ' . /` and spaces stripped from
 * both sides first. So "ketelhuis" finds "Het Ketelhuis", "lab 111" finds
 * "LAB111", and a venue is still found under the name it was renamed from.
 *
 * The cinema sheet filters its list in the browser, and it has to agree with
 * that: a search box that finds a cinema's showtimes but not the cinema itself
 * reads as the picker being broken. The aliases reach the client on
 * `CinemaPublic.aliases`, served for exactly this.
 */
import type { CinemaPublic } from "shared/client"

/** The characters the server strips before comparing — `_SEPARATOR_CHARS_REGEX`. */
const SEPARATORS = /[-'./ ]/g
/** Combining marks left behind by NFD, which is what `unaccent` removes. */
const COMBINING_MARKS = /[̀-ͯ]/g

export const normaliseForCinemaSearch = (value: string): string =>
  value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .replace(SEPARATORS, "")
    .toLowerCase()

export const cinemaMatchesQuery = (
  cinema: CinemaPublic,
  query: string,
): boolean => {
  const needle = normaliseForCinemaSearch(query)
  if (!needle) return true
  return [cinema.name, ...(cinema.aliases ?? [])].some((name) =>
    normaliseForCinemaSearch(name).includes(needle),
  )
}
