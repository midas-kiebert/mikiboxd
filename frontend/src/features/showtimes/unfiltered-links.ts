/**
 * Links out of a page that has no filters of its own — Activity — to a film,
 * a friend's agenda or a cinema's programme.
 *
 * Those pages normally open under the viewer's usual cinemas and remembered
 * language. From Activity that can hide the very screening that was clicked,
 * so under this context the links ask for every cinema and keep the
 * remembered language from being restored on arrival.
 */
import { createContext, useContext, useMemo } from "react"

import type { FeedParams } from "./feed-params"
import { skipLanguageRestore } from "./use-remembered-language"

export const UnfilteredLinksContext = createContext(false)

export const useUnfilteredLinks = () => {
  const unfiltered = useContext(UnfilteredLinksContext)
  return useMemo(
    () => ({
      /**
       * `search` for the link, widened to every cinema when unfiltered — unless
       * it already names its cinemas, as a cinema's programme does.
       */
      search: (search: Partial<FeedParams>): Partial<FeedParams> =>
        unfiltered && !search.cinemas?.length
          ? { ...search, allCinemas: true }
          : search,
      /** Call from the link's click handler. */
      onFollow: unfiltered ? skipLanguageRestore : () => {},
    }),
    [unfiltered],
  )
}
