/**
 * Synthetic ("not on TMDB") movie listings.
 *
 * Real movies use their positive TMDB id as the primary key. Listings that have
 * no TMDB counterpart — currently just the sneak preview, whose film the cinemas
 * keep secret — use negative ids instead. They render like any other movie, but
 * with their unknown metadata shown as "???".
 *
 * Mirrors `SNEAK_PREVIEW_MOVIE_ID` / `is_synthetic_movie_id` in the backend
 * (`backend/app/models/movie.py`).
 */
export const SNEAK_PREVIEW_MOVIE_ID = -1;

/** Placeholder shown in place of a synthetic listing's unknown metadata. */
export const UNKNOWN_METADATA_PLACEHOLDER = "???";

export function isSyntheticMovieId(movieId: number): boolean {
  return movieId < 0;
}
