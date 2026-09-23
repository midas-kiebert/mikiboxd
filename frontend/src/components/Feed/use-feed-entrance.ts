/**
 * How a feed's rows arrive: the app's `FeedItemEntrance` on the web. Each
 * card fades and lifts into place instead of popping in, and on a fresh list
 * the first screenful follows a beat behind the rows above it, so it reads as
 * filling in one by one rather than snapping in as a block.
 *
 * The motion itself is the global `.mk-feed-item` class (`theme.tsx`); this
 * decides each row's delay. Only a fresh list staggers. A page appended by
 * scrolling lands where the reader is already looking, just after a spinner
 * told them more was coming, so its rows fade in at once — a capped delay on
 * each would only read as a dead gap.
 *
 * A row's delay is fixed the first time it is seen. Changing a CSS
 * animation's delay after it has run sends it back to its first frame, so a
 * row must never be handed a different one on a later render. Rows that stay
 * in the list across a change keep their card, and do not animate again.
 */
import { useRef } from "react"

const STAGGER_STEP_MS = 45
/** Past the first screenful a stagger only makes rows land later, unseen. */
const MAX_STAGGER_INDEX = 8

/** The class that plays the entrance. */
export const FEED_ITEM_CLASS = "mk-feed-item"

/** Each row's entrance delay in ms, by id. */
export const useFeedEntranceDelays = (ids: number[]): Map<number, number> => {
  const delaysRef = useRef(new Map<number, number>())
  const firstIdRef = useRef<number | undefined>(undefined)
  const lengthRef = useRef(0)

  // A list that shrank or starts with a different row was replaced (a filter
  // or search changed), not appended to: its rows get the fill-in again.
  // Rows carried over keep the delay they already played with (see above).
  const isFresh =
    ids.length < lengthRef.current || ids[0] !== firstIdRef.current
  const previous = delaysRef.current
  const delays = isFresh ? new Map<number, number>() : previous
  ids.forEach((id, index) => {
    const known = previous.get(id)
    if (known !== undefined) delays.set(id, known)
    else
      delays.set(
        id,
        isFresh ? Math.min(index, MAX_STAGGER_INDEX) * STAGGER_STEP_MS : 0,
      )
  })
  delaysRef.current = delays
  firstIdRef.current = ids[0]
  lengthRef.current = ids.length
  return delays
}
