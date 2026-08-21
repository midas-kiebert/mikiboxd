/**
 * Android deferred deep link: the shared link someone tapped *before* they had
 * the app.
 *
 * The web install panel sends an Android visitor to Play with a `referrer`
 * payload carrying the path they were headed for. Play stores that string
 * against the install and hands it to the app afterwards, which is what makes
 * this exact rather than a guess — no fingerprinting, no clipboard.
 *
 * Android only, and deliberately so: the App Store passes nothing through an
 * install, so an iOS visitor has to open the link a second time once the app is
 * there. The web panel tells them as much.
 */
import * as Application from "expo-application";
import { Platform } from "react-native";
import { storage } from "shared/storage";

/** Must match the parameter the web install panel writes into the referrer. */
const INSTALL_REFERRER_PATH_PARAM = "mikino_path";

const INSTALL_REFERRER_CLAIMED_KEY = "install_referrer_claimed_v1";

/**
 * The only paths worth following out of a referrer: the three link shapes the
 * app actually shares. Anything else is dropped rather than navigated to — a
 * referrer is attacker-supplied (anyone can hand out a Play URL with one
 * attached) and this ends in a navigation inside a signed-in app.
 */
const SHAREABLE_PATH_PATTERNS = [
  /^\/ping\/\d+\/[\w.~-]+$/,
  /^\/movie\/\d+$/,
  /^\/add-friend\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
];

// Cached as a promise, not a value, so concurrent callers share one claim.
// Stable for the life of the process for the same reason `getInitialURL` is:
// the effect that reads it re-runs when the session changes, and it has to see
// the same answer each time or the link is lost on the run that matters.
let claimPromise: Promise<string | null> | undefined;

/**
 * The path this install was referred with, or null — which is the answer for
 * every platform but Android, every organic install, and every launch after the
 * first one that asked.
 */
export function getInstallReferrerPath(): Promise<string | null> {
  claimPromise ??= claimInstallReferrerPath();
  return claimPromise;
}

async function claimInstallReferrerPath(): Promise<string | null> {
  if (Platform.OS !== "android") return null;

  try {
    if ((await storage.getItem(INSTALL_REFERRER_CLAIMED_KEY)) !== null) return null;
  } catch (error) {
    console.error("Error reading install referrer claim:", error);
    return null;
  }

  let referrer: string | null = null;
  try {
    referrer = await Application.getInstallReferrerAsync();
  } catch {
    // Rejects for every Play-side failure alike: no Play Store, a Play version
    // without the referrer API, the service being unreachable. None of them are
    // worth retrying — a device that cannot answer now will not answer later.
  }

  // Marked claimed whatever happened. The referrer is fixed at install time, so
  // a later read can only return what this one already saw, and a reinstall
  // would otherwise replay a link from the previous install.
  try {
    await storage.setItem(INSTALL_REFERRER_CLAIMED_KEY, String(Date.now()));
  } catch (error) {
    console.error("Error marking install referrer claimed:", error);
  }

  if (!referrer) return null;

  const path = readQueryParam(referrer, INSTALL_REFERRER_PATH_PARAM);
  if (path === null) return null;

  return SHAREABLE_PATH_PATTERNS.some((pattern) => pattern.test(path)) ? path : null;
}

/**
 * Hand-parsed rather than via `URLSearchParams`, for the same reason
 * `parseInviteLinkUrl` avoids `URL`: the polyfills React Native ships are
 * partial, and this is a handful of lines.
 */
function readQueryParam(query: string, name: string): string | null {
  for (const pair of query.split("&")) {
    const separator = pair.indexOf("=");
    if (separator === -1) continue;
    if (pair.slice(0, separator) !== name) continue;
    try {
      return decodeURIComponent(pair.slice(separator + 1));
    } catch {
      return null;
    }
  }
  return null;
}
