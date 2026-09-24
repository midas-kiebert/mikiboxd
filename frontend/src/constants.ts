/**
 * Shared frontend constants used by multiple web features.
 */

/**
 * The primary navigation bar across the top: brand, tabs, account.
 *
 * It sits in the document flow at the top of `_layout` rather than being
 * fixed, which is the whole reason it replaced the sidebar — a fixed rail has
 * to be *cleared* by every layout beside it, and clearing it is what turned the
 * feed into four stacked columns. Nothing below the nav has to know it exists;
 * only the two shells that measure themselves against the viewport rather than
 * their parent (`FeedLayout`, `Page`) subtract this.
 */
export const TOP_NAV_HEIGHT = 60

/**
 * The secondary bar some pages fix under the nav — the films page's day
 * filters, the friends page's search. Distinct from `TOP_NAV_HEIGHT`: this one
 * is per-page and optional, that one is the site's navigation.
 */
export const TOPBAR_HEIGHT = 60

export const PAGE_NOTICE_BANNER_HEIGHT_PX = "58px"
export const PAGE_NOTICE_BANNER_OFFSET_CSS_VAR = "--page-notice-banner-height"

/** How much of the viewport the notice banner is currently taking, as a CSS value. */
export const PAGE_NOTICE_BANNER_OFFSET_CSS = `var(${PAGE_NOTICE_BANNER_OFFSET_CSS_VAR}, 0px)`
