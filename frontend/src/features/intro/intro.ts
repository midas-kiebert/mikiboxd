/**
 * First-run intro — the website's twin of the app's (`mobile/utils/intro.ts`).
 *
 * Who sees it: only an account created in this browser. There is no backend
 * "new account" flag, so the signup page marks the intro pending the moment the
 * account exists, and `IntroHost` shows it once the session is up. Keying off
 * "has never seen the intro" instead would show it to every existing member on
 * their next visit.
 *
 * Cleared when the walkthrough is skipped or finished, not when it starts: a
 * tab closed halfway has not been introduced to anything.
 *
 * `skipCinemas` is set when the guest had already saved preferred cinemas,
 * which the signup handed to the account — asking again would undo that work.
 */
import { useSyncExternalStore } from "react"

const PENDING_STORAGE_KEY = "mikino.intro.pending.v1"

export type IntroPending = { skipCinemas: boolean }

const listeners = new Set<() => void>()

let cachedRaw: string | null = null
let cached: IntroPending | null = null

const read = (): IntroPending | null => {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(PENDING_STORAGE_KEY)
  } catch {
    return null
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw
    try {
      const parsed = raw ? JSON.parse(raw) : null
      cached = parsed ? { skipCinemas: parsed.skipCinemas === true } : null
    } catch {
      cached = null
    }
  }
  return cached
}

const write = (value: IntroPending | null) => {
  try {
    if (value) localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(value))
    else localStorage.removeItem(PENDING_STORAGE_KEY)
  } catch {
    // Without storage the intro simply does not survive a reload.
  }
  for (const listener of listeners) listener()
}

export const markIntroPending = (pending: IntroPending) => write(pending)

export const endIntro = () => write(null)

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The pending intro, or null when there is none to show. */
export const useIntroPending = (): IntroPending | null =>
  useSyncExternalStore(subscribe, read, () => null)
