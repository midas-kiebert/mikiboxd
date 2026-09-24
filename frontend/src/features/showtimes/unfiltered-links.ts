/**
 * Links out of a page that has no filters of its own — Activity — to a film,
 * a friend's agenda or a cinema's programme.
 *
 * Those pages normally open under the viewer's usual cinemas and remembered
 * language. From Activity that can hide the very screening that was clicked,
 * so under this context the links ask for every cinema and keep the
 * remembered language from being restored on arrival.
 *
 * The opposite case lives here too: a link to a film out of a *feed* carries
 * that feed's filters (`FeedLinkParamsContext`, `filmSearch`), so the film's
 * page shows the same days, times, cinemas and language the list did.
 */
import { createContext, useContext, useMemo } from "react"

import {
  FILM_LEVEL_FEED_PARAMS,
  type FeedParams,
  stripDefaultFeedParams,
} from "./feed-params"
import { skipLanguageRestore } from "./use-remembered-language"

export const UnfilteredLinksContext = createContext(false)

/**
 * The filters of the feed these links sit in, when they sit in one. Provided
 * by the feed pages (`ShowtimeFeedPage`, `MovieFeedPage`) around everything
 * they draw, the side panel included.
 */
export const FeedLinkParamsContext = createContext<FeedParams | null>(null)

/**
 * A feed's filters as a film page takes them: without the ones that are about
 * films rather than screenings, which the film page pins anyway (a title
 * search, the watchlist, lists…).
 */
const carriedToFilmPage = (params: FeedParams): Partial<FeedParams> => {
  const carried = stripDefaultFeedParams(params)
  for (const key of Object.keys(FILM_LEVEL_FEED_PARAMS) as (keyof FeedParams)[])
    delete carried[key]
  return carried
}

export const useUnfilteredLinks = () => {
  const unfiltered = useContext(UnfilteredLinksContext)
  const feedParams = useContext(FeedLinkParamsContext)
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
      /**
       * `search` for a link to a film's page. Out of a feed, that feed's
       * screening filters, language included — opened with none, the film page
       * came up without the English-only filter the list had on, because the
       * remembered language is only put back once per page load and the feed
       * had already used it. Out of Activity, unfiltered as above.
       */
      filmSearch: (): Partial<FeedParams> =>
        unfiltered
          ? { allCinemas: true }
          : feedParams
            ? carriedToFilmPage(feedParams)
            : {},
      /** Call from the link's click handler. */
      onFollow: unfiltered ? skipLanguageRestore : () => {},
    }),
    [unfiltered, feedParams],
  )
}
