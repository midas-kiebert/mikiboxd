/**
 * Where a phone that opened a shared MiKiNO link should be sent to install the
 * native app, and how to tell which phone it is.
 *
 * Kept apart from `constants.ts` because the store URLs and the platform sniff
 * are one concern: neither is useful without the other, and both change only
 * when a store listing does.
 */

export type MobilePlatform = "ios" | "android"

/**
 * Filled in once the App Store listing is live — App Store Connect → the app →
 * App Information → General Information → Apple ID, then
 * `https://apps.apple.com/app/id<APPLE_ID>`. The locale-agnostic `/app/id...`
 * form is deliberate: the prettier `/nl/app/mikino/id...` embeds a name slug
 * that breaks if the app is ever renamed.
 *
 * While this is null, `InstallAppGate` leaves iOS visitors on the web page
 * rather than offering them a button that 404s.
 */
export const IOS_APP_STORE_URL = "https://apps.apple.com/app/id6760034052"

export const ANDROID_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.midaskiebert.mikino"

/**
 * The referrer payload Play carries through an install and hands to the app on
 * its first launch, which is what lets an Android visitor land on the link they
 * tapped rather than on an empty home tab. `utm_source` marks the install as
 * coming from a shared link; `mikino_path` is the part the app reads back (see
 * `mobile/utils/install-referrer.ts`, which must agree on both names).
 *
 * iOS has no equivalent — the App Store passes nothing through an install — so
 * an iOS visitor is asked to open the link a second time instead.
 */
const INSTALL_REFERRER_SOURCE = "mikino_share"
const INSTALL_REFERRER_PATH_PARAM = "mikino_path"

export const STORE_NAMES: Record<MobilePlatform, string> = {
  ios: "the App Store",
  android: "Google Play",
}

/**
 * The phone platform behind the current page load, or null for anything that
 * has no app to install (desktop, and anything unrecognised — an unknown agent
 * is treated as desktop so it keeps the full web page).
 */
export function detectMobilePlatform(): MobilePlatform | null {
  if (typeof navigator === "undefined") return null

  const userAgent = navigator.userAgent
  // Checked before iOS: an Android agent never contains "iPhone", but it does
  // contain "Linux", and this ordering keeps the two sniffs independent.
  if (/Android/i.test(userAgent)) return "android"
  if (/iPhone|iPod|iPad/i.test(userAgent)) return "ios"
  // iPadOS 13+ reports a desktop Safari agent indistinguishable from a Mac's.
  // Touch points are what still separate them.
  if (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1) return "ios"

  return null
}

/**
 * The store listing for `platform`, or null if that store link is not known yet.
 *
 * `deepLinkPath` is the path the visitor was trying to reach. On Android it
 * rides along as the install referrer; on iOS it is dropped, because there is
 * nowhere to put it.
 */
export function getInstallUrl(
  platform: MobilePlatform,
  deepLinkPath?: string,
): string | null {
  if (platform === "ios") return IOS_APP_STORE_URL
  if (!deepLinkPath) return ANDROID_PLAY_STORE_URL

  // Encoded twice on purpose: once so the payload survives as a single
  // `referrer` value, and once around the path itself so a future path
  // containing `&` or `=` cannot split the payload apart.
  const referrer = `utm_source=${INSTALL_REFERRER_SOURCE}&${INSTALL_REFERRER_PATH_PARAM}=${encodeURIComponent(
    deepLinkPath,
  )}`
  return `${ANDROID_PLAY_STORE_URL}&referrer=${encodeURIComponent(referrer)}`
}
