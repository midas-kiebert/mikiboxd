/**
 * How long a movies/showtimes list's loading state has to persist before
 * `ListLoadingLogo` appears. A filter tap's refetch usually resolves from
 * cache well inside this, so the panel only shows for a wait that actually
 * takes a moment — instead of flashing in and out on every quick tap.
 */
export const LOADING_LOGO_DELAY_MS = 150;

/**
 * After the panel hides, how long its next appearance is held back. Tapping
 * through several filters in a row triggers a separate short load per tap —
 * without this, each one clears LOADING_LOGO_DELAY_MS on its own and the
 * panel still strobes once per tap; this collapses a flurry of taps into at
 * most one appearance per window.
 */
export const LOADING_LOGO_COOLDOWN_MS = 350;
