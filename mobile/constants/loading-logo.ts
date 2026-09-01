/**
 * How long a movies/showtimes list's loading state has to persist before
 * `ListLoadingLogo` appears — including a genuine first load (a filter/preset
 * combo with nothing cached yet), not only a background refetch. Even a
 * "real" load is very often faster than this (a preset that's been applied
 * before, a nearby cache hit), so this still has to hold long enough to
 * absorb those — short enough that a slower load doesn't read as sluggish,
 * long enough that a fast one doesn't read as a flash.
 */
export const LOADING_LOGO_DELAY_MS = 120;

/**
 * After the panel hides, how long its next appearance is held back. Tapping
 * through several filters in a row triggers a separate short load per tap —
 * without this, each one clears LOADING_LOGO_DELAY_MS on its own and the
 * panel still strobes once per tap; this collapses a flurry of taps into at
 * most one appearance per window.
 */
export const LOADING_LOGO_COOLDOWN_MS = 350;
