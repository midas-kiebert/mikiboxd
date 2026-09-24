/**
 * The Cineville card number and its one preference, on the web — the app's
 * `utils/cineville-card.ts` and `utils/cineville-auto-copy.ts`.
 *
 * **Kept in this browser, in `localStorage`**, never sent to the server: the
 * app keeps the number on the device for the same reason. The digits are
 * stored without their fixed `CP$` prefix, which is added back when the code
 * is copied or drawn as a barcode.
 *
 * Auto-copy is on unless it was switched off, as in the app: pressing a
 * Cineville cinema's ticket link puts the digits on the clipboard, ready to
 * paste into the ticket shop.
 */
import { useSyncExternalStore } from "react"

export const CINEVILLE_PREFIX = "CP$"
export const CINEVILLE_DIGITS_LENGTH = 9

const DIGITS_KEY = "mikino.cineville.cardDigits.v1"
const AUTO_COPY_KEY = "mikino.cineville.autoCopy.v1"
const AUTO_COPY_OFF = "0"

const CARD_DIGITS_PATTERN = new RegExp(`^\\d{${CINEVILLE_DIGITS_LENGTH}}$`)

export const isValidCinevilleDigits = (digits: string): boolean =>
  CARD_DIGITS_PATTERN.test(digits)

/** The string a Cineville scanner expects: the `CP$` prefix plus the digits. */
export const buildCinevilleBarcodeValue = (digits: string): string =>
  `${CINEVILLE_PREFIX}${digits}`

const readItem = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    // ignore storage read errors
    return null
  }
}

const writeItem = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // ignore storage write errors
  }
}

const readDigits = (): string | null => {
  const stored = readItem(DIGITS_KEY)
  return stored && isValidCinevilleDigits(stored) ? stored : null
}

const readAutoCopy = (): boolean => readItem(AUTO_COPY_KEY) !== AUTO_COPY_OFF

let digits = readDigits()
let autoCopy = readAutoCopy()
const listeners = new Set<() => void>()

const notify = () => {
  for (const listener of listeners) listener()
}

// A card saved in another tab lands here too, so two open tabs never disagree.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== DIGITS_KEY && event.key !== AUTO_COPY_KEY) return
    digits = readDigits()
    autoCopy = readAutoCopy()
    notify()
  })
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Saves the digits, or removes the card when given `null`. */
export const setCinevilleCardDigits = (next: string | null) => {
  digits = next
  writeItem(DIGITS_KEY, next)
  notify()
}

export const setCinevilleAutoCopyEnabled = (enabled: boolean) => {
  autoCopy = enabled
  writeItem(AUTO_COPY_KEY, enabled ? null : AUTO_COPY_OFF)
  notify()
}

/** The saved digits, without the prefix, or `null` when there is no card. */
export const useCinevilleCardDigits = (): string | null =>
  useSyncExternalStore(subscribe, () => digits)

export const useCinevilleAutoCopyEnabled = (): boolean =>
  useSyncExternalStore(subscribe, () => autoCopy)

/**
 * For a ticket link's click: copies the card when the showtime is at a
 * Cineville cinema, a card is saved and auto-copy is on. The digits alone, as
 * the app copies them — the ticket shops ask for the number without its
 * prefix. Never throws; a refused clipboard just means nothing was copied.
 */
export const copyCinevilleCardForTicketLink = (isCinevilleCinema: boolean) => {
  if (!isCinevilleCinema || !autoCopy || !digits) return
  navigator.clipboard?.writeText(digits).catch(() => {})
}
