/**
 * Web pages the app links out to but does not own the content of — the
 * privacy policy and the support contact page. Both live on the same web
 * frontend as the showtime/movie share previews (see constants/ping-link.ts
 * and friends), so they share its base URL rather than hardcoding a second one.
 */
export const LEGAL_LINKS_WEB_BASE_URL = "https://mikino.nl";

export const PRIVACY_POLICY_URL = `${LEGAL_LINKS_WEB_BASE_URL}/privacy-policy.html`;
export const SUPPORT_PAGE_URL = `${LEGAL_LINKS_WEB_BASE_URL}/support`;
export const SUPPORT_EMAIL = "info@mikino.nl";
