/**
 * The search field's seat in the top navigation, and who is sitting in it.
 *
 * The field moved out of the bar above the feed and into the site's navigation,
 * which is a floor higher than the page that owns the search state — so the
 * page has to hand it up. It cannot hand it up through props: the nav is a
 * sibling of the router's `Outlet`, not a parent of it.
 *
 * A module-level store rather than a context, the same shape as
 * `auth/session.ts`, and for the same two reasons. It answers synchronously, so
 * the nav paints the field in the first frame a feed page renders rather than
 * one commit later. And only the subscriber re-renders: a context would put
 * every keystroke through a provider above the `Outlet` and re-render the
 * entire page underneath it.
 *
 * Nothing here knows which routes have a feed. A page that has one fills the
 * slot while it is mounted and empties it on the way out, so adding a feed
 * screen needs no list kept in step anywhere.
 */
import { useLayoutEffect, useSyncExternalStore } from "react"
import type { SearchField } from "shared/client"

export type FeedSearchSlot = {
  query: string
  field: SearchField
  onQueryChange: (query: string) => void
  onFieldChange: (field: SearchField) => void
  /** Overrides the scope's own placeholder — "Search films…" on a films feed. */
  placeholder?: string
} | null

type Listener = () => void

let slot: FeedSearchSlot = null
const listeners = new Set<Listener>()

const notify = () => {
  for (const listener of listeners) listener()
}

const getSlot = (): FeedSearchSlot => slot

/** No feed has rendered on the server, so the nav starts without a field. */
const getServerSlot = (): FeedSearchSlot => null

const subscribe = (listener: Listener) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** What the navigation renders, or `null` on a page with no feed. */
export const useFeedSearchSlot = (): FeedSearchSlot =>
  useSyncExternalStore(subscribe, getSlot, getServerSlot)

/**
 * Fill the slot for as long as this page is on screen.
 *
 * `search` must be memoised by the caller: it is the effect's dependency, and
 * a fresh object every render would republish on every render.
 *
 * The two effects are deliberately separate. Republishing on a change must not
 * empty the slot first — that would unmount the field in the nav and take the
 * caret with it on every keystroke — so only unmounting clears it.
 */
export const usePublishFeedSearch = (search: FeedSearchSlot): void => {
  useLayoutEffect(() => {
    slot = search
    notify()
  }, [search])

  useLayoutEffect(
    () => () => {
      slot = null
      notify()
    },
    [],
  )
}
