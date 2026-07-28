export const MOVIE_SHARE_WEB_BASE_URL = "https://mikino.nl";

export function buildMovieShareUrl(movieId: number) {
  return `${MOVIE_SHARE_WEB_BASE_URL}/movie/${encodeURIComponent(String(movieId))}`;
}
