/**
 * Synthetic ("not on TMDB") movie listings, from `shared/movies/synthetic-movie`.
 *
 * A wrapper rather than a copy: the "???" placeholder is wording, and the two
 * clients showing a sneak preview differently is two products. Kept at this path
 * because the app's call sites already import it from here.
 */
export {
  SNEAK_PREVIEW_MOVIE_ID,
  UNKNOWN_METADATA_PLACEHOLDER,
  isSyntheticMovieId,
} from "shared/movies/synthetic-movie";
