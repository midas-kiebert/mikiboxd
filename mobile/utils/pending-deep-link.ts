/**
 * The deep-link path a user was headed for before they had a session, held
 * until they do.
 *
 * Written from two places: the root layout's route guard (a link into an
 * account route, tapped while logged out) and the Android install referrer
 * (a link tapped with no app installed at all, carried through the Play Store
 * install). Read back in exactly one place — the root layout, once the account
 * is real and the intro it owes is over.
 *
 * Stored with the time it was saved. The value outlives the app process, so
 * without a bound a link opened and abandoned weeks ago would be resumed on a
 * completely unrelated sign-in later.
 */
import { storage } from "shared/storage";

import { PENDING_DEEP_LINK_PATH_KEY } from "@/constants/pending-deep-link";

const PENDING_DEEP_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StoredPendingDeepLink = { path: string; savedAt: number };

export async function savePendingDeepLink(path: string): Promise<void> {
  const entry: StoredPendingDeepLink = { path, savedAt: Date.now() };
  try {
    await storage.setItem(PENDING_DEEP_LINK_PATH_KEY, JSON.stringify(entry));
  } catch (error) {
    // Losing the path costs the user one extra tap on the link, which is not
    // worth failing the navigation that was about to happen.
    console.error("Error saving pending deep link:", error);
  }
}

/** Read and clear the pending path, or null if there is none worth following. */
export async function takePendingDeepLink(): Promise<string | null> {
  let raw: string | null = null;
  try {
    raw = await storage.getItem(PENDING_DEEP_LINK_PATH_KEY);
  } catch (error) {
    console.error("Error reading pending deep link:", error);
    return null;
  }
  if (raw === null) return null;

  try {
    await storage.removeItem(PENDING_DEEP_LINK_PATH_KEY);
  } catch (error) {
    console.error("Error clearing pending deep link:", error);
  }

  return readStoredPath(raw);
}

function readStoredPath(raw: string): string | null {
  // Builds before this key held JSON stored the bare path. One of those can
  // still be on disk after an update, and it has no age to check.
  if (!raw.startsWith("{")) return raw.length > 0 ? raw : null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const { path, savedAt } = parsed as Partial<StoredPendingDeepLink>;
  if (typeof path !== "string" || path.length === 0) return null;
  if (typeof savedAt !== "number") return path;
  if (Date.now() - savedAt > PENDING_DEEP_LINK_TTL_MS) return null;

  return path;
}
