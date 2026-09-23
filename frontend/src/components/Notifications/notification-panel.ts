/**
 * Whether the notification panel is open, readable and settable from anywhere.
 *
 * The panel hangs off the bell in the top nav, but other places need to open
 * it: the feed overview's "Show more" under your invites, and the old `/pings`
 * address, which the app and invite links still point at. None of them sit
 * under the nav, so a context would have to wrap the whole layout — and
 * re-render it on every toggle. A module-level store is the same shape as
 * `feed-search-slot.ts`: only the bell subscribes.
 */
import { useSyncExternalStore } from "react"

type Listener = () => void

let isOpen = false
const listeners = new Set<Listener>()

const subscribe = (listener: Listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getIsOpen = () => isOpen
const getServerIsOpen = () => false

export const setNotificationPanelOpen = (next: boolean) => {
  if (isOpen === next) return
  isOpen = next
  for (const listener of listeners) listener()
}

export const openNotificationPanel = () => setNotificationPanelOpen(true)
export const closeNotificationPanel = () => setNotificationPanelOpen(false)

export const useNotificationPanelOpen = (): boolean =>
  useSyncExternalStore(subscribe, getIsOpen, getServerIsOpen)
