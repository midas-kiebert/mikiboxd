/**
 * How many tickets a row the ticket wall draws.
 *
 * A viewing preference, not a filter: it says nothing about which showtimes
 * are in the feed, so it stays out of the URL and out of presets. A small
 * external store rather than state, so it survives the page being swapped
 * for the film rows and back.
 *
 * **Kept on this device, in `localStorage`**, like the remembered language.
 */
import { useSyncExternalStore } from "react"

export const WALL_COLUMN_OPTIONS = [2, 3, 4, 5] as const
export type WallColumns = (typeof WALL_COLUMN_OPTIONS)[number]

/**
 * The most a row holds beside an open filter rail. Five only fit once the
 * rail is folded to its strip; a stored five is kept, and drawn as four while
 * the rail is open, so folding it again brings the fifth back.
 */
const MAX_COLUMNS_BESIDE_RAIL: WallColumns = 4

export const wallColumnOptions = (
  isRailFolded: boolean,
): readonly WallColumns[] =>
  isRailFolded
    ? WALL_COLUMN_OPTIONS
    : WALL_COLUMN_OPTIONS.filter((option) => option <= MAX_COLUMNS_BESIDE_RAIL)

export const effectiveWallColumns = (
  stored: WallColumns,
  isRailFolded: boolean,
): WallColumns =>
  isRailFolded
    ? stored
    : (Math.min(stored, MAX_COLUMNS_BESIDE_RAIL) as WallColumns)

export const DEFAULT_WALL_COLUMNS: WallColumns = 3

const STORAGE_KEY = "mikino.feed.wallColumns.v1"

const isWallColumns = (value: unknown): value is WallColumns =>
  WALL_COLUMN_OPTIONS.includes(value as WallColumns)

const read = (): WallColumns => {
  try {
    const stored = Number(localStorage.getItem(STORAGE_KEY))
    return isWallColumns(stored) ? stored : DEFAULT_WALL_COLUMNS
  } catch {
    // ignore storage read errors
    return DEFAULT_WALL_COLUMNS
  }
}

let current: WallColumns = read()
const listeners = new Set<() => void>()

// A pick made in another tab lands here too, so two open tabs never disagree.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return
    const next = read()
    if (next === current) return
    current = next
    for (const listener of listeners) listener()
  })
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const setWallColumns = (next: WallColumns) => {
  if (next === current) return
  current = next
  try {
    localStorage.setItem(STORAGE_KEY, String(next))
  } catch {
    // ignore storage write errors
  }
  for (const listener of listeners) listener()
}

export const useWallColumns = (): WallColumns =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULT_WALL_COLUMNS,
  )
