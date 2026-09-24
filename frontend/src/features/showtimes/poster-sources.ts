/**
 * Sharper posters on the web without changing what the backend stores.
 *
 * The backend stores posters small — Letterboxd's at 230px wide
 * (`get_poster_url`'s `/poster/std/230/`), TMDB's at `w342`
 * (`TMDB_POSTER_BASE_URL`) — which is right for a phone's feed but soft on a
 * ticket-wall card several hundred pixels wide, and softer again on a
 * high-density screen. Both CDNs serve the same image at a fixed set of other
 * sizes under a predictable URL, so a stored URL can be rewritten to each of
 * them and handed to the browser as a `srcset`: it picks the smallest that
 * covers the card at the screen's density.
 *
 * URLs from anywhere else are left alone.
 */

/**
 * Letterboxd bakes the size into the file name (`…-0-230-0-345-crop.jpg`).
 * Only the sizes its own site uses resolve — anything else is a 403 — so
 * these are those, width by 1.5× height, checked by hand.
 */
const LETTERBOXD_WIDTHS = [230, 460, 1000] as const
const LETTERBOXD_SIZED =
  /^(https:\/\/a\.ltrbxd\.com\/resized\/.+)-0-\d+-0-\d+-crop(\.jpg.*)$/

/** TMDB's poster widths from the stored one up; `original` is too heavy for a feed. */
const TMDB_WIDTHS = [342, 500, 780] as const
const TMDB_SIZED = /^(https:\/\/image\.tmdb\.org\/t\/p\/)w\d+(\/.+)$/

/**
 * `srcSet` for a poster URL, or undefined when it isn't a CDN we can resize.
 *
 * Pair it with `sizes="auto"` on a lazily loaded image (the browser measures
 * the laid-out width itself) plus a fallback width for browsers without it.
 */
export const posterSrcSet = (url: string): string | undefined => {
  const letterboxd = LETTERBOXD_SIZED.exec(url)
  if (letterboxd) {
    const [, stem, rest] = letterboxd
    return LETTERBOXD_WIDTHS.map(
      (width) => `${stem}-0-${width}-0-${width * 1.5}-crop${rest} ${width}w`,
    ).join(", ")
  }
  const tmdb = TMDB_SIZED.exec(url)
  if (tmdb) {
    const [, base, path] = tmdb
    return TMDB_WIDTHS.map((width) => `${base}w${width}${path} ${width}w`).join(
      ", ",
    )
  }
  return undefined
}

/**
 * `sizes` for a lazy poster: measured by the browser where supported, else
 * this — wide enough for a ticket-wall card at three to a row.
 */
export const POSTER_SIZES = "auto, 400px"

/**
 * `sizes` for a poster whose width the card already knows. A fixed pixel width
 * is the fallback instead of 400px, so a browser that can't measure it (no
 * `sizes="auto"`) still fetches a thumbnail's worth, not the 1000px file.
 */
export const posterSizes = (width: string): string =>
  /^\d+(\.\d+)?px$/.test(width) ? `auto, ${width}` : POSTER_SIZES
