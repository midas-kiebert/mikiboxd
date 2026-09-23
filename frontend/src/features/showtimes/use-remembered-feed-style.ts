/**
 * The default feed style — ticket wall or movie rows.
 *
 * The same shape as `use-remembered-language`: only "Make this the default"
 * writes it, so switching styles (by hand or through a preset) never changes
 * it; kept on this device, in `localStorage`; put back once when the feed
 * opens.
 */
import { useCallback, useEffect, useState } from "react"

const STORAGE_KEY = "mikino.filters.feedStyle.v2"
/** The "remember my choice" era: `{ remember, group }`. Read once, as a default. */
const LEGACY_STORAGE_KEY = "mikino.filters.feedStyle.v1"

const parse = (key: string): { group?: unknown; remember?: unknown } | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null")
  } catch {
    // ignore storage read errors
    return null
  }
}

const read = (): boolean => {
  const stored = parse(STORAGE_KEY)
  if (stored && typeof stored.group === "boolean") return stored.group
  const legacy = parse(LEGACY_STORAGE_KEY)
  return legacy?.remember === true && legacy.group === true
}

const write = (group: boolean) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ group }))
  } catch {
    // ignore storage write errors
  }
}

/**
 * Once per page load, not per mount: the rail remounts (and there is more than
 * one of it), and a per-mount restore put the default straight back over any
 * switch away from it the moment that happened.
 */
let hasRestored = false

export const useRememberedFeedStyle = ({
  current,
  apply,
  enabled,
}: {
  /** Whether the feed is grouped into movie rows right now. */
  current: boolean
  apply: (group: boolean) => void
  /** False where the page has no feed style to choose. */
  enabled: boolean
}) => {
  const [defaultGroup, setDefaultGroup] = useState<boolean>(read)

  // Once, on open. `group` is off by default and left out of the URL then, so
  // only a default of "movie rows" has anything to put back.
  useEffect(() => {
    if (!enabled || hasRestored) return
    hasRestored = true
    if (defaultGroup && !current) apply(true)
  }, [enabled, defaultGroup, current, apply])

  const makeDefault = useCallback(() => {
    setDefaultGroup(current)
    write(current)
  }, [current])

  return { isDefault: current === defaultGroup, makeDefault }
}
