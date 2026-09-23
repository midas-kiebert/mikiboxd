/**
 * The picture URLs to try for an avatar drawn `size` px wide, best first.
 *
 * An uploaded Letterboxd avatar carries its crop size in the path
 * (`avtr-0-80-0-80-crop.jpg`) and we store the size the watchlist page used,
 * which is blurry in a big preview. Other sizes can be asked for, but the CDN
 * serves only some of them (300 and 150 have worked, 200 and 500 403 — see
 * `backend/app/scraping/letterboxd/watchlist.py` `_upsize_avatar_url`), so
 * a bigger one is only ever a first try: the stored URL, which was just
 * serving on Letterboxd, is always the fallback.
 */
const LETTERBOXD_CROP = /avtr-0-(\d+)-0-(\d+)-crop/
const LARGE_CROP_PX = 300
/** Below this the stored crop is sharp enough; no extra request. */
const UPSIZE_FROM_PX = 64

export function getAvatarSources(url: string | null | undefined, size: number): string[] {
  if (!url) return []
  const match = url.match(LETTERBOXD_CROP)
  if (!match || size < UPSIZE_FROM_PX || Number(match[1]) >= LARGE_CROP_PX) return [url]
  const large = url.replace(LETTERBOXD_CROP, `avtr-0-${LARGE_CROP_PX}-0-${LARGE_CROP_PX}-crop`)
  return [large, url]
}
