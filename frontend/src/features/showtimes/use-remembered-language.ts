/**
 * The default for the language toggle.
 *
 * Language is the one filter that is really a preference: someone who does not
 * speak Dutch wants English-only on every visit, not re-picked each time. So
 * the toggle has a default, put back when the feed opens without a language of
 * its own in the URL.
 *
 * **Only "Make this the default" writes it.** The toggle, a preset and
 * clearing the filters all change this visit alone — the default used to
 * follow the toggle while "remembered", which made a one-off flip (or a
 * preset) quietly rewrite it.
 *
 * **Kept on this device, in `localStorage`.** The account has nowhere to store
 * it yet — shipping that means a field on the user and a write here instead.
 */
import { useCallback, useEffect, useState } from "react"
import type { Language } from "shared/client"

const STORAGE_KEY = "mikino.filters.language.v2"
/** The "remember my choice" era: `{ remember, languages }`. Read once, as a default. */
const LEGACY_STORAGE_KEY = "mikino.filters.language.v1"

const isLanguage = (entry: unknown): entry is Language =>
  entry === "nl" || entry === "en"

const parse = (
  key: string,
): { languages?: unknown; remember?: unknown } | null => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null")
  } catch {
    // ignore storage read errors
    return null
  }
}

/**
 * The default languages, or none — also the fallback a list that says nothing
 * about language uses (see the feed overview's custom list).
 */
export const readRememberedLanguages = (): Language[] => {
  const stored = parse(STORAGE_KEY)
  if (stored && Array.isArray(stored.languages))
    return stored.languages.filter(isLanguage)
  const legacy = parse(LEGACY_STORAGE_KEY)
  return legacy?.remember === true && Array.isArray(legacy.languages)
    ? legacy.languages.filter(isLanguage)
    : []
}

const write = (languages: Language[]) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ languages }))
  } catch {
    // ignore storage write errors
  }
}

const sameLanguages = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((entry) => b.includes(entry))

/**
 * Once per page load, not per mount: the rail remounts (and there is more than
 * one of it), and a per-mount restore put the default straight back over any
 * switch away from it the moment that happened.
 */
let hasRestored = false

export const useRememberedLanguage = ({
  current,
  apply,
}: {
  /** The languages the feed is filtering by right now. */
  current: readonly string[]
  apply: (languages: string[]) => void
}) => {
  const [defaultLanguages, setDefaultLanguages] = useState<Language[]>(
    readRememberedLanguages,
  )

  // Once, on open: a URL that already says something about language wins, so a
  // shared link is never quietly rewritten by the viewer's own default.
  useEffect(() => {
    if (hasRestored) return
    hasRestored = true
    if (current.length === 0 && defaultLanguages.length > 0)
      apply([...defaultLanguages])
  }, [defaultLanguages, current, apply])

  const makeDefault = useCallback(() => {
    const next = current.filter(isLanguage)
    setDefaultLanguages(next)
    write(next)
  }, [current])

  return {
    defaultLanguages,
    isDefault: sameLanguages(current, defaultLanguages),
    makeDefault,
  }
}
