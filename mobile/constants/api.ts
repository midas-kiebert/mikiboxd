const PRODUCTION_API_URL = "https://api.mikino.nl";
const STAGING_API_URL = "https://api.staging.mikino.nl";

// EAS inlines EXPO_PUBLIC_API_URL into the bundle at build time — the
// `staging-device` profile sets it so a release build can be tested against
// staging before the backend ships. Without it, dev (`pnpm start`) talks to
// staging and release builds to production.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL || (__DEV__ ? STAGING_API_URL : PRODUCTION_API_URL);

// A release build pointed at staging. Dev builds always are, so they don't
// count: this is what the badge and Sentry's environment key off.
export const IS_STAGING_BUILD = !__DEV__ && API_URL === STAGING_API_URL;
