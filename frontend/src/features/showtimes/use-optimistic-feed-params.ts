/**
 * The feed's filters as the visitor has just set them, ahead of the URL.
 *
 * A filter lives in the URL, and the URL moves through the router's own
 * `navigate`, which lands a render later — behind the feed re-rendering for the
 * new query. Every control in the rail read its state from there, so a switch
 * sat still until the new results were on their way: the rail looked like it
 * was thinking about the click.
 *
 * So the rail reads this instead. A change paints at once from local state; the
 * write to the URL is sent after the frame that shows it (a `requestAnimationFrame`
 * runs just *before* the next paint, the timeout inside it just after), so the
 * feed's work can never hold the control back. Once the URL says the same
 * thing, the local copy steps aside.
 *
 * Every unconfirmed key goes out on each write, not only the newest: `onChange`
 * patches the URL as of its own last render, and a second change made before
 * the first had landed would otherwise write the first one back out.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import type { FeedParams } from "./feed-params"

/**
 * How long a value may stay ahead of the URL before the URL wins anyway — for a
 * value the URL ends up spelling differently (a canonicalised list, say), which
 * would otherwise never be seen to "catch up".
 */
const GIVE_UP_MS = 1500

/**
 * How long typing settles before the search text is written to the URL and
 * asked of the server.
 *
 * A switch is one change and commits on the next frame. Typing is a change per
 * letter, and each one of those was a navigation, a re-render of the route and
 * a request of its own — "annie" cost five of each where one would do, which
 * is felt in the keyboard. The text itself never waits for this: the field
 * paints from the overlay, as every other control does.
 *
 * 280ms, the same figure the app settled on for the same fix.
 */
const SEARCH_DEBOUNCE_MS = 280

type Pending = Partial<FeedParams>

const isSame = (left: unknown, right: unknown) =>
  JSON.stringify(left) === JSON.stringify(right)

/** The keys the URL has not caught up with yet; the same object if none did. */
const withoutConfirmed = (pending: Pending, params: FeedParams): Pending => {
  const keys = Object.keys(pending) as (keyof FeedParams)[]
  const stillAhead = keys.filter((key) => !isSame(pending[key], params[key]))
  if (stillAhead.length === keys.length) return pending
  return Object.fromEntries(
    stillAhead.map((key) => [key, pending[key]]),
  ) as Pending
}

export const useOptimisticFeedParams = (
  params: FeedParams,
  onChange: (patch: Partial<FeedParams>) => void,
) => {
  const [pending, setPending] = useState<Pending>({})
  // Mirrors `pending` for the deferred write, which runs outside any render.
  const pendingRef = useRef<Pending>({})
  const onChangeRef = useRef(onChange)
  const isWriteScheduledRef = useRef(false)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  )

  useLayoutEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    const next = withoutConfirmed(pendingRef.current, params)
    if (next === pendingRef.current) return
    pendingRef.current = next
    setPending(next)
  }, [params])

  useEffect(() => {
    if (Object.keys(pending).length === 0) return
    const timer = setTimeout(() => {
      pendingRef.current = {}
      setPending({})
    }, GIVE_UP_MS)
    return () => clearTimeout(timer)
  }, [pending])

  /** Hands everything still ahead of the URL over, in one write. */
  const flush = useCallback(() => {
    if (Object.keys(pendingRef.current).length > 0) {
      onChangeRef.current(pendingRef.current)
    }
  }, [])

  const change = useCallback(
    (patch: Partial<FeedParams>) => {
      const next = { ...pendingRef.current, ...patch }
      pendingRef.current = next
      setPending(next)

      const keys = Object.keys(patch) as (keyof FeedParams)[]
      // Emptying the field is not typing — it is one press, and waiting on it
      // makes deleting feel sticky. The app draws the same line.
      const isTyping =
        keys.every((key) => key === "q") && (patch.q ?? "").length > 0

      if (isTyping) {
        if (typingTimerRef.current !== undefined) {
          clearTimeout(typingTimerRef.current)
        }
        typingTimerRef.current = setTimeout(() => {
          typingTimerRef.current = undefined
          flush()
        }, SEARCH_DEBOUNCE_MS)
        return
      }

      // Anything else goes on the next frame, and takes whatever the typist
      // has left pending along with it.
      if (typingTimerRef.current !== undefined) {
        clearTimeout(typingTimerRef.current)
        typingTimerRef.current = undefined
      }
      if (isWriteScheduledRef.current) return
      isWriteScheduledRef.current = true
      requestAnimationFrame(() => {
        setTimeout(() => {
          isWriteScheduledRef.current = false
          flush()
        }, 0)
      })
    },
    [flush],
  )

  useEffect(
    () => () => {
      if (typingTimerRef.current !== undefined)
        clearTimeout(typingTimerRef.current)
    },
    [],
  )

  const shown = useMemo(() => ({ ...params, ...pending }), [params, pending])
  // Which dimensions are ahead of the URL, so a caller can tell a filter
  // change (the feed's whole result set is about to be replaced) from a
  // keystroke in the search field (it is not).
  const pendingKeys = useMemo(
    () => Object.keys(pending) as (keyof FeedParams)[],
    [pending],
  )

  return { params: shown, onChange: change, pendingKeys }
}
