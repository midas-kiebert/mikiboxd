/**
 * A guest's preferred cinemas, kept in this browser.
 *
 * A member's preferred cinemas live on their account (`/me/cinema-selections`).
 * A guest has no account to put them on, but narrowing the feed to the cinemas
 * they actually go to should survive a reload all the same — the app does the
 * same on the phone (`mobile/utils/guest-cinema-selection.ts`).
 *
 * `usePreferredCinemaIds` is the one read for both: every screen that used to
 * ask `useFetchSelectedCinemas` asks this instead, so the feed has one source
 * of "your cinemas" and only its origin differs. Empty or unset means none
 * saved, which reads as all cinemas, the same as an account without picks.
 */
import { useSyncExternalStore } from "react"
import { useFetchSelectedCinemas } from "shared/hooks/useFetchSelectedCinemas"

import { useIsSignedIn } from "@/auth/useSession"

const GUEST_PREFERRED_CINEMAS_KEY = "guest_preferred_cinemas"

const listeners = new Set<() => void>()

/** Cached by the raw string, so `useSyncExternalStore` sees a stable array. */
let cachedRaw: string | null = null
let cachedIds: number[] | undefined

const parse = (raw: string | null): number[] | undefined => {
  if (!raw) return undefined
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return undefined
    const ids = parsed.filter((id): id is number => Number.isInteger(id))
    return ids.length ? ids : undefined
  } catch {
    return undefined
  }
}

const readRaw = (): string | null => {
  try {
    return localStorage.getItem(GUEST_PREFERRED_CINEMAS_KEY)
  } catch {
    // A private window can refuse storage; that guest simply has none saved.
    return null
  }
}

const getGuestPreferredCinemas = (): number[] | undefined => {
  const raw = readRaw()
  if (raw !== cachedRaw) {
    cachedRaw = raw
    cachedIds = parse(raw)
  }
  return cachedIds
}

export const setGuestPreferredCinemas = (cinemaIds: readonly number[]) => {
  try {
    localStorage.setItem(GUEST_PREFERRED_CINEMAS_KEY, JSON.stringify(cinemaIds))
  } catch {
    // Not kept past this page; nothing on screen depends on the write.
  }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  // Another tab saving its set updates this one too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === GUEST_PREFERRED_CINEMAS_KEY) listener()
  }
  window.addEventListener("storage", onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("storage", onStorage)
  }
}

/**
 * Your preferred cinemas: the account's when signed in, this browser's when
 * not. Shaped like the query it replaces, so call sites keep `data`/`isLoading`.
 */
export const usePreferredCinemaIds = () => {
  const isSignedIn = useIsSignedIn()
  const account = useFetchSelectedCinemas({ enabled: isSignedIn })
  const guest = useSyncExternalStore(
    subscribe,
    getGuestPreferredCinemas,
    () => undefined,
  )

  if (isSignedIn) return { data: account.data, isLoading: account.isLoading }
  return { data: guest, isLoading: false }
}

/**
 * Hand a guest's set over to the account they just created, and forget it
 * here: from now on the account's copy is the one that counts. Returns the
 * set, or an empty list when the guest never saved one.
 */
export const claimGuestPreferredCinemas = (): number[] => {
  const claimed = getGuestPreferredCinemas() ?? []
  try {
    localStorage.removeItem(GUEST_PREFERRED_CINEMAS_KEY)
  } catch {
    // Harmless if it stays: a signed-in browser never reads it.
  }
  for (const listener of listeners) listener()
  return claimed
}
