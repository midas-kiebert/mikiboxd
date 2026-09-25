/**
 * Whether marking a showtime "going" should offer to clear "interested" left
 * on other showtimes of the same film (see `RemoveInterestedElsewhereDialog`,
 * wired up in `ShowtimeStatusSection`). The app's
 * `mobile/utils/interested-elsewhere-reminder.ts`, on the web.
 *
 * Defaults to on; the dialog's "don't ask again" box and the Settings switch
 * turn it off.
 *
 * **Kept on this device, in `localStorage`**, as the app keeps it in its own
 * storage — the account has no field for it.
 */
import { useSyncExternalStore } from "react"

const STORAGE_KEY = "mikino.remind-remove-interested-elsewhere"
const DISABLED_VALUE = "0"
const ENABLED_VALUE = "1"

const read = (): boolean => {
  try {
    // Only an explicit "off" overrides the default.
    return localStorage.getItem(STORAGE_KEY) !== DISABLED_VALUE
  } catch {
    return true
  }
}

let enabled = read()
const listeners = new Set<() => void>()

export const setRemoveInterestedReminderEnabled = (value: boolean): void => {
  enabled = value
  for (const listener of listeners) listener()
  try {
    localStorage.setItem(STORAGE_KEY, value ? ENABLED_VALUE : DISABLED_VALUE)
  } catch {
    // ignore storage write errors
  }
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useRemoveInterestedReminderEnabled = (): boolean =>
  useSyncExternalStore(subscribe, () => enabled)

/** Non-hook read, for the status-press handler. */
export const isRemoveInterestedReminderEnabled = (): boolean => enabled
